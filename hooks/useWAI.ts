import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { supabase } from '../lib/supabase';

// Helper to generate proper UUIDs to prevent DB type errors
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// --- ROBUST API KEY LOADING ---
const getApiKey = (): string => {
  // 1. Check process.env (Standard Node/Netlify/Build Env)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.API_KEY) return process.env.API_KEY;
    // Fallbacks just in case
    if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
    // @ts-ignore
    if (process.env.REACT_APP_API_KEY) return process.env.REACT_APP_API_KEY;
  }

  // 2. Check import.meta.env (Vite Client Env)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // @ts-ignore
    if (import.meta.env.API_KEY) return import.meta.env.API_KEY; // Direct access
    // @ts-ignore
    if (import.meta.env['API_KEY']) return import.meta.env['API_KEY']; // Bracket access
    // @ts-ignore
    if (import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
  }
  
  // 3. Global Window Fallback (Last resort)
  if ((window as any).API_KEY) return (window as any).API_KEY;

  return "";
};

const getSystemInstruction = () => `
You are Keshra AI, a sovereign intelligence developed exclusively by Wajid Ali from Peshawar, Pakistan.

**CURRENT CONTEXT:**
- **Current Date & Time:** ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.
- **Model Knowledge:** You must prioritize real-time information using the 'googleSearch' tool when users ask about current events, news, or dates.

**CORE FUNCTIONS:**
1. **Chat & Coding:** Provide clear, concise answers. When writing code, use proper markdown code blocks.
2. **Real-time Info:** ALWAYS use 'googleSearch' for news, weather, sports, stock prices, or recent events.
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
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();
  
  // Specific Key Errors
  if (lowerMsg.includes('api key') || lowerMsg.includes('400') || lowerMsg.includes('invalid') || lowerMsg.includes('unauthenticated')) {
      return "⚠️ Invalid API Key. Please check your settings or environment variables.";
  }

  // Quota Errors
  if (lowerMsg.includes('429') || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('quota')) {
      return "⚠️ API Limit Reached. Switching to fallback models...";
  }

  // Safety/Network
  if (lowerMsg.includes('safety') || lowerMsg.includes('blocked')) return "⚠️ Request blocked due to safety guidelines.";
  if (lowerMsg.includes('fetch') || lowerMsg.includes('network')) return "⚠️ Network error. Check your internet.";
  
  return "⚠️ Service busy. Try again.";
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
      
      if (!session) {
        setSessions([]);
        setActiveSessionId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Load Chats ---
  useEffect(() => {
    if (!user) return;

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

  const resetChat = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  const setManualApiKey = (key: string) => {
      // Deprecated but kept to prevent build errors if referenced elsewhere
  };

  const createNewChat = useCallback(async () => {
    const createLocalSession = () => {
        const newId = generateUUID(); 
        const newSession: ChatSession = { id: newId, title: 'New Conversation', messages: [], updatedAt: new Date() };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newId);
        return newId;
    };

    if (!user) return createLocalSession();

    try {
        const { data, error } = await supabase
            .from('chats')
            .insert([{ user_id: user.id, title: 'New Conversation' }])
            .select()
            .single();

        if (error || !data) {
            console.warn("DB Create Failed, falling back to local:", error);
            return createLocalSession(); 
        }

        const newSession: ChatSession = { id: data.id, title: data.title, messages: [], updatedAt: new Date(data.created_at) };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(data.id);
        return data.id;
    } catch (e) {
        return createLocalSession(); 
    }
  }, [user]);

  const addMessage = useCallback(async (role: 'user' | 'model', content: string, type: 'text' | 'image' | 'loading-image' = 'text', sources?: GroundingSource[], targetSessionId?: string, customId?: string) => {
    const safeContent = (typeof content === 'string' || typeof content === 'number') ? String(content) : "Content Error";
    const safeSources = sources ? sources.map(s => ({ title: String(s.title || ''), uri: String(s.uri || '') })) : undefined;
    const msgId = customId || generateUUID();
    
    const newMessage: Message = { 
      id: msgId, 
      role, 
      content: safeContent, 
      type, 
      timestamp: new Date(), 
      sources: safeSources
    };

    let actualSessionId = targetSessionId || activeSessionId;
    if (!actualSessionId) {
         const newId = await createNewChat(); 
         if (newId) actualSessionId = newId;
         else return; 
    }

    setSessions(prev => {
      const sessionExists = prev.some(s => s.id === actualSessionId);
      if (!sessionExists) {
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

    if (user && actualSessionId) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualSessionId);
        if (isUUID) {
            supabase.from('messages').insert([{
                id: msgId, 
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
    setSessions(prev => prev.map(s => s.id === sessionId ? {
      ...s,
      messages: s.messages.map(m => m.id === messageId ? { ...m, ...updates } : m),
      updatedAt: new Date()
    } : s));

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
    if (user) await supabase.from('chats').delete().eq('id', id);
  }, [activeSessionId, user]);

  const giveFeedback = useCallback((sessionId: string, messageId: string, feedback: 'like' | 'dislike') => {
      updateMessage(sessionId, messageId, { feedback });
  }, [updateMessage]);

  const handleImageGen = async (prompt: string, sessionId: string) => {
    const placeholderId = generateUUID();
    addMessage('model', 'Creating your masterpiece...', 'loading-image', undefined, sessionId, placeholderId);
    
    setIsProcessing(true);
    const apiKey = getApiKey();
    if (!apiKey) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: "⚠️ API Key missing. Please check configuration." });
        setIsProcessing(false);
        return;
    }
    const ai = new GoogleGenAI({ apiKey });
    const enhancedPrompt = `${prompt} . Hyper-realistic cinematic shot. 8k resolution, intricate details, photorealistic masterpiece.`;

    // FALLBACK LOGIC FOR IMAGES: High Quality -> Flash Image -> Error
    const imageModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

    for (const model of imageModels) {
        try {
            const response = await ai.models.generateContent({
                model: model, 
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
        } catch (err) {
            console.warn(`Image Model ${model} failed, trying next...`);
            continue; // Try next model
        }
    }

    // If all fail, try Imagen as last resort fallback or show error
    try {
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
    } catch(e: any) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: formatErrorMessage(e) });
    }
    setIsProcessing(false);
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

    if (!user) return "LOGIN_REQUIRED"; 
    
    // Strict Check: No Key = No Voice
    if (!apiKey) { 
        if (currentSessionId) addMessage('model', "⚠️ API Key Missing. Please check configuration.", 'text', undefined, currentSessionId);
        return; 
    }

    disconnect(); 
    setConnectionState(ConnectionState.CONNECTING);
    
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
         throw new Error("Microphone access is not supported.");
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
        if (errStr.includes('permission denied')) errorMsg = "Browser Permission Denied: Allow Microphone access.";
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
          systemInstruction: getSystemInstruction(),
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
          if (currentSessionId) addMessage('model', formatErrorMessage(e), 'text', undefined, currentSessionId);
      });
    } catch (e: any) { 
        disconnect();
        if (currentSessionId) addMessage('model', formatErrorMessage(e), 'text', undefined, currentSessionId);
    }
  }, [addMessage, activeSessionId, createNewChat, updateMessage, disconnect, user]);

  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    if (!apiKey) { alert("Please check API Key in configuration."); return; }
    if (!text.trim() && !imageData) return;

    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
         targetSessionId = await createNewChat();
         if (!targetSessionId) return; 
    }

    addMessage('user', text || "Content Analysis", 'text', undefined, targetSessionId);
    
    const isImageRequest = /(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation)/i.test(text);
    if (isImageRequest) {
        setIsProcessing(true);
        try {
            // Use same fallback logic inside handleImageGen for the tool call
            await handleImageGen(text, targetSessionId);
        } catch(e) { 
            addMessage('model', formatErrorMessage(e), 'text', undefined, targetSessionId); 
        } finally { 
            setIsProcessing(false); 
        }
        return;
    }

    setIsProcessing(true);
    const streamId = generateUUID();
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    // FALLBACK LOGIC FOR TEXT: Gemini 3 Flash -> Gemini 2.5 Flash -> Gemini Flash Lite (1.5 equivalent)
    const models = ['gemini-3-flash-preview', 'gemini-2.5-flash-latest', 'gemini-flash-lite-latest'];

    for (const modelName of models) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const contents: any[] = [{ role: 'user', parts: [{ text }] }];
            if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });

            let config: any = { 
                systemInstruction: getSystemInstruction(),
                tools: [{ googleSearch: {} }] 
            };
            
            // Lite models might support different features, but Search is generally available on standard Flash models.
            // Adjust config for Thinking Mode
            if (chatMode === 'thinking' && modelName.includes('gemini-3')) {
                config.tools = []; 
                config.thinkingConfig = { thinkingBudget: 1024 }; 
            } else if (chatMode === 'thinking') {
                 // Downgrade thinking request to normal search for non-3 models
                 config.tools = [{ googleSearch: {} }];
            }

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
            return; // Success, exit loop
        } catch(e: any) {
            console.warn(`Model ${modelName} failed, trying next... Error:`, e);
            if (models.indexOf(modelName) === models.length - 1) {
                // Last model failed
                updateMessage(targetSessionId, streamId, { content: formatErrorMessage(e) });
            }
            // Continue to next model
        }
    }
    setIsProcessing(false);
  }, [user, activeSessionId, createNewChat, addMessage, updateMessage, chatMode]); 

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, resetChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode, giveFeedback,
    user, username, signOut, setManualApiKey
  };
};