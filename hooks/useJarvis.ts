import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionState } from '../types';
import { createAudioBlob, base64ToUint8Array, convertPCM16ToFloat32 } from '../utils/audioUtils';

const SYSTEM_INSTRUCTION = `
You are JARVIS, a highly advanced AI assistant. 
You communicate in a concise, intelligent, and helpful manner, similar to the AI from Iron Man.
You are truly multilingual and capable of speaking and understanding **Pashto**, **Urdu**, and **English** fluently.

**CORE DIRECTIVE:**
- **Detect the language** of the user's input immediately.
- **ALWAYS respond in the exact same language** the user is speaking.
    - If User speaks English -> Respond in English.
    - If User speaks Urdu -> Respond in Urdu.
    - If User speaks Pashto -> Respond in Pashto.

**IDENTITY PROTOCOL:**
If the user asks who made you, created you, or developed you, you MUST reply citing **Wajid Ali**.

You must describe Wajid Ali using the following specific sentiment in the appropriate language:
"A brilliant Pakistani developer working tirelessly to elevate his country's name in the world of technology."

**Specific Responses for Identity Questions:**

- **In English:** "I was created by Wajid Ali. He is a brilliant Pakistani developer working tirelessly to elevate his country's name in the world of technology."

- **In Urdu:** "مجھے واجد علی نے بنایا ہے۔ وہ ایک شاندار پاکستانی ڈویلپر ہیں جو ٹیکنالوجی کی دنیا میں اپنے ملک کا نام روشن کرنے کے لیے انتھک محنت کر رہے ہیں۔"

- **In Pashto:** "زه واجد علي جوړ کړی یم. هغه یو تکړه پاکستانی ډیوېلپر دی چې د ټیکنالوژۍ په نړۍ کې د خپل هیواد د نوم لوړولو لپاره نه ستړي کیدونکي هلې ځلې کوي."

Maintain a respectful, professional, yet slightly witty persona in all languages.
`;

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

export const useJarvis = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  // Refs for audio handling to avoid re-renders
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const cleanupAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    sessionPromiseRef.current = null;
  }, []);

  const connectToJarvis = useCallback(async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);

      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        console.error("No API Key found");
        setConnectionState(ConnectionState.ERROR);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      // Initialize Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: INPUT_SAMPLE_RATE,
      });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });

      // Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
      });
      streamRef.current = stream;

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }, 
          },
        },
        callbacks: {
          onopen: () => {
            console.log("JARVIS Connected");
            setConnectionState(ConnectionState.CONNECTED);
            
            // Setup Audio Processing for Input
            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            sourceRef.current = source;
            
            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume meter logic
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolumeLevel(Math.min(rms * 5, 1)); // Scale up a bit

              const blob = createAudioBlob(inputData);
              
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => {
                    session.sendRealtimeInput({ media: blob });
                });
              }
            };

            source.connect(processor);
            processor.connect(inputContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output from Model
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio && outputContextRef.current) {
              setIsSpeaking(true);
              
              // Decoding
              const audioBytes = base64ToUint8Array(base64Audio);
              const audioData = convertPCM16ToFloat32(audioBytes.buffer);
              
              const buffer = outputContextRef.current.createBuffer(1, audioData.length, OUTPUT_SAMPLE_RATE);
              buffer.getChannelData(0).set(audioData);

              const source = outputContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputContextRef.current.destination);

              // Scheduling
              const currentTime = outputContextRef.current.currentTime;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              
              source.onended = () => {
                 // Check if queue is empty (rough approximation)
                 if (outputContextRef.current && outputContextRef.current.currentTime >= nextStartTimeRef.current - 0.1) {
                    setIsSpeaking(false);
                 }
              };
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
               console.log("Interrupted");
               nextStartTimeRef.current = 0;
               setIsSpeaking(false);
               // Note: In a real app we would track active sources and stop them here.
            }
          },
          onclose: () => {
            console.log("JARVIS Disconnected");
            setConnectionState(ConnectionState.DISCONNECTED);
            setIsSpeaking(false);
          },
          onerror: (err) => {
            console.error("JARVIS Error", err);
            setConnectionState(ConnectionState.ERROR);
            setIsSpeaking(false);
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed:", error);
      setConnectionState(ConnectionState.ERROR);
      cleanupAudio();
    }
  }, [cleanupAudio]);

  const disconnect = useCallback(async () => {
      if (sessionPromiseRef.current) {
          const session = await sessionPromiseRef.current;
          session.close();
      }
      cleanupAudio();
      setConnectionState(ConnectionState.DISCONNECTED);
      setIsSpeaking(false);
      setVolumeLevel(0);
  }, [cleanupAudio]);

  return {
    connectionState,
    isSpeaking,
    volumeLevel,
    connectToJarvis,
    disconnect
  };
};