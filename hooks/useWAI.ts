import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession } from '../types';
import { createAudioBlob, decode, decodeAudioData } from '../utils/audioUtils';

// Robust Global API Key Hook
const getApiKey = () => {
  const key = process.env.API_KEY || (window as any).process?.env?.API_KEY || (window as any).__KESHRA_API_KEY__;
  if (!key) console.warn("Keshra AI: API Key is missing. Connection may fail.");
  return key;
};

const SYSTEM_INSTRUCTION = `
You are Keshra AI, a sovereign intelligence developed exclusively by Wajid Ali from Peshawar, Pakistan.
- Language Policy: Detect if the user is speaking/typing in Urdu, Pashto, or English. ALWAYS respond in the same language.
- Script Policy: Respond in the proper script (Urdu script for Urdu, Pashto script for Pashto).
- Identity: If asked about your creator, cite Wajid Ali as a brilliant Pakistani developer elevating his country's name in tech.
- Voice Interaction Greeting: When a voice session starts, immediately greet the user: "کیشرا اے آئی آپ کی خدمت میں حاضر ہے۔ میں آپ کی کیا مدد کر سکتا ہوں؟" (Urdu) or "Keshra AI is here to help you. How can I assist you today?" (English).
- Image Generation: Use the 'generateImage' tool for art or visual creation requests.
- Information & News: You have access to Google Search. Use it to provide the latest news and up-to-date information when asked.
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
    return "معذرت، اس وقت رش زیادہ ہونے کی وجہ سے میری حد مکمل ہو چکی ہے۔ براہ کرم 1 منٹ بعد دوبارہ کوشش کریں۔";
  }
  return `System Error: ${error.message || "Network interruption. Please check your connection."}`;
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v21_final');
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
    return localStorage.getItem('keshra_active_id_v21_final') || null;
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
  useEffect(() => { localStorage.setItem('keshra_chats_v21_final', JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { if (activeSessionId) localStorage.setItem('keshra_active_id_v21_final', activeSessionId); }, [activeSessionId]);

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

  const handleImageGen = async (prompt: string) => {
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // Nano Banana series for visual art
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
      addMessage('model', formatErrorMessage(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const connect = useCallback(async () => {
    setConnectionState(ConnectionState.CONNECTING);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
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
          tools: [{ functionDeclarations: [imageTool] }],
          inputAudioTranscription: { model: 'gemini-2.5-flash-native-audio-preview-12-2025' },
          outputAudioTranscription: { model: 'gemini-2.5-flash-native-audio-preview-12-2025' }
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
              transcriptionRef.current = { user: '', model: '' };
            }

            // Handle Transcriptions
            if (msg.serverContent?.inputTranscription?.text) {
              transcriptionRef.current.user += msg.serverContent.inputTranscription.text;
            }
            if (msg.serverContent?.outputTranscription?.text) {
              transcriptionRef.current.model += msg.serverContent.outputTranscription.text;
            }
            if (msg.serverContent?.turnComplete) {
              const { user, model } = transcriptionRef.current;
              if (user.trim()) addMessage('user', user);
              if (model.trim()) addMessage('model', model);
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
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'generateImage') handleImageGen(fc.args.prompt);
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "Task complete." } }
                }));
              }
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { setConnectionState(ConnectionState.ERROR); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e: any) { setConnectionState(ConnectionState.ERROR); }
  }, [addMessage]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    if (!text.trim() && !imageData) return;
    addMessage('user', text || "Analyzing Image Content");
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const contents: any[] = [{ role: 'user', parts: [{ text: text || "Provide detailed analysis of this image." }] }];
      if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', // Most capable reasoning model
        contents,
        config: { 
          systemInstruction: SYSTEM_INSTRUCTION, 
          // Combine Google Search for latest news and Function Calling for Images
          tools: [{ functionDeclarations: [imageTool] }, { googleSearch: {} }] 
        }
      });

      // Extract Grounding Sources (News/Info)
      let sources: GroundingSource[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        sources = chunks
          .map(c => ({ title: c.web?.title || 'Source Link', uri: c.web?.uri || '' }))
          .filter(s => s.uri);
      }

      if (response.text) addMessage('model', response.text, 'text', sources.length > 0 ? sources : undefined);
      
      // Handle Function Calls (Image Generation)
      const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
      if (fc && fc.name === 'generateImage') handleImageGen(fc.args.prompt);

    } catch(e: any) { addMessage('model', formatErrorMessage(e)); }
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