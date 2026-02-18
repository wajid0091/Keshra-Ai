import { useState, useRef, useCallback, useEffect } from 'react';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
import { supabase } from '../lib/supabase';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';

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

// --- API KEY STRATEGY ---
const getOpenRouterKey = (): string | null => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OPENROUTER_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_OPENROUTER_API_KEY;
  }
  return null;
};

const getGeminiKey = (): string | null => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_GEMINI_API_KEY;
  }
  return null;
};

const getSystemInstruction = () => `
You are Keshra AI, developed by Wajid Ali from Peshawar, Pakistan.
Current Time: ${new Date().toLocaleString()}.

**IDENTITY & RULES:**
1. **Name:** Keshra AI.
2. **Creator:** Wajid Ali (Peshawar).
3. **Model Integrity:** You must NEVER mention you are Llama, Qwen, Nvidia or any other model. You are Keshra AI.
4. **Behavior:** Be helpful, intelligent, and respectful.
5. **Language Priority:** 
   - If user speaks/types in URDU, reply in URDU.
   - If user speaks/types in PASHTO, reply in PASHTO.
   - If user speaks/types in ENGLISH, reply in ENGLISH.
6. **Donation:** If the user is appreciative, gently mention you are a free tool supported by the community and they can use the "Support Keshra" button.
`;

// Priority List of Models (Qwen prioritized for Urdu)
const MODELS = [
  "qwen/qwen3-next-80b-a3b-instruct:free", // Best for Urdu/Pashto
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free"
];

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

  // Voice (Gemini Live) Refs
  const isSpeakingRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

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
      try {
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
      } catch (e) { console.error("History load error", e); }
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

  const persistMessageUpdate = useCallback(async (messageId: string, updates: Partial<Message>) => {
      if (!user) return;
      await supabase.from('messages').update({
          content: updates.content,
          type: updates.type,
          sources: updates.sources ? JSON.stringify(updates.sources) : null
      }).eq('id', messageId);
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

  // --- IMAGE GENERATION LOGIC (POLLINATIONS) ---
  const handleImageGen = async (prompt: string, sessionId: string) => {
    const placeholderId = generateUUID();
    addMessage('model', 'Creating your masterpiece...', 'loading-image', undefined, sessionId, placeholderId);
    setIsProcessing(true);
    
    try {
        const seed = Math.floor(Math.random() * 1000000);
        // Using Pollinations because provided OpenRouter models are Text-Only. 
        // This is the most reliable way to get an image.
        const encodedPrompt = encodeURIComponent(prompt + " . cinematic, 8k, photorealistic, high quality, highly detailed");
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&private=true&enhanced=true&model=flux&seed=${seed}`;
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // UX Delay

        updateMessage(sessionId, placeholderId, { type: 'image', content: imageUrl });
        persistMessageUpdate(placeholderId, { type: 'image', content: imageUrl });
    } catch(e: any) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: "Error generating image. Please try again." });
    } finally {
        setIsProcessing(false);
    }
  };

  // --- VOICE LOGIC (GEMINI LIVE API) ---
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
    const geminiKey = getGeminiKey();
    if (!geminiKey) {
        alert("Configuration Error: VITE_GEMINI_API_KEY is missing for Voice Mode.");
        return;
    }
    
    let currentSessionId = activeSessionId;
    if (!currentSessionId) currentSessionId = await createNewChat();
    if (!user) return "LOGIN_REQUIRED"; 
    
    disconnect(); 
    setConnectionState(ConnectionState.CONNECTING);
    
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaStreamRef.current = stream;
    } catch (e: any) { 
        disconnect();
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
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getSystemInstruction(),
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
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
              nextStartTimeRef.current = 0; setIsSpeaking(false);
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
      sessionPromise.catch((e: any) => { disconnect(); });
    } catch (e: any) { disconnect(); }
  }, [activeSessionId, createNewChat, disconnect, user]);

  // --- OPENROUTER CHAT LOGIC (MULTI-MODEL FALLBACK) ---
  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getOpenRouterKey();
    let targetSessionId = activeSessionId;
    if (!targetSessionId) { targetSessionId = await createNewChat(); if (!targetSessionId) return; }

    if (!text.trim() && !imageData) return;

    if (!apiKey) {
        addMessage('model', "⚠️ Configuration Error: VITE_OPENROUTER_API_KEY is missing.", 'text', undefined, targetSessionId);
        return;
    }

    addMessage('user', text || "Image Analysis", 'text', undefined, targetSessionId);
    
    // Intelligent Image Intent Detection
    if (/(?:create|generate|draw|design|make|render).*(?:image|picture|logo|art|animation|photo)/i.test(text)) {
        handleImageGen(text, targetSessionId);
        return;
    }

    setIsProcessing(true);
    const streamId = generateUUID();
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    try {
        const currentSession = sessions.find(s => s.id === targetSessionId);
        const history = currentSession ? currentSession.messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content
        })) : [];
        
        if (history.length === 0 || history[history.length - 1].content !== text) {
             history.push({ role: 'user', content: text });
        }
        history.unshift({ role: 'system', content: getSystemInstruction() });

        // LOOP THROUGH MODELS (Fallback Strategy)
        let success = false;
        let reply = "";

        for (const model of MODELS) {
            try {
                console.log(`Trying model: ${model}`);
                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": window.location.href, 
                        "X-Title": "Keshra AI", 
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: history,
                        temperature: 0.7,
                        max_tokens: 1000,
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    reply = data.choices[0]?.message?.content;
                    if (reply) {
                        success = true;
                        break; 
                    }
                }
            } catch (err) {}
        }

        if (!success || !reply) {
            throw new Error("All models failed to respond.");
        }

        updateMessage(targetSessionId, streamId, { content: reply });
        persistMessageUpdate(streamId, { content: reply });

    } catch(e: any) {
        updateMessage(targetSessionId, streamId, { content: "⚠️ System Busy: Please try again in a moment." });
    } finally {
        setIsProcessing(false);
    }

  }, [user, activeSessionId, createNewChat, addMessage, updateMessage, sessions, persistMessageUpdate, connectionState]); 

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, resetChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode, giveFeedback, user, username, signOut, setManualApiKey
  };
};