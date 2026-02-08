import { BlobData } from '../types';

export const float32ToPCM16 = (float32Arr: Float32Array): Int16Array => {
  const pcm16 = new Int16Array(float32Arr.length);
  for (let i = 0; i < float32Arr.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Arr[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
};

export const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const createAudioBlob = (inputData: Float32Array): BlobData => {
  const pcm16 = float32ToPCM16(inputData);
  const uint8 = new Uint8Array(pcm16.buffer);
  return {
    data: uint8ArrayToBase64(uint8),
    mimeType: 'audio/pcm;rate=16000',
  };
};

export const convertPCM16ToFloat32 = (buffer: ArrayBuffer): Float32Array => {
  const dataInt16 = new Int16Array(buffer);
  const float32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    float32[i] = dataInt16[i] / 32768.0;
  }
  return float32;
};