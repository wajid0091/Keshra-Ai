import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';

// --- Robust API Key Retrieval ---
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
1. **Chat & Coding:** Provide clear, concise answers. When writing code, use proper markdown code blocks (e.g., \`\`\`python).
2. **Real-time Info:** Use 'googleSearch' for news, weather, sports.
3. **Image Generation:** IF the user asks to "create", "draw", "generate", "design", or "make" an image or animation, you MUST call the 'generateImage' tool.

**IMPORTANT BEHAVIORAL RULE:**
- Do **NOT** start every response with "Keshra AI is here to help" or "I am ready to assist".
- Only introduce yourself if explicitly asked "Who are you?" or "Who made you?".
- Otherwise, answer the user's question directly and professionally.

**IDENTITY:**
- Creator: Wajid Ali (Pakistani developer).
- Voice Greeting (Only if asked): "کیشرا اے آئی آپ کی خدمت میں حاضر ہے۔" (Urdu) or "Keshra AI is here to help you." (English).
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
  console.error("Raw AI Error:", error);
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  
  try {
    return JSON.stringify(error);
  } catch (e) {
    return String(error);
  }
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v26_stable');
    if (!saved) return [];
    try {
      return JSON.parse(saved).map((s: any) => ({
        ...s,
        messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
        updatedAt: new Date(s.updatedAt)
      }));
    } catch { return []; }
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem('keshra_active_id_v26_stable') || null;
  });

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
  
  // CRITICAL FIX: Robust localStorage saving using WeakSet to handle any circular references
  useEffect(() => { 
    try {
      const seen = new WeakSet();
      const serialized = JSON.stringify(sessions, (key, value) => {
        if (typeof value === "object" && value !== null) {
            // Check for circular reference
            if (seen.has(value)) return;
            seen.add(value);
            
            // Check for DOM nodes or React Internals
            if (key.startsWith('_') || value instanceof HTMLElement || (value && value.nativeEvent)) return undefined;
        }
        return value;
      });
      localStorage.setItem('keshra_chats_v26_stable', serialized); 
    } catch (e) {
      console.error("Failed to save chat history (Circular Reference Detected):", e);
    }
  }, [sessions]);
  
  useEffect(() => { if (activeSessionId) localStorage.setItem('keshra_active_id_v26_stable', activeSessionId); }, [activeSessionId]);

  const createNewChat = useCallback(() => {
    const newId = Math.random().toString(36).substring(2, 9);
    const newSession: ChatSession = { id: newId, title: 'New Conversation', messages: [], updatedAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    return newId;
  }, []);

  const addMessage = useCallback((role: 'user' | 'model', content: string, type: 'text' | 'image' | 'loading-image' = 'text', sources?: GroundingSource[], targetSessionId?: string, customId?: string) => {
    // CRITICAL FIX: Ensure content is a primitive string
    const safeContent = (typeof content === 'string' || typeof content === 'number') ? String(content) : "Content Error";
    
    // CRITICAL FIX: Manually map sources to primitive objects to avoid circular references from API responses
    const safeSources = sources ? sources.map(s => ({ title: String(s.title || ''), uri: String(s.uri || '') })) : undefined;

    const newMessage: Message = { 
      id: customId || Math.random().toString(36).substr(2, 9), 
      role, 
      content: safeContent, 
      type, 
      timestamp: new Date(), 
      sources: safeSources
    };
    
    setSessions(prev => {
      const idToUpdate = targetSessionId || activeSessionId;
      if (!idToUpdate) return prev;

      return prev.map(s => s.id === idToUpdate ? {
        ...s,
        messages: [...s.messages, newMessage],
        updatedAt: new Date(),
        title: s.messages.length === 0 && role === 'user' ? safeContent.slice(0, 30) : s.title
      } : s);
    });
  }, [activeSessionId]);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
    // CRITICAL FIX: Whitelist update properties
    const cleanUpdates: Partial<Message> = {};
    if (updates.content !== undefined) cleanUpdates.content = String(updates.content);
    if (updates.type !== undefined) cleanUpdates.type = updates.type;
    if (updates.feedback !== undefined) cleanUpdates.feedback = updates.feedback;
    
    // Safely copy sources if present
    if (updates.sources !== undefined) {
        cleanUpdates.sources = updates.sources.map(s => ({ title: String(s.title || ''), uri: String(s.uri || '') }));
    }

    setSessions(prev => prev.map(s => s.id === sessionId ? {
      ...s,
      messages: s.messages.map(m => m.id === messageId ? { ...m, ...cleanUpdates } : m),
      updatedAt: new Date()
    } : s));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  }, [activeSessionId]);

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

    // Enhanced prompt engineering: Stronger focus on Realistic Peshawar City, History, and Cinematic Quality
    const enhancedPrompt = `${prompt} . Hyper-realistic cinematic shot of Peshawar City, Pakistan. Featuring the majestic Bala Hissar Fort, historical Qissa Khwani Bazaar, and the Khyber Pass. Golden hour lighting, 8k resolution, intricate architectural details, vibrant culture, dramatic mountains in the background, photorealistic masterpiece, national geographic style.`;

    try {
      // 1. Try Gemini 2.5 Flash Image first
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
        // console.warn("Gemini 2.5 failed, trying Imagen 3...", err);
        // 2. Fallback to Imagen 3.0
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
    // Graceful cleanup to prevent black screens/crashes
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(s => s.close()).catch(e => console.warn("Session close error:", e));
        sessionPromiseRef.current = null;
    }
    
    // Stop Media Tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
          try { track.stop(); } catch(e) {}
      });
      mediaStreamRef.current = null;
    }

    // Close Audio Contexts
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
    if (!currentSessionId) currentSessionId = createNewChat();

    if (!apiKey) { 
        addMessage('model', "System Error: API Key Missing. Please check configuration.", 'text', undefined, currentSessionId);
        return; 
    }

    disconnect(); // Ensure clean slate

    setConnectionState(ConnectionState.CONNECTING);
    
    // ------------------------------------------------------------------
    // 1. BROWSER MEDIA PERMISSIONS (Microphone)
    // ------------------------------------------------------------------
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
         throw new Error("Microphone access is not supported in this browser.");
      }

      // Try optimal constraints first
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { 
              echoCancellation: true, 
              noiseSuppression: true, 
              autoGainControl: true
          } 
        });
      } catch (err) {
        console.warn("Optimal audio constraints failed, falling back to basic audio.", err);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaStreamRef.current = stream;

    } catch (e: any) { 
        console.error("Browser Media Error:", e);
        disconnect();
        
        let errorMsg = "Microphone access failed.";
        const errStr = String(e).toLowerCase();
        const name = e.name || '';

        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || errStr.includes('permission denied')) {
            errorMsg = "Browser Permission Denied: Please click the lock icon in your address bar and allow Microphone access.";
        } else if (name === 'NotFoundError' || errStr.includes('found')) {
             errorMsg = "Hardware Error: No microphone found. Please connect a microphone.";
        } else {
            errorMsg = `Browser Audio Error: ${formatErrorMessage(e)}`;
        }

        addMessage('model', errorMsg, 'text', undefined, currentSessionId!);
        setConnectionState(ConnectionState.DISCONNECTED);
        return; // STOP execution if Media fails
    }

    // ------------------------------------------------------------------
    // 2. AUDIO CONTEXT SETUP (Only proceeds if Media was successful)
    // ------------------------------------------------------------------
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
        addMessage('model', "System Error: AudioContext could not be initialized.", 'text', undefined, currentSessionId!);
        setConnectionState(ConnectionState.DISCONNECTED);
        return;
    }

    // ------------------------------------------------------------------
    // 3. API CONNECTION (Gemini Live)
    // ------------------------------------------------------------------
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
            } catch (audioErr) {
                console.error("Audio Processing Error", audioErr);
            }
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
              const { user, model } = transcriptionRef.current;
              if (user.trim()) addMessage('user', user, 'text', undefined, currentSessionId!);
              if (model.trim()) addMessage('model', model, 'text', undefined, currentSessionId!);
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
          onclose: () => { 
              setConnectionState(ConnectionState.DISCONNECTED); 
              setIsSpeaking(false); 
          },
          onerror: (err: any) => { 
              console.error("Session Error:", err);
              setConnectionState(ConnectionState.DISCONNECTED);
              addMessage('model', "Voice Uplink Interrupted: Connection lost.", 'text', undefined, currentSessionId!);
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
      
      // Catch initial connection errors (e.g. 403 Forbidden on Socket Handshake)
      sessionPromise.catch((e: any) => {
          console.error("API Connect Catch:", e);
          disconnect();
          const errStr = String(e).toLowerCase();
          let errorMsg = "System Error: Unable to establish Voice Uplink.";
          if (errStr.includes('permission') || errStr.includes('403')) {
             errorMsg = "Access Denied: The API Key is invalid or lacks permission for 'gemini-2.5-flash-native-audio-preview'.";
          }
          addMessage('model', errorMsg, 'text', undefined, currentSessionId!);
          setConnectionState(ConnectionState.DISCONNECTED);
      });

    } catch (e: any) { 
        console.error("General Connect Exception:", e);
        disconnect();
        addMessage('model', `System Error: ${formatErrorMessage(e)}`, 'text', undefined, currentSessionId!);
        setConnectionState(ConnectionState.DISCONNECTED); 
    }
  }, [addMessage, activeSessionId, createNewChat, updateMessage, disconnect]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    if (!apiKey) { alert("API Key Missing"); return; }
    if (!text.trim() && !imageData) return;

    let targetSessionId = activeSessionId;
    if (!targetSessionId) targetSessionId = createNewChat();

    addMessage('user', text || "Content Analysis", 'text', undefined, targetSessionId);
    
    // Check for Image Request - Broader regex to catch "Make Animation" as image request intent
    const isImageRequest = /(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation)/i.test(text);
    
    if (isImageRequest) {
        setIsProcessing(true);
        try {
            const ai = new GoogleGenAI({ apiKey });
            // Using a tool-based approach to confirm intent and get prompt
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ role: 'user', parts: [{ text }] }],
                config: { tools: [{ functionDeclarations: [imageTool] }] }
            });
            const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
            if (fc && fc.name === 'generateImage') {
                await handleImageGen(fc.args.prompt, targetSessionId);
            } else {
                // If it didn't call the tool, just display the text response (e.g. "I can't do animations but here is an image...")
                addMessage('model', response.text || "I couldn't process the image request.", 'text', undefined, targetSessionId);
            }
        } catch(e) { addMessage('model', `System Error: ${formatErrorMessage(e)}`, 'text', undefined, targetSessionId); }
        finally { setIsProcessing(false); }
        return;
    }

    // NORMAL TEXT / CHAT REQUEST
    setIsProcessing(true);
    const streamId = Math.random().toString(36).substr(2, 9);
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    try {
        const ai = new GoogleGenAI({ apiKey });
        const contents: any[] = [{ role: 'user', parts: [{ text }] }];
        if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });

        let config: any = { systemInstruction: SYSTEM_INSTRUCTION };
        
        let modelName = 'gemini-3-flash-preview';

        if (chatMode === 'search') {
            config.tools = [{ googleSearch: {} }];
        } else if (chatMode === 'thinking') {
             config.thinkingConfig = { thinkingBudget: 1024 }; 
        }

        const result = await ai.models.generateContentStream({
            model: modelName,
            contents,
            config
        });

        let accumulatedText = '';
        let sources: GroundingSource[] = [];

        // Hybrid approach to handle potentially different SDK versions (iterable vs .stream property)
        let streamIterable: any = result;
        // @ts-ignore
        if (!result[Symbol.asyncIterator] && result.stream) {
            // @ts-ignore
            streamIterable = result.stream;
        }

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
  };

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode,
    giveFeedback // Export feedback function
  };
};