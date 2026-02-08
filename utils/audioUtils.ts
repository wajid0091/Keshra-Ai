import { BlobData } from '../types';

export const encode = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const float32ToPCM16 = (float32Arr: Float32Array): Int16Array => {
  const pcm16 = new Int16Array(float32Arr.length);
  for (let i = 0; i < float32Arr.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Arr[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
};

export const createAudioBlob = (inputData: Float32Array): BlobData => {
  const pcm16 = float32ToPCM16(inputData);
  const uint8 = new Uint8Array(pcm16.buffer);
  return {
    data: encode(uint8),
    mimeType: 'audio/pcm;rate=16000',
  };
};

export const base64ToUint8Array = decode;
export const convertPCM16ToFloat32 = (buffer: ArrayBuffer): Float32Array => {
  const dataInt16 = new Int16Array(buffer);
  const float32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    float32[i] = dataInt16[i] / 32768.0;
  }
  return float32;
};