import { useState, useRef, useCallback, useEffect } from 'react';
import { ConnectionState, Message, GroundingSource, ChatSession, ChatMode } from '../types';
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

// --- API KEY STRATEGY ---
const getApiKey = (): string | null => {
  // 1. Try Vite Env (Most reliable for this setup)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OPENROUTER_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_OPENROUTER_API_KEY;
  }
  
  // 2. Try Process Env (Fallback)
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.VITE_OPENROUTER_API_KEY) {
      // @ts-ignore
      return process.env.VITE_OPENROUTER_API_KEY;
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
5. **Language:** If the user speaks Urdu/Pashto, reply in that language.
6. **Donation:** If the user is appreciative, gently mention you are a free tool supported by the community and they can use the "Support Keshra" button.
`;

// Priority List of Models
const MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free"
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

  // Speech Recognition Refs
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const isIntentionalStop = useRef(false);

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
        const encodedPrompt = encodeURIComponent(prompt + " . cinematic, 8k, photorealistic, high quality, highly detailed");
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&private=true&enhanced=true&model=flux&seed=${seed}`;
        
        // Short delay for UX
        await new Promise(resolve => setTimeout(resolve, 2000));

        updateMessage(sessionId, placeholderId, { type: 'image', content: imageUrl });
        persistMessageUpdate(placeholderId, { type: 'image', content: imageUrl });
    } catch(e: any) {
        updateMessage(sessionId, placeholderId, { type: 'text', content: "Error generating image. Please try again." });
    } finally {
        setIsProcessing(false);
    }
  };

  // --- VOICE LOGIC (BROWSER NATIVE) ---
  const speakText = (text: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();

    // Remove markdown symbols for cleaner speech
    const cleanText = text.replace(/\*/g, '').replace(/#/g, '').replace(/`/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    const voices = synthRef.current.getVoices();
    // Prioritize high quality English voices or fallback
    const preferredVoice = voices.find(v => v.name.includes("Google US English") || v.name.includes("Samantha")) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.onstart = () => { setIsSpeaking(true); setVolumeLevel(0.8); };
    utterance.onend = () => { setIsSpeaking(false); setVolumeLevel(0); };
    utterance.onerror = () => { setIsSpeaking(false); };
    
    synthRef.current.speak(utterance);
  };

  const startListening = useCallback(async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice not supported in this browser. Please use Chrome.");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US'; 
    recognition.continuous = false; // We restart manually to avoid timeout issues
    recognition.interimResults = false;

    recognition.onstart = () => {
        setConnectionState(ConnectionState.CONNECTED);
        setVolumeLevel(0.5); 
    };

    recognition.onend = () => {
        // Auto-restart if it wasn't an intentional stop
        if (!isIntentionalStop.current && connectionState === ConnectionState.CONNECTED) {
            try {
                recognition.start();
            } catch (e) {
                setConnectionState(ConnectionState.DISCONNECTED);
                setVolumeLevel(0);
            }
        } else {
            setConnectionState(ConnectionState.DISCONNECTED);
            setVolumeLevel(0);
        }
    };

    recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
            sendTextMessage(transcript);
        }
    };

    recognition.onerror = (event: any) => {
        console.error("Speech error", event.error);
        if (event.error === 'not-allowed') {
            isIntentionalStop.current = true;
            setConnectionState(ConnectionState.DISCONNECTED);
        }
    };

    recognitionRef.current = recognition;
    isIntentionalStop.current = false;
    recognition.start();
  }, [connectionState]);

  const connect = useCallback(async () => {
      if (!user) return "LOGIN_REQUIRED";
      startListening();
      return "SUCCESS";
  }, [user, startListening]);

  const disconnect = useCallback(() => {
     isIntentionalStop.current = true;
     if (recognitionRef.current) {
         recognitionRef.current.stop();
     }
     if (synthRef.current) {
         synthRef.current.cancel();
     }
     setConnectionState(ConnectionState.DISCONNECTED);
     setIsSpeaking(false);
  }, []);

  // --- OPENROUTER CHAT LOGIC (MULTI-MODEL FALLBACK) ---
  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    let targetSessionId = activeSessionId;
    if (!targetSessionId) { targetSessionId = await createNewChat(); if (!targetSessionId) return; }

    if (!text.trim() && !imageData) return;

    // Check for missing API Key immediately
    if (!apiKey) {
        addMessage('model', "⚠️ Configuration Error: API Key is missing. Please set VITE_OPENROUTER_API_KEY in your environment variables.", 'text', undefined, targetSessionId);
        return;
    }

    addMessage('user', text || "Image Analysis", 'text', undefined, targetSessionId);
    
    if (/(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation|photo)/i.test(text)) {
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
                        break; // Exit loop on success
                    }
                } else {
                    console.warn(`Model ${model} failed with status ${response.status}`);
                }
            } catch (err) {
                console.warn(`Model ${model} network error`, err);
            }
        }

        if (!success || !reply) {
            throw new Error("All models failed to respond.");
        }

        updateMessage(targetSessionId, streamId, { content: reply });
        persistMessageUpdate(streamId, { content: reply });
        
        if (connectionState === ConnectionState.CONNECTED) {
            speakText(reply);
        }

    } catch(e: any) {
        console.error("OpenRouter Final Error:", e);
        updateMessage(targetSessionId, streamId, { content: "⚠️ Keshra Server Busy: I am currently experiencing high traffic. Please try again in a few seconds." });
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