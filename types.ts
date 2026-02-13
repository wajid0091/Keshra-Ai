
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export type ChatMode = 'normal' | 'search' | 'thinking';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  type: 'text' | 'image' | 'loading-image';
  content: string;
  timestamp: Date;
  sources?: GroundingSource[];
  feedback?: 'like' | 'dislike';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
}

export interface BlobData {
  data: string;
  mimeType: string;
}