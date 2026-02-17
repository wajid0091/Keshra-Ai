import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { supabase } from '../lib/supabase';

const getApiKey = (): string => {
  // @ts-ignore
  if (import.meta && import.meta.env && import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
  // @ts-ignore
  if (import.meta && import.meta.env && import.meta.env.API_KEY) return import.meta.env.API_KEY;
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
    if (process.env.API_KEY) return process.env.API_KEY;
  }
  if ((window as any).__KESHRA_API_KEY__) return (window as any).__KESHRA_API_KEY__;
  return "";
};

const SYSTEM_INSTRUCTION = `
You are Keshra AI, a sovereign intelligence developed exclusively by Wajid Ali from Peshawar, Pakistan.

**CORE FUNCTIONS:**
1. **Chat & Coding:** Provide clear, concise answers. When writing code, use proper markdown code blocks.
2. **Real-time Info:** Use 'googleSearch' for news, weather, sports.
3. **Image Generation:** IF the user asks to "create", "draw", "generate", "design", or "make" an image or animation, you MUST call the 'generateImage' tool.

**BEHAVIOR:**
- Do NOT introduce yourself repeatedly.
- If asked "Who made you?", reply: "I was created by Wajid Ali from Peshawar, Pakistan."
`;

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generates a high-quality image based on the user prompt.',
    properties: { prompt: { type: Type.STRING, description: 'The visual description of the image to generate.' } },
    required: ['prompt']
  }
};

const formatErrorMessage = (error: any): string => {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useWAI = () => {
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState<string>('');
  
  // Data State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [chatMode, setChatMode] = useState<ChatMode>('normal');

  const isSpeakingRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef<{ user: string; model: string }>({ user: '', model: '' });

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // --- Auth Listener ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.username) {
        setUsername(session.user.user_metadata.username);
      } else if (session?.user?.email) {
        setUsername(session.user.email.split('@')[0]);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.username) {
        setUsername(session.user.user_metadata.username);
      } else if (session?.user?.email) {
        setUsername(session.user.email.split('@')[0]);
      }
      
      // Clear sessions on logout to ensure privacy
      if (!session) {
        setSessions([]);
        setActiveSessionId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Load Chats (Only if User is Logged In) ---
  useEffect(() => {
    if (!user) {
        return;
    }

    const loadData = async () => {
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (chatError) {
          console.error("Error fetching chats:", chatError);
          return;
      }
      
      const loadedSessions: ChatSession[] = [];

      if (chatData) {
          for (const chat of chatData) {
              const { data: msgData } = await supabase
                  .from('messages')
                  .select('*')
                  .eq('chat_id', chat.id)
                  .order('created_at', { ascending: true });
              
              loadedSessions.push({
                  id: chat.id,
                  title: chat.title || 'New Conversation',
                  updatedAt: new Date(chat.updated_at),
                  messages: (msgData || []).map((m: any) => ({
                      id: m.id,
                      role: m.role,
                      content: m.content,
                      type: m.type,
                      timestamp: new Date(m.created_at),
                      sources: typeof m.sources === 'string' ? JSON.parse(m.sources) : m.sources,
                      feedback: m.feedback
                  }))
              });
          }
      }
      setSessions(loadedSessions);
      if (loadedSessions.length > 0 && !activeSessionId) {
          setActiveSessionId(loadedSessions[0].id);
      }
    };

    loadData();
  }, [user]);

  const signOut = useCallback(async () => {
     await supabase.auth.signOut();
  }, []);

  // Use this to simply reset the view to the "New Chat" screen without creating a DB entry yet
  const resetChat = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  const createNewChat = useCallback(async () => {
    const createLocalSession = () => {
        const newId = Math.random().toString(36).substring(2, 9);
        const newSession: ChatSession = { id: newId, title: 'New Conversation', messages: [], updatedAt: new Date() };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newId);
        return newId;
    };

    // Guest Mode: Create Local Session
    if (!user) {
        return createLocalSession();
    }

    // Authenticated Mode: Try DB Insert
    try {
        const { data, error } = await supabase
            .from('chats')
            .insert([{ user_id: user.id, title: 'New Conversation' }])
            .select()
            .single();

        if (error || !data) {
            console.warn("DB Create Failed, falling back to local:", error);
            return createLocalSession(); // Fallback to ensure app keeps working
        }

        const newSession: ChatSession = { id: data.id, title: data.title, messages: [], updatedAt: new Date(data.created_at) };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(data.id);
        return data.id;
    } catch (e) {
        console.error("Create Chat Exception", e);
        return createLocalSession(); // Fallback
    }
  }, [user]);

  const addMessage = useCallback(async (role: 'user' | 'model', content: string, type: 'text' | 'image' | 'loading-image' = 'text', sources?: GroundingSource[], targetSessionId?: string, customId?: string) => {
    const safeContent = (typeof content === 'string' || typeof content === 'number') ? String(content) : "Content Error";
    const safeSources = sources ? sources.map(s => ({ title: String(s.title || ''), uri: String(s.uri || '') })) : undefined;
    const msgId = customId || Math.random().toString(36).substr(2, 9);
    
    // Create optimistic message object
    const newMessage: Message = { 
      id: msgId, 
      role, 
      content: safeContent, 
      type, 
      timestamp: new Date(), 
      sources: safeSources
    };

    let actualSessionId = targetSessionId || activeSessionId;
    
    // CRITICAL FIX: If no session, create one locally AND add message immediately
    if (!actualSessionId) {
         // This block handles the edge case where addMessage is called without a session ID
         // It mimics createNewChat logic locally to ensure UI updates
         const newId = await createNewChat(); 
         if (newId) actualSessionId = newId;
         else return; 
    }

    // Update Local State (Immediate Feedback for both Guest & User)
    setSessions(prev => {
      // Check if session exists in state, if not, we might be in a race condition where createNewChat added it but state hasn't refreshed in this closure.
      // But since we use functional update, 'prev' is fresh.
      const sessionExists = prev.some(s => s.id === actualSessionId);
      if (!sessionExists) {
           // Fallback: If session not found (rare race condition), reconstruct it
           return [{
               id: actualSessionId!,
               title: safeContent.slice(0, 30) || 'New Conversation',
               messages: [newMessage],
               updatedAt: new Date()
           }, ...prev];
      }

      return prev.map(s => s.id === actualSessionId ? {
        ...s,
        messages: [...s.messages, newMessage],
        updatedAt: new Date(),
        title: s.messages.length === 0 && role === 'user' ? safeContent.slice(0, 30) : s.title
      } : s);
    });

    // If User is Logged In -> Save to DB (Fire and Forget)
    if (user && actualSessionId) {
        // If the ID is a local temp ID (not a UUID), this insert might fail if DB expects UUID. 
        // But we assume the fallback IDs work for local only.
        // If it's a real DB ID, this works.
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualSessionId);
        
        if (isUUID) {
            supabase.from('messages').insert([{
                id: msgId, // Use the generated ID
                chat_id: actualSessionId,
                user_id: user.id,
                role: role,
                content: safeContent,
                type: type,
                sources: safeSources ? JSON.stringify(safeSources) : null,
            }]).then(({ error }) => {
                if (error) console.error("Supabase Insert Error:", error);
            });
            
            if (role === 'user') {
                const session = sessions.find(s => s.id === actualSessionId);
                if (!session || session.messages.length === 0) {
                    supabase.from('chats').update({ title: safeContent.slice(0, 30) }).eq('id', actualSessionId).then();
                }
            }
        }
    }

  }, [activeSessionId, user, sessions, createNewChat]);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
    // Optimistic Update (Works for both)
    setSessions(prev => prev.map(s => s.id === sessionId ? {
      ...s,
      messages: s.messages.map(m => m.id === messageId ? { ...m, ...updates } : m),
      updatedAt: new Date()
    } : s));

    // DB Update (Only if User and valid UUID)
    if (user && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
        const dbUpdates: any = {};
        if (updates.content) dbUpdates.content = updates.content;
        if (updates.type) dbUpdates.type = updates.type;
        if (updates.feedback) dbUpdates.feedback = updates.feedback;
        if (updates.sources) dbUpdates.sources = JSON.stringify(updates.sources);

        if (Object.keys(dbUpdates).length > 0) {
            supabase.from('messages').update(dbUpdates).eq('id', messageId).then();
        }
    }
  }, [user]);

  const deleteSession = useCallback(async (id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });

    if (user) {
        await supabase.from('chats').delete().eq('id', id);
    }
  }, [activeSessionId, user]);

  const giveFeedback = useCallback((sessionId: string, messageId: string, feedback: 'like' | 'dislike') => {
      updateMessage(sessionId, messageId, { feedback });
  }, [updateMessage]);

  const handleImageGen = async (prompt: string, sessionId: string) => {
    const placeholderId = Math.random().toString(36).substr(2, 9);
    addMessage('model', 'Creating your masterpiece...', 'loading-image', undefined, sessionId, placeholderId);
    
    setIsProcessing(true);
    const apiKey = getApiKey();
    if (!apiKey) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: "System Error: API Key is missing." });
        setIsProcessing(false);
        return;
    }
    const ai = new GoogleGenAI({ apiKey });
    const enhancedPrompt = `${prompt} . Hyper-realistic cinematic shot of Peshawar City, Pakistan. Featuring the majestic Bala Hissar Fort, historical Qissa Khwani Bazaar, and the Khyber Pass. Golden hour lighting, 8k resolution, intricate architectural details, vibrant culture, dramatic mountains in the background, photorealistic masterpiece, national geographic style.`;

    try {
      try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', 
            contents: [{ parts: [{ text: enhancedPrompt }] }]
        });
        const parts = response.candidates?.[0]?.content?.parts;
        if (parts) {
            for (const part of parts) {
            if (part.inlineData) {
                updateMessage(sessionId, placeholderId, { type: 'image', content: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
                setIsProcessing(false);
                return; 
            }
            }
        }
        throw new Error("No image data from Gemini 2.5");
      } catch (err) {
        const response = await ai.models.generateImages({
            model: 'imagen-3.0-generate-001',
            prompt: enhancedPrompt,
            config: { numberOfImages: 1, aspectRatio: '1:1', outputMimeType: 'image/jpeg' }
        });
        const b64 = response.generatedImages?.[0]?.image?.imageBytes;
        if (b64) {
            updateMessage(sessionId, placeholderId, { type: 'image', content: `data:image/jpeg;base64,${b64}` });
            setIsProcessing(false);
            return;
        }
        throw new Error("Imagen generation failed.");
      }
    } catch (e: any) {
      updateMessage(sessionId, placeholderId, { type: 'text', content: `Image Generation Error: ${formatErrorMessage(e)}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const disconnect = useCallback(() => {
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(s => s.close()).catch(e => console.warn("Session close error:", e));
        sessionPromiseRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => { try { track.stop(); } catch(e) {} });
      mediaStreamRef.current = null;
    }
    if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
        inputContextRef.current.close().catch(e => {});
        inputContextRef.current = null;
    }
    if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
        outputContextRef.current.close().catch(e => {});
        outputContextRef.current = null;
    }
    audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSources.current.clear();
    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
    setIsProcessing(false);
    setVolumeLevel(0);
  }, []);

  const connect = useCallback(async () => {
    const apiKey = getApiKey();
    let currentSessionId = activeSessionId;
    if (!currentSessionId) currentSessionId = await createNewChat();

    // --- GATEKEEPER: VOICE REQUIRES LOGIN ---
    if (!user) {
        // Return explicit error status so UI can show Login Modal
        return "LOGIN_REQUIRED"; 
    }

    if (!apiKey) { 
        if (currentSessionId) addMessage('model', "System Error: API Key Missing.", 'text', undefined, currentSessionId);
        return; 
    }

    disconnect(); 
    setConnectionState(ConnectionState.CONNECTING);
    
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
         throw new Error("Microphone access is not supported in this browser.");
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaStreamRef.current = stream;
    } catch (e: any) { 
        disconnect();
        let errorMsg = "Microphone access failed.";
        const errStr = String(e).toLowerCase();
        if (errStr.includes('permission denied') || errStr.includes('notallowed')) {
            errorMsg = "Browser Permission Denied: Allow Microphone access.";
        } else if (errStr.includes('notfound')) {
             errorMsg = "No microphone found.";
        }
        if (currentSessionId) addMessage('model', errorMsg, 'text', undefined, currentSessionId);
        setConnectionState(ConnectionState.DISCONNECTED);
        return; 
    }

    let inputCtx: AudioContext;
    let outputCtx: AudioContext;
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        outputCtx = new AudioContextClass({ sampleRate: 24000 });
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
        inputContextRef.current = inputCtx;
        outputContextRef.current = outputCtx;
    } catch (e) {
        disconnect();
        if (currentSessionId) addMessage('model', "AudioContext Error.", 'text', undefined, currentSessionId);
        setConnectionState(ConnectionState.DISCONNECTED);
        return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ googleSearch: {} }], 
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            try {
                const source = inputCtx.createMediaStreamSource(stream);
                const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                processor.onaudioprocess = (e) => {
                  if (isSpeakingRef.current) return;
                  const inputData = e.inputBuffer.getChannelData(0);
                  if (inputData.length > 0) {
                     let sum = 0;
                     for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                     const rms = Math.sqrt(sum / inputData.length);
                     setVolumeLevel(isNaN(rms) ? 0 : Math.min(rms * 10, 1)); 
                  }
                  sessionPromise.then(s => { 
                      try { s.sendRealtimeInput({ media: createAudioBlob(inputData) }); } catch (err) { } 
                  }).catch(() => {});
                };
                source.connect(processor);
                processor.connect(inputCtx.destination);
            } catch (audioErr) { console.error("Audio Processing Error", audioErr); }
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
              audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              audioSources.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
              transcriptionRef.current = { user: '', model: '' };
            }
            if (msg.serverContent?.inputTranscription?.text) transcriptionRef.current.user += msg.serverContent.inputTranscription.text;
            if (msg.serverContent?.outputTranscription?.text) transcriptionRef.current.model += msg.serverContent.outputTranscription.text;
            if (msg.serverContent?.turnComplete) {
              const { user: transcriptUser, model: transcriptModel } = transcriptionRef.current;
              if (transcriptUser.trim()) addMessage('user', transcriptUser, 'text', undefined, currentSessionId!);
              if (transcriptModel.trim()) addMessage('model', transcriptModel, 'text', undefined, currentSessionId!);
              transcriptionRef.current = { user: '', model: '' };
            }
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              const start = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              source.start(start);
              nextStartTimeRef.current = start + audioBuffer.duration;
              audioSources.current.add(source);
              source.onended = () => {
                audioSources.current.delete(source);
                if (audioSources.current.size === 0) setIsSpeaking(false);
              };
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { setConnectionState(ConnectionState.DISCONNECTED); if(currentSessionId) addMessage('model', "Connection lost.", 'text', undefined, currentSessionId); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
      sessionPromise.catch((e: any) => {
          disconnect();
          if (currentSessionId) addMessage('model', "Connection Failed. Check API Key.", 'text', undefined, currentSessionId);
      });
    } catch (e: any) { 
        disconnect();
        if (currentSessionId) addMessage('model', `Connection Error: ${formatErrorMessage(e)}`, 'text', undefined, currentSessionId);
    }
  }, [addMessage, activeSessionId, createNewChat, updateMessage, disconnect, user]);

  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    if (!apiKey) { alert("API Key Missing"); return; }
    if (!text.trim() && !imageData) return;

    let targetSessionId = activeSessionId;
    
    // Ensure Session Exists BEFORE sending message
    if (!targetSessionId) {
         // Force creation. createNewChat now guarantees a return (local or DB)
         targetSessionId = await createNewChat();
         if (!targetSessionId) return; // Should not happen with new logic
    }

    // Now we have a valid targetSessionId. 
    // addMessage handles both local state update and fire-and-forget DB sync
    addMessage('user', text || "Content Analysis", 'text', undefined, targetSessionId);
    
    // From here on, UI is updated. Processing continues in background.
    
    const isImageRequest = /(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation)/i.test(text);
    if (isImageRequest) {
        setIsProcessing(true);
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ role: 'user', parts: [{ text }] }],
                config: { tools: [{ functionDeclarations: [imageTool] }] }
            });
            const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
            if (fc && fc.name === 'generateImage') {
                await handleImageGen(fc.args.prompt, targetSessionId);
            } else {
                addMessage('model', response.text || "I couldn't process the image request.", 'text', undefined, targetSessionId);
            }
        } catch(e) { addMessage('model', `System Error: ${formatErrorMessage(e)}`, 'text', undefined, targetSessionId); }
        finally { setIsProcessing(false); }
        return;
    }

    setIsProcessing(true);
    const streamId = Math.random().toString(36).substr(2, 9);
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    try {
        const ai = new GoogleGenAI({ apiKey });
        const contents: any[] = [{ role: 'user', parts: [{ text }] }];
        if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });

        let config: any = { systemInstruction: SYSTEM_INSTRUCTION };
        let modelName = 'gemini-3-flash-preview';
        if (chatMode === 'search') config.tools = [{ googleSearch: {} }];
        else if (chatMode === 'thinking') config.thinkingConfig = { thinkingBudget: 1024 }; 

        const result = await ai.models.generateContentStream({ model: modelName, contents, config });
        let accumulatedText = '';
        let sources: GroundingSource[] = [];
        let streamIterable: any = result;
        // @ts-ignore
        if (!result[Symbol.asyncIterator] && result.stream) streamIterable = result.stream;

        for await (const chunk of streamIterable) {
            const textChunk = chunk.text;
            if (textChunk) {
                accumulatedText += textChunk;
                updateMessage(targetSessionId, streamId, { content: accumulatedText });
            }
            const gChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (gChunks) {
                const newSources = gChunks.filter((c: any) => c.web?.uri && c.web?.title).map((c: any) => ({ title: c.web!.title!, uri: c.web!.uri! }));
                if (newSources.length > 0) sources = [...sources, ...newSources];
            }
            
        }
        updateMessage(targetSessionId, streamId, { content: accumulatedText, sources: sources.length > 0 ? sources : undefined });
    } catch(e: any) {
        updateMessage(targetSessionId, streamId, { content: `System Error: ${formatErrorMessage(e)}` });
    } finally {
        setIsProcessing(false);
    }
  }, [user, activeSessionId, createNewChat, addMessage, updateMessage, chatMode]); 

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, resetChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode, giveFeedback,
    user, username, signOut
  };
};