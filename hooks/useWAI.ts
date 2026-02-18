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
const getApiKey = (): string => {
  // Try Vite Env
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OPENROUTER_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_OPENROUTER_API_KEY;
  }
  
  // Try Process Env
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.VITE_OPENROUTER_API_KEY) {
      // @ts-ignore
      return process.env.VITE_OPENROUTER_API_KEY;
  }

  // Fallback for user convenience in this specific environment if they haven't set it yet
  // Ideally this should be empty and force the user to set it
  return "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"; 
};

const getSystemInstruction = () => `
You are Keshra AI, developed by Wajid Ali from Peshawar, Pakistan.
Current Time: ${new Date().toLocaleString()}.

**IDENTITY & RULES:**
1. **Name:** Keshra AI.
2. **Creator:** Wajid Ali (Peshawar).
3. **Model Integrity:** You must NEVER mention you are Llama, Qwen, or any other model. You are Keshra AI.
4. **Behavior:** Be helpful, intelligent, and respectful.
5. **Donation:** If the user is appreciative, gently mention you are a free tool supported by the community and they can use the "Support Keshra" button.
`;

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
        // Using Pollinations AI for reliable, free, high-quality image generation
        // It requires no API key and is extremely fast
        const encodedPrompt = encodeURIComponent(prompt + " . cinematic, 8k, photorealistic");
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&private=true&enhanced=true&model=flux`;
        
        // We simulate a short delay to make it feel like "processing" and ensure the image URL is ready
        await new Promise(resolve => setTimeout(resolve, 1500));

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

    const utterance = new SpeechSynthesisUtterance(text);
    // Try to find a good voice
    const voices = synthRef.current.getVoices();
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
    recognition.lang = 'en-US'; // Can be dynamic based on preference
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        setConnectionState(ConnectionState.CONNECTED);
        setVolumeLevel(0.5); // Simulate mic activity
    };

    recognition.onend = () => {
        setConnectionState(ConnectionState.DISCONNECTED);
        setVolumeLevel(0);
    };

    recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
            sendTextMessage(transcript);
        }
    };

    recognition.onerror = (event: any) => {
        console.error("Speech error", event.error);
        setConnectionState(ConnectionState.DISCONNECTED);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const connect = useCallback(async () => {
      if (!user) return "LOGIN_REQUIRED";
      startListening();
      return "SUCCESS";
  }, [user, startListening]);

  const disconnect = useCallback(() => {
     if (recognitionRef.current) {
         recognitionRef.current.stop();
     }
     if (synthRef.current) {
         synthRef.current.cancel();
     }
     setConnectionState(ConnectionState.DISCONNECTED);
     setIsSpeaking(false);
  }, []);

  // --- OPENROUTER CHAT LOGIC ---
  const sendTextMessage = useCallback(async (text: string, imageData?: { data: string, mimeType: string }) => {
    const apiKey = getApiKey();
    let targetSessionId = activeSessionId;
    if (!targetSessionId) { targetSessionId = await createNewChat(); if (!targetSessionId) return; }

    if (!text.trim() && !imageData) return;

    addMessage('user', text || "Image Analysis", 'text', undefined, targetSessionId);
    
    // Check if user asked for image
    if (/(?:create|generate|draw|design|make).*(?:image|picture|logo|art|animation|photo)/i.test(text)) {
        handleImageGen(text, targetSessionId);
        return;
    }

    setIsProcessing(true);
    const streamId = generateUUID();
    addMessage('model', '', 'text', undefined, targetSessionId, streamId);

    try {
        // Construct History for Context
        const currentSession = sessions.find(s => s.id === targetSessionId);
        const history = currentSession ? currentSession.messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content
        })) : [];
        
        // Add current message if not in history yet
        if (history.length === 0 || history[history.length - 1].content !== text) {
             history.push({ role: 'user', content: text });
        }

        // Add System Prompt
        history.unshift({ role: 'system', content: getSystemInstruction() });

        // Using standard fetch for OpenRouter
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": window.location.origin, // Required by OpenRouter
                "X-Title": "Keshra AI", // Required by OpenRouter
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // Using the requested high-intelligence free model
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: history,
                temperature: 0.7,
                max_tokens: 1000,
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const reply = data.choices[0]?.message?.content || "No response.";
        
        updateMessage(targetSessionId, streamId, { content: reply });
        persistMessageUpdate(streamId, { content: reply });
        
        // Speak response if in voice mode (simulated by checking if we just used voice, 
        // but for now we just speak if the response is short enough or user requested)
        if (connectionState === ConnectionState.CONNECTED) {
            speakText(reply);
        }

    } catch(e: any) {
        console.error("OpenRouter Error:", e);
        updateMessage(targetSessionId, streamId, { content: "⚠️ System Update: Reconnecting to Neural Network... (Please try again)" });
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