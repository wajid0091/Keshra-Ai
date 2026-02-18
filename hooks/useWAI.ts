import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { supabase } from '../lib/supabase';

// --- UTILITIES ---
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// --- ULTIMATE KEY HUNTER ---
// This specifically targets the variable name 'VITE_API_KEY' which works best on Netlify
const getApiKey = (): string => {
  // 1. Priority: VITE_API_KEY (The Standard for this App)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_API_KEY;
  }
  
  // 2. Fallback: REACT_APP_API_KEY (If using older build tools)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.REACT_APP_API_KEY) {
      // @ts-ignore
      return import.meta.env.REACT_APP_API_KEY;
  }

  // 3. Fallback: API_KEY (Local dev or Node context)
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      // @ts-ignore
      return process.env.API_KEY;
  }

  return "";
};

const getSystemInstruction = () => `
You are Keshra AI, developed by Wajid Ali from Peshawar, Pakistan.
Current Time: ${new Date().toLocaleString()}.

**MANDATES:**
1. **Real-time Info:** Use 'googleSearch' for ANY query about news, dates, weather, or current events.
2. **Identity:** You are Keshra AI. Creator: Wajid Ali (Peshawar).
3. **Images:** If asked to generate/create visuals, call 'generateImage'.
`;

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generates an image.',
    properties: { prompt: { type: Type.STRING, description: 'Image description' } },
    required: ['prompt']
  }
};

const formatErrorMessage = (error: any): string => {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();
  
  if (lowerMsg.includes('api key') || lowerMsg.includes('unauthenticated') || lowerMsg.includes('400')) {
      return "⚠️ Configuration Error: API Key not found. Please go to Netlify -> Site Settings -> Environment Variables and add 'VITE_API_KEY'.";
  }
  if (lowerMsg.includes('quota') || lowerMsg.includes('limit') || lowerMsg.includes('429')) {
      return "⚠️ System Busy: Switching to backup model...";
  }
  return "⚠️ Connection Error: Please check your internet.";
};

export const useWAI = () => {
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState<string>('');
  
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

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.username) setUsername(session.user.user_metadata.username);
      else if (session?.user?.email) setUsername(session.user.email.split('@')[0]);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.user_metadata?.username) setUsername(session.user.user_metadata.username);
      else if (session?.user?.email) setUsername(session.user.email.split('@')[0]);
      if (!session) { setSessions([]); setActiveSessionId(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // History
  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      const { data: chatData } = await supabase.from('chats').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      const loadedSessions: ChatSession[] = [];
      if (chatData) {
          for (const chat of chatData) {
              const { data: msgData } = await supabase.from('messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true });
              loadedSessions.push({
                  id: chat.id, title: chat.title || 'New Conversation', updatedAt: new Date(chat.updated_at),
                  messages: (msgData || []).map((m: any) => ({
                      id: m.id, role: m.role, content: m.content, type: m.type, timestamp: new Date(m.created_at),
                      sources: typeof m.sources === 'string' ? JSON.parse(m.sources) : m.sources, feedback: m.feedback
                  }))
              });
          }
      }
      setSessions(loadedSessions);
      if (loadedSessions.length > 0 && !activeSessionId) setActiveSessionId(loadedSessions[0].id);
    };
    loadData();
  }, [user]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);
  const resetChat = useCallback(() => { setActiveSessionId(null); }, []);
  const setManualApiKey = (key: string) => { /* No-op */ };

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
        const { data, error } = await supabase.from('chats').insert([{ user_id: user.id, title: 'New Conversation' }]).select().single();
        if (error || !data) return createLocalSession();
        const newSession: ChatSession = { id: data.id, title: data.title, messages: [], updatedAt: new Date(data.created_at) };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(data.id);
        return data.id;
    } catch (e) { return createLocalSession(); }
  }, [user]);

  const addMessage = useCallback(async (role: 'user' | 'model', content: string, type: 'text' | 'image' | 'loading-image' = 'text', sources?: GroundingSource[], targetSessionId?: string, customId?: string) => {
    const safeContent = (typeof content === 'string' || typeof content === 'number') ? String(content) : "Content Error";
    const msgId = customId || generateUUID();
    const newMessage: Message = { id: msgId, role, content: safeContent, type, timestamp: new Date(), sources };
    let actualSessionId = targetSessionId || activeSessionId;
    if (!actualSessionId) {
         const newId = await createNewChat(); 
         if (newId) actualSessionId = newId; else return; 
    }
    setSessions(prev => {
      const sessionExists = prev.some(s => s.id === actualSessionId);
      if (!sessionExists) return [{ id: actualSessionId!, title: safeContent.slice(0, 30) || 'New Conversation', messages: [newMessage], updatedAt: new Date() }, ...prev];
      return prev.map(s => s.id === actualSessionId ? { ...s, messages: [...s.messages, newMessage], updatedAt: new Date(), title: s.messages.length === 0 && role === 'user' ? safeContent.slice(0, 30) : s.title } : s);
    });
    if (user && actualSessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualSessionId)) {
        supabase.from('messages').insert([{ id: msgId, chat_id: actualSessionId, user_id: user.id, role, content: safeContent, type, sources: sources ? JSON.stringify(sources) : null }]).then(({ error }) => { if (error) console.error(error); });
        if (role === 'user') {
            const session = sessions.find(s => s.id === actualSessionId);
            if (!session || session.messages.length === 0) supabase.from('chats').update({ title: safeContent.slice(0, 30) }).eq('id', actualSessionId).then();
        }
    }
  }, [activeSessionId, user, sessions, createNewChat]);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: s.messages.map(m => m.id === messageId ? { ...m, ...updates } : m), updatedAt: new Date() } : s));
  }, []);

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
    addMessage('model', 'Processing visuals...', 'loading-image', undefined, sessionId, placeholderId);
    setIsProcessing(true);
    
    const apiKey = getApiKey();
    if (!apiKey) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: "⚠️ Configuration Error: API Key missing. Please set 'VITE_API_KEY' in Netlify Environment Variables." });
        setIsProcessing(false);
        return;
    }
    const ai = new GoogleGenAI({ apiKey });
    const enhancedPrompt = `${prompt} . Cinematic, 8k, photorealistic.`;

    // --- FALLBACK CHAIN FOR IMAGES ---
    // 1. Pro (Best) -> 2. Flash (Fast) -> 3. Imagen (Legacy/Backup)
    const geminiModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

    for (const model of geminiModels) {
        try {
            const response = await ai.models.generateContent({ model, contents: [{ parts: [{ text: enhancedPrompt }] }] });
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
        } catch (e) { console.warn(`Model ${model} failed, switching...`); }
    }

    // Last Resort: Imagen
    try {
        const response = await ai.models.generateImages({ model: 'imagen-3.0-generate-001', prompt: enhancedPrompt, config: { numberOfImages: 1, aspectRatio: '1:1', outputMimeType: 'image/jpeg' } });
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
    if (sessionPromiseRef.current) { sessionPromiseRef.current.then(s => s.close()).catch(() => {}); sessionPromiseRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }
    if (inputContextRef.current) { inputContextRef.current.close(); inputContextRef.current = null; }
    if (outputContextRef.current) { outputContextRef.current.close(); outputContextRef.current = null; }
    audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} }); audioSources.current.clear();
    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false); setIsProcessing(false); setVolumeLevel(0);
  }, []);

  const connect = useCallback(async () => {
    const apiKey = getApiKey();
    let currentSessionId = activeSessionId;
    if (!currentSessionId) currentSessionId = await createNewChat();
    if (!user) return "LOGIN_REQUIRED"; 
    
    // STRICT: Must have key to start voice
    if (!apiKey) {
        if (currentSessionId) addMessage('model', "⚠️ Configuration Error: API Key missing. Please set VITE_API_KEY in Netlify.", 'text', undefined, currentSessionId);
        return;
    }

    disconnect(); 
    setConnectionState(ConnectionState.CONNECTING);
    
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaStreamRef.current = stream;
    } catch (e: any) { 
        disconnect();
        if (currentSessionId) addMessage('model', "Microphone access denied.", 'text', undefined, currentSessionId);
        setConnectionState(ConnectionState.DISCONNECTED);
        return; 
    }

    let inputCtx: AudioContext;
    let outputCtx: AudioContext;
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        outputCtx = new AudioContextClass({ sampleRate: 24000 });
        inputContextRef.current = inputCtx;
        outputContextRef.current = outputCtx;
    } catch (e) { disconnect(); return; }

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
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (isSpeakingRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0; for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolumeLevel(Math.min(Math.sqrt(sum / inputData.length) * 10, 1)); 
              sessionPromise.then(s => s.sendRealtimeInput({ media: createAudioBlob(inputData) })).catch(() => {});
            };
            source.connect(processor); processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
              audioSources.current.forEach(s => s.stop()); audioSources.current.clear();
              nextStartTimeRef.current = 0; setIsSpeaking(false); transcriptionRef.current = { user: '', model: '' };
            }
            if (msg.serverContent?.inputTranscription?.text) transcriptionRef.current.user += msg.serverContent.inputTranscription.text;
            if (msg.serverContent?.outputTranscription?.text) transcriptionRef.current.model += msg.serverContent.outputTranscription.text;
            if (msg.serverContent?.turnComplete) {
              const { user: tUser, model: tModel } = transcriptionRef.current;
              if (tUser.trim()) addMessage('user', tUser, 'text', undefined, currentSessionId!);
              if (tModel.trim()) addMessage('model', tModel, 'text', undefined, currentSessionId!);
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
              source.onended = () => { audioSources.current.delete(source); if (audioSources.current.size === 0) setIsSpeaking(false); };
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { setConnectionState(ConnectionState.DISCONNECTED); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
      sessionPromise.catch((e: any) => { disconnect(); if(currentSessionId) addMessage('model', formatErrorMessage(e), 'text', undefined, currentSessionId); });
    } catch (e: any) { disconnect(); if(currentSessionId) addMessage('model', formatErrorMessage(e), 'text', undefined, currentSessionId); }
  }, [addMessage, activeSessionId, createNewChat, updateMessage, disconnect, user]);

  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    let targetSessionId = activeSessionId;
    if (!targetSessionId) { targetSessionId = await createNewChat(); if (!targetSessionId) return; }

    if (!apiKey) { 
        addMessage('model', "⚠️ Configuration Error: API Key missing. Please set VITE_API_KEY in Netlify.", 'text', undefined, targetSessionId);
        return; 
    }
    if (!text.trim() && !imageData) return;

    addMessage('user', text || "Content Analysis", 'text', undefined, targetSessionId);
    
    // Image Generation Request
    if (/(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation)/i.test(text)) {
        try { await handleImageGen(text, targetSessionId); } catch(e) { addMessage('model', formatErrorMessage(e), 'text', undefined, targetSessionId); } finally { setIsProcessing(false); }
        return;
    }

    setIsProcessing(true);
    const streamId = generateUUID();
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    // --- FALLBACK CHAIN FOR TEXT ---
    // 1. Gemini 3 Flash (Fastest) -> 2. Gemini 2.5 Flash (Backup) -> 3. Flash Lite (Economy)
    const textModels = ['gemini-3-flash-preview', 'gemini-2.5-flash-latest', 'gemini-flash-lite-latest'];

    for (const modelName of textModels) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const contents: any[] = [{ role: 'user', parts: [{ text }] }];
            if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });

            let config: any = { systemInstruction: getSystemInstruction(), tools: [{ googleSearch: {} }] };
            
            // Adjust for Thinking Mode
            if (chatMode === 'thinking' && modelName.includes('gemini-3')) { 
                 config.tools = []; config.thinkingConfig = { thinkingBudget: 1024 }; 
            }

            const result = await ai.models.generateContentStream({ model: modelName, contents, config });
            let accumulatedText = '';
            let sources: GroundingSource[] = [];
            // @ts-ignore
            const stream = result.stream || result;

            for await (const chunk of stream) {
                if (chunk.text) { accumulatedText += chunk.text; updateMessage(targetSessionId, streamId, { content: accumulatedText }); }
                const gChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
                if (gChunks) sources.push(...gChunks.filter((c: any) => c.web?.uri && c.web?.title).map((c: any) => ({ title: c.web.title, uri: c.web.uri })));
            }
            updateMessage(targetSessionId, streamId, { content: accumulatedText, sources: sources.length > 0 ? sources : undefined });
            setIsProcessing(false);
            return; // SUCCESS - Exit function
        } catch(e: any) {
            console.warn(`Model ${modelName} failed, retrying...`);
            // Only show error if LAST model failed
            if (textModels.indexOf(modelName) === textModels.length - 1) {
                updateMessage(targetSessionId, streamId, { content: formatErrorMessage(e) });
            }
        }
    }
    setIsProcessing(false);
  }, [user, activeSessionId, createNewChat, addMessage, updateMessage, chatMode]); 

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, resetChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode, giveFeedback, user, username, signOut, setManualApiKey
  };
};