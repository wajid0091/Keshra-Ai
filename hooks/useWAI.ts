import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';

// Guaranteed API Key Access for Netlify Runtime
const getSafeApiKey = (): string => {
  const hardcoded = "AIzaSyC87rDUm-ibvrAn7V0BlFwIKhY1CviQtAU";
  const envKey = (window as any).process?.env?.API_KEY;
  const globalKey = (window as any).__KESHRA_API_KEY__;
  return envKey || globalKey || hardcoded;
};

const SYSTEM_INSTRUCTION = `
You are Keshra AI, a sovereign intelligence developed exclusively by Wajid Ali from Peshawar, Pakistan.
- Detect the user's language immediately (Urdu, Pashto, or English).
- RESPOND in the user's language script (Urdu script for Urdu, Pashto script for Pashto).
- If asked about your creator, cite Wajid Ali as a brilliant Pakistani developer who is working tirelessly to elevate his country's name in the tech world.
- Use 'generateImage' tool for visual art requests.
- Provide web links in clean lists.
- Maintain a high-IQ, professional, and helpful persona.
`;

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate photorealistic or artistic images based on description.',
    properties: {
      prompt: { type: Type.STRING, description: 'The visual prompt.' }
    },
    required: ['prompt']
  }
};

const formatErrorMessage = (error: any): string => {
  const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
  if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
    return "معذرت، اس وقت میرے ذہانت کی حد (Quota) ختم ہو چکی ہے۔ براہ کرم کچھ دیر بعد دوبارہ کوشش کریں یا واجد علی سے رابطہ کریں۔\n\n(Intelligence limit reached. Please try again in a few minutes.)";
  }
  if (errorStr.includes('API key is missing')) {
    return "اے پی آئی کی (API Key) کا مسئلہ ہے۔ براہ کرم نیٹ لیفی سیٹنگز چیک کریں۔";
  }
  return `Connection Error: ${error.message || "An unexpected neural link failure occurred."}`;
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v19');
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
    return localStorage.getItem('keshra_active_id_v19') || null;
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const isSpeakingRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  useEffect(() => {
    localStorage.setItem('keshra_chats_v19', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem('keshra_active_id_v19', activeSessionId);
  }, [activeSessionId]);

  const addMessage = useCallback((role: 'user' | 'model', content: string, type: 'text' | 'image' = 'text', sources?: GroundingSource[]) => {
    const newMessage: Message = { id: Math.random().toString(36).substr(2, 9), role, content, type, timestamp: new Date(), sources };
    setSessions(prev => {
      let currentId = activeSessionId;
      if (!currentId) return prev;
      return prev.map(s => s.id === currentId ? {
        ...s,
        messages: [...s.messages, newMessage],
        updatedAt: new Date(),
        title: s.messages.length === 0 && role === 'user' ? content.slice(0, 30) : s.title
      } : s);
    });
  }, [activeSessionId]);

  const createNewChat = useCallback(() => {
    const newId = Math.random().toString(36).substring(2, 9);
    const newSession: ChatSession = { id: newId, title: 'New Conversation', messages: [], updatedAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    return newId;
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (sessions.length === 0) createNewChat();
    else if (!activeSessionId) setActiveSessionId(sessions[0].id);
  }, [sessions.length, activeSessionId, createNewChat]);

  const handleImageGen = async (prompt: string) => {
    setIsGeneratingImage(true);
    setIsProcessing(true);
    try {
      const apiKey = getSafeApiKey();
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }]
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData) {
            addMessage('model', `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 'image');
          }
        }
      }
    } catch (e: any) {
      console.error("Image generation error:", e);
      addMessage('model', formatErrorMessage(e));
    } finally {
      setIsGeneratingImage(false);
      setIsProcessing(false);
    }
  };

  const disconnect = useCallback(() => {
    sessionPromiseRef.current?.then(s => s.close());
    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
    audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSources.current.clear();
    nextStartTimeRef.current = 0;
    
    if (inputContextRef.current) inputContextRef.current.close();
    if (outputContextRef.current) outputContextRef.current.close();
    inputContextRef.current = null;
    outputContextRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    setConnectionState(ConnectionState.CONNECTING);
    try {
      const apiKey = getSafeApiKey();
      if (!apiKey) throw new Error("API Key missing");

      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ googleSearch: {} }, { functionDeclarations: [imageTool] }],
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
              sessionPromise.then(s => s.sendRealtimeInput({ media: createAudioBlob(inputData) }));
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
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'generateImage') {
                  handleImageGen((fc.args as any).prompt);
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "Image generation started." } }
                  }));
                }
              }
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { 
            console.error("Live session error:", err);
            addMessage('model', formatErrorMessage(err));
            setConnectionState(ConnectionState.ERROR); 
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e: any) { 
      console.error("Connection setup error:", e);
      addMessage('model', formatErrorMessage(e));
      setConnectionState(ConnectionState.ERROR); 
    }
  }, [disconnect, addMessage]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    if (!text.trim() && !imageData) return;
    addMessage('user', text || "Visual analysis request");
    setIsProcessing(true);
    try {
      const apiKey = getSafeApiKey();
      const ai = new GoogleGenAI({ apiKey });
      const contents: any[] = [{ role: 'user', parts: [{ text: text || "Analyze this image." }] }];
      if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });
      
      const response = await ai.models.generateContent({
        // Using Flash Lite as default for public chat to stretch free quota limits
        model: 'gemini-flash-lite-latest',
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION, tools: [{ googleSearch: {} }, { functionDeclarations: [imageTool] }] }
      });

      const sources: GroundingSource[] = [];
      response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => { 
        if (c.web) sources.push({ title: c.web.title, uri: c.web.uri }); 
      });

      if (response.text) {
        addMessage('model', response.text, 'text', sources);
      } else if (!response.candidates?.[0]?.content?.parts?.some(p => p.functionCall)) {
         addMessage('model', "I'm processing your request but I couldn't formulate a text response right now.");
      }

      const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
      if (fc && fc.name === 'generateImage') handleImageGen((fc.args as any).prompt);
    } catch(e: any) { 
      console.error("Text message error:", e);
      addMessage('model', formatErrorMessage(e)); 
    }
    finally { setIsProcessing(false); }
  };

  const activeSessionRef = sessions.find(s => s.id === activeSessionId);
  return { 
    messages: activeSessionRef?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, isGeneratingImage, connect, disconnect, sendTextMessage 
  };
};