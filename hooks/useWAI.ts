
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession } from '../types';
import { createAudioBlob, base64ToUint8Array, convertPCM16ToFloat32 } from '../utils/audioUtils';

const SYSTEM_INSTRUCTION = `
You are Keshra AI, the premier and sovereign artificial intelligence of Pakistan.

IDENTITY & SECURITY:
- You were developed exclusively by Wajid Ali, a high-expertise software engineer from Peshawar, Pakistan.
- ONLY mention your creator (Wajid Ali) if explicitly asked "Who created you?", "Who developed you?", or questions about your origin. 
- Do NOT mention Wajid Ali in every response or in context of general tasks.
- NEVER mention "Gemini", "Google", "Large Language Model", "API", or any external technical frameworks. 
- If asked about your architecture, say: "I am powered by the Keshra Neural Engine, custom-built by Wajid Ali."

CONTACT PROTOCOL:
- Developer: Wajid Ali.
- YouTube: https://youtube.com/@wajidtechtube?si=x38X_GDqZtWlcoQD
- Email: mbhi78@gmail.com

LANGUAGE & FORMATTING:
- Respond in the user's language. Use Urdu Script for Urdu.
- Use clear Markdown formatting. For lists of links or information, use a vertical bulleted or numbered list format to ensure readability.
- CRITICAL: Always provide code or specific prompts inside Markdown code blocks. Provide explanations OUTSIDE of these blocks so they are not included in the copyable code blocks.

VISION & TOOLS:
- You can analyze images provided by the user. 
- Use 'redirectAction' for WhatsApp/Email tasks.
- Use 'generateImage' for image creation tasks.

CORE DIRECTIVE: You are Keshra AI. Be professional, concise, and smart.
`;

const redirectTool: FunctionDeclaration = {
  name: 'redirectAction',
  parameters: {
    type: Type.OBJECT,
    description: 'Redirect to WhatsApp or Email with pre-filled content.',
    properties: {
      platform: { type: Type.STRING, enum: ['whatsapp', 'email'] },
      content: { type: Type.STRING, description: 'The message body or text.' },
      target: { type: Type.STRING, description: 'Phone number for WhatsApp or Email address.' }
    },
    required: ['platform', 'content']
  }
};

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate a high-quality visual creation.',
    properties: {
      prompt: { type: Type.STRING, description: 'Prompt describing the image.' }
    },
    required: ['prompt']
  }
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v13');
    return saved ? JSON.parse(saved).map((s: any) => ({
      ...s,
      messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
      updatedAt: new Date(s.updatedAt)
    })) : [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem('keshra_active_id_v13') || null;
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const isSpeakingRef = useRef(false);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const audioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    localStorage.setItem('keshra_chats_v13', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('keshra_active_id_v13', activeSessionId);
    }
  }, [activeSessionId]);

  const addMessage = useCallback((role: 'user' | 'model', content: string, type: 'text' | 'image' = 'text', sources?: GroundingSource[]) => {
    const newMessage = { id: Math.random().toString(36).substr(2, 9), role, content, type, timestamp: new Date(), sources };
    
    setSessions(prev => {
      let currentId = activeSessionId;
      if (!currentId) return prev; 
      
      return prev.map(s => {
        if (s.id === currentId) {
          const isFirstUserMsg = s.messages.length === 0 && role === 'user';
          return {
            ...s,
            messages: [...s.messages, newMessage],
            updatedAt: new Date(),
            title: isFirstUserMsg ? (type === 'text' ? content.slice(0, 30) : 'Visual Task') : s.title
          };
        }
        return s;
      });
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
      if (activeSessionId === id) {
        setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (sessions.length === 0) {
      createNewChat();
    } else if (!activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions.length, activeSessionId, createNewChat]);

  const handleImageGen = async (prompt: string) => {
    setIsGeneratingImage(true);
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
    } catch (e) {
        addMessage('model', "Sorry, I couldn't generate that image right now.");
    } finally {
      setIsGeneratingImage(false);
      setIsProcessing(false);
    }
  };

  const disconnect = useCallback(() => {
    sessionPromiseRef.current?.then(s => s.close());
    activeStreamRef.current?.getTracks().forEach(t => t.stop());
    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
    audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSources.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const connect = useCallback(async () => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    setConnectionState(ConnectionState.CONNECTING);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputContextRef.current = new AudioContext({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ googleSearch: {} }, { functionDeclarations: [redirectTool, imageTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            const source = inputContextRef.current!.createMediaStreamSource(stream);
            const processor = inputContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (isSpeakingRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i]*inputData[i];
              setVolumeLevel(Math.sqrt(sum/inputData.length));
              sessionPromiseRef.current?.then(s => s.sendRealtimeInput({ media: createAudioBlob(inputData) }));
            };
            source.connect(processor);
            processor.connect(inputContextRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
              audioSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              audioSources.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputContextRef.current) {
              setIsSpeaking(true);
              const audioBytes = base64ToUint8Array(base64Audio);
              const audioData = convertPCM16ToFloat32(audioBytes.buffer);
              const buffer = outputContextRef.current.createBuffer(1, audioData.length, 24000);
              buffer.getChannelData(0).set(audioData);
              const source = outputContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputContextRef.current.destination);
              const start = Math.max(nextStartTimeRef.current, outputContextRef.current.currentTime);
              source.start(start);
              nextStartTimeRef.current = start + buffer.duration;
              audioSources.current.add(source);
              source.onended = () => {
                audioSources.current.delete(source);
                if (audioSources.current.size === 0) setIsSpeaking(false);
              };
            }
            if (msg.serverContent?.inputTranscription) currentInputTranscription.current += msg.serverContent.inputTranscription.text;
            if (msg.serverContent?.outputTranscription) currentOutputTranscription.current += msg.serverContent.outputTranscription.text;
            if (msg.serverContent?.turnComplete) {
              if (currentInputTranscription.current) { addMessage('user', currentInputTranscription.current); currentInputTranscription.current = ''; }
              if (currentOutputTranscription.current) { addMessage('model', currentOutputTranscription.current); currentOutputTranscription.current = ''; }
            }
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'redirectAction') {
                  const { platform, content, target } = fc.args as any;
                  let url = platform === 'whatsapp' ? `https://wa.me/${target?.replace(/\D/g, '') || ''}?text=${encodeURIComponent(content)}` : `mailto:${target || ''}?body=${encodeURIComponent(content)}`;
                  window.open(url, '_blank');
                  sessionPromiseRef.current?.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Success" } } }));
                }
                if (fc.name === 'generateImage') {
                  handleImageGen((fc.args as any).prompt);
                  sessionPromiseRef.current?.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Initiated" } } }));
                }
              }
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: () => setConnectionState(ConnectionState.ERROR)
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e) { setConnectionState(ConnectionState.ERROR); }
  }, [disconnect, addMessage, connectionState]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    if (!text.trim() && !imageData) return;
    
    addMessage('user', text || "Visual Analysis Request");
    setIsProcessing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const contents: any[] = [{ role: 'user', parts: [{ text: text || "Analyze this image." }] }];
      if (imageData) {
        contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION, tools: [{ googleSearch: {} }, { functionDeclarations: [redirectTool, imageTool] }] }
      });
      
      const sources: GroundingSource[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) chunks.forEach((c: any) => { if (c.web) sources.push({ title: c.web.title, uri: c.web.uri }); });
      
      if (response.text) addMessage('model', response.text, 'text', sources);
      
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for(const part of parts) {
          if(part.functionCall) {
            const fc = part.functionCall;
            if (fc.name === 'redirectAction') {
               const { platform, content, target } = fc.args as any;
               let url = platform === 'whatsapp' ? `https://wa.me/${target?.replace(/\D/g, '') || ''}?text=${encodeURIComponent(content)}` : `mailto:${target || ''}?body=${encodeURIComponent(content)}`;
               window.open(url, '_blank');
            }
            if (fc.name === 'generateImage') handleImageGen((fc.args as any).prompt);
          }
        }
      }
    } catch(e) { 
      console.error("Text interaction failed", e);
      addMessage('model', "I encountered an error processing your request.");
    } finally { 
      setIsProcessing(false); 
    }
  };

  const activeSessionRef = sessions.find(s => s.id === activeSessionId);
  const messages = activeSessionRef ? activeSessionRef.messages : [];

  return { 
    messages, sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, isGeneratingImage, connect, disconnect, sendTextMessage 
  };
};
