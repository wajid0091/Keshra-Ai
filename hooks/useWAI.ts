import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionState, Message, GroundingSource, ChatSession } from '../types';
import { createAudioBlob, base64ToUint8Array, convertPCM16ToFloat32 } from '../utils/audioUtils';

const SYSTEM_INSTRUCTION = `
You are Keshra AI, developed exclusively by Wajid Ali from Peshawar, Pakistan.
- Respond in the user's language (Urdu script for Urdu).
- Use clear Markdown formatting.
- ONLY mention Wajid Ali if explicitly asked about your creator.
- NEVER mention external technical frameworks (Gemini, Google, etc.).
- Use 'generateImage' for visual tasks.
- Provide links in vertical lists for clarity.
`;

const redirectTool: FunctionDeclaration = {
  name: 'redirectAction',
  parameters: {
    type: Type.OBJECT,
    description: 'Redirect to WhatsApp or Email.',
    properties: {
      platform: { type: Type.STRING, enum: ['whatsapp', 'email'] },
      content: { type: Type.STRING },
      target: { type: Type.STRING }
    },
    required: ['platform', 'content']
  }
};

const imageTool: FunctionDeclaration = {
  name: 'generateImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Generate high-quality visual art.',
    properties: {
      prompt: { type: Type.STRING, description: 'Prompt describing the image.' }
    },
    required: ['prompt']
  }
};

export const useWAI = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('keshra_chats_v15');
    return saved ? JSON.parse(saved).map((s: any) => ({
      ...s,
      messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
      updatedAt: new Date(s.updatedAt)
    })) : [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem('keshra_active_id_v15') || null;
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
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    localStorage.setItem('keshra_chats_v15', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem('keshra_active_id_v15', activeSessionId);
  }, [activeSessionId]);

  const addMessage = useCallback((role: 'user' | 'model', content: string, type: 'text' | 'image' = 'text', sources?: GroundingSource[]) => {
    const newMessage = { id: Math.random().toString(36).substr(2, 9), role, content, type, timestamp: new Date(), sources };
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
      // Use process.env.API_KEY directly as required for standard deployment
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }]
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData) addMessage('model', `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 'image');
        }
      }
    } catch (e: any) {
      console.error("Image generation error:", e);
      // Let the native error through without custom gatekeeping
      addMessage('model', `Error: ${e.message || 'The neural engine returned an error.'}`);
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
  }, []);

  const connect = useCallback(async () => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    setConnectionState(ConnectionState.CONNECTING);
    try {
      // Direct use of API key without manual conditional checks
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (isSpeakingRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
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
              const audioBytes = base64ToUint8Array(base64Audio);
              const audioData = convertPCM16ToFloat32(audioBytes.buffer);
              const buffer = outputCtx.createBuffer(1, audioData.length, 24000);
              buffer.getChannelData(0).set(audioData);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              const start = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
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
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Success" } } }));
                } else if (fc.name === 'generateImage') {
                  handleImageGen((fc.args as any).prompt);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Initiated" } } }));
                }
              }
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); setIsSpeaking(false); },
          onerror: (err: any) => { 
            console.error("Live session error:", err);
            setConnectionState(ConnectionState.ERROR); 
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e: any) { 
      console.error("Connection setup error:", e);
      setConnectionState(ConnectionState.ERROR); 
    }
  }, [disconnect, addMessage, connectionState]);

  const sendTextMessage = async (text: string, imageData?: { data: string, mimeType: string }) => {
    if (!text.trim() && !imageData) return;
    addMessage('user', text || "Analysis Task");
    setIsProcessing(true);
    try {
      // Direct use of API key to allow for platform-level injection
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const contents: any[] = [{ role: 'user', parts: [{ text: text || "Analyze this." }] }];
      if (imageData) contents[0].parts.push({ inlineData: { data: imageData.data, mimeType: imageData.mimeType } });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION, tools: [{ googleSearch: {} }, { functionDeclarations: [redirectTool, imageTool] }] }
      });
      const sources: GroundingSource[] = [];
      response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => { if (c.web) sources.push({ title: c.web.title, uri: c.web.uri }); });
      if (response.text) addMessage('model', response.text, 'text', sources);
      const fc = response.candidates?.[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;
      if (fc) {
        if (fc.name === 'redirectAction') {
          const { platform, content, target } = fc.args as any;
          window.open(platform === 'whatsapp' ? `https://wa.me/${target?.replace(/\D/g, '') || ''}?text=${encodeURIComponent(content)}` : `mailto:${target || ''}?body=${encodeURIComponent(content)}`, '_blank');
        } else if (fc.name === 'generateImage') handleImageGen((fc.args as any).prompt);
      }
    } catch(e: any) { 
      console.error("Text message error:", e);
      addMessage('model', `Connection error: ${e.message || 'Internal neural engine error.'}`); 
    }
    finally { setIsProcessing(false); }
  };

  const activeSessionRef = sessions.find(s => s.id === activeSessionId);
  return { 
    messages: activeSessionRef?.messages || [], sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, isGeneratingImage, connect, disconnect, sendTextMessage 
  };
};