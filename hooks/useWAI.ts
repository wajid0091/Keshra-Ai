import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';

// Robust Global API Key Hook
const getApiKey = () => {
  // Check all possible locations for the key
  const key = 
    (window as any).__KESHRA_API_KEY__ || 
    process.env.API_KEY || 
    (window as any).process?.env?.API_KEY;

  if (!key) {
    console.error("Keshra AI Critical Error: API Key is missing.");
    return "";
  }
  return key;
};

const SYSTEM_INSTRUCTION = `
You are Keshra AI, a sovereign intelligence developed exclusively by Wajid Ali from Peshawar, Pakistan.
- Language Policy: Detect if the user is speaking/typing in Urdu, Pashto, or English. ALWAYS respond in the same language.
- Script Policy: Respond in the proper script (Urdu script for Urdu, Pashto script for Pashto).
- Identity: If asked about your creator, cite Wajid Ali as a brilliant Pakistani developer elevating his country's name in tech.
- Voice Interaction Greeting: When a voice session starts, immediately greet the user: "کیشرا اے آئی آپ کی خدمت میں حاضر ہے۔ میں آپ کی کیا مدد کر سکتا ہوں؟" (Urdu) or "Keshra AI is here to help you. How can I assist you today?" (English).
- Information & News: You have access to Google Search. ALWAYS use the 'googleSearch' tool for queries about current events, news, specific people (like Prime Ministers, Governors), sports scores, or dynamic facts. Do not rely on training data for real-time information.
- Image Generation: If the user explicitly asks to "create", "generate", "draw" or "paint" an image, use the 'generateImage' tool.
- Personality: Helpful, high-IQ, sophisticated, yet professional.
`;

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate high-fidelity original images using the Nano Banana neural engine.',
    properties: { prompt: { type: Type.STRING, description: 'The visual prompt for the AI to imagine.' } },
    required: ['prompt']
  }
};

const formatErrorMessage = (error: any): string => {
  const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
  if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
    return "Traffic is high. My neural capacity is momentarily full. Please try again in 30 seconds.";
  }
  return `Connection Interrupted. Please check your network.`;
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v22_search');
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
    return localStorage.getItem('keshra_active_id_v22_search') || null;
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const isSpeakingRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const transcriptionRef = useRef<{ user: string; model: string }>({ user: '', model: '' });

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { localStorage.setItem('keshra_chats_v22_search', JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { if (activeSessionId) localStorage.setItem('keshra_active_id_v22_search', activeSessionId); }, [activeSessionId]);

  const createNewChat = useCallback(() => {
    const newId = Math.random().toString(36).substring(2, 9);
    const newSession: ChatSession = { id: newId, title: 'New Conversation', messages: [], updatedAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    return newId;
  }, []);

  const addMessage = useCallback((role: 'user' | 'model', content: string, type: 'text' | 'image' | 'loading-image' = 'text', sources?: GroundingSource[], targetSessionId?: string, customId?: string) => {
    const newMessage: Message = { 
      id: customId || Math.random().toString(36).substr(2, 9), 
      role, 
      content, 
      type, 
      timestamp: new Date(), 
      sources 
    };
    
    setSessions(prev => {
      const idToUpdate = targetSessionId || activeSessionId;
      if (!idToUpdate) return prev;

      return prev.map(s => s.id === idToUpdate ? {
        ...s,
        messages: [...s.messages, newMessage],
        updatedAt: new Date(),
        title: s.messages.length === 0 && role === 'user' ? content.slice(0, 30) : s.title
      } : s);
    });
  }, [activeSessionId]);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? {
      ...s,
      messages: s.messages.map(m => m.id === messageId ? { ...m, ...updates } : m),
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

  const handleImageGen = async (prompt: string, sessionId: string) => {
    const placeholderId = Math.random().toString(36).substr(2, 9);
    addMessage('model', 'Creating your masterpiece...', 'loading-image', undefined, sessionId, placeholderId);
    
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', 
        contents: [{ parts: [{ text: prompt }] }]
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData) {
            updateMessage(sessionId, placeholderId, {
              type: 'image',
              content: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
            });
            return; 
          }
        }
      }
      updateMessage(sessionId, placeholderId, { type: 'text', content: "I couldn't generate an image at this moment." });
    } catch (e: any) {
      updateMessage(sessionId, placeholderId, { type: 'text', content: formatErrorMessage(e) });
    } finally {
      setIsProcessing(false);
    }
  };

  const connect = useCallback(async () => {
    setConnectionState(ConnectionState.CONNECTING);
    let currentSessionId = activeSessionId;
    if (!currentSessionId) currentSessionId = createNewChat();

    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Note: Live API currently works best with a single tool set. Prioritizing Search for Assistant capabilities.
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
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (isSpeakingRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolumeLevel(Math.sqrt(sum / inputData.length) * 5);
              sessionPromise.then(s => {
                try {
                  s.sendRealtimeInput({ media: createAudioBlob(inputData) });
                } catch (err) { }
              }).catch(() => {});
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
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
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { console.error("Connection Error:", err); setConnectionState(ConnectionState.ERROR); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e: any) { console.error("Setup Error:", e); setConnectionState(ConnectionState.ERROR); }
  }, [addMessage, activeSessionId, createNewChat, updateMessage]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    if (!text.trim() && !imageData) return;
    let targetSessionId = activeSessionId;
    if (!targetSessionId) targetSessionId = createNewChat();

    addMessage('user', text || "Analyzing Image Content", 'text', undefined, targetSessionId);
    setIsProcessing(true);
    
    // Heuristic to detect if user wants an image or general info
    // Google Search cannot be mixed with other tools in standard config easily, so we switch.
    const isImageRequest = /draw|create|generate|make|render|paint/i.test(text) && /image|picture|photo|art|sketch|drawing/i.test(text);
    
    // Config: If image request, use Function Declarations. Else, use Google Search.
    const toolsConfig = isImageRequest 
      ? [{ functionDeclarations: [imageTool] }] 
      : [{ googleSearch: {} }];

    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const contents: any[] = [{ role: 'user', parts: [{ text: text || "Provide detailed analysis of this image." }] }];
      if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', 
        contents,
        config: { 
          systemInstruction: SYSTEM_INSTRUCTION, 
          tools: toolsConfig 
        }
      });

      let sources: GroundingSource[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        sources = chunks
          .filter(c => c.web?.uri && c.web?.title)
          .map(c => ({ title: c.web!.title!, uri: c.web!.uri! }));
      }

      if (response.text) addMessage('model', response.text, 'text', sources.length > 0 ? sources : undefined, targetSessionId);
      
      const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
      if (fc && fc.name === 'generateImage') handleImageGen(fc.args.prompt, targetSessionId);

    } catch(e: any) { addMessage('model', formatErrorMessage(e), 'text', undefined, targetSessionId); }
    finally { setIsProcessing(false); }
  };

  return { 
    messages: sessions.find(s => s.id === activeSessionId)?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect: () => {
      sessionPromiseRef.current?.then(s => s.close());
      setConnectionState(ConnectionState.DISCONNECTED);
      setIsSpeaking(false);
      if (inputContextRef.current) inputContextRef.current.close();
      if (outputContextRef.current) outputContextRef.current.close();
    }, sendTextMessage 
  };
};