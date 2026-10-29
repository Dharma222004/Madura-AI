export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'completed' | 'streaming' | 'failed' | 'interrupted';

export interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  extractedText?: string;
  previewUrl?: string;
}

export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  thought?: string;
  thoughtDurationMs?: number;
  status: MessageStatus;
  errorMessage?: string;
  createdAt: number;
  attachments?: Attachment[];
  searchQuery?: string;
  searchSources?: SearchSource[];
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  messages?: Message[];
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  supportsVision: boolean;
  isDefault?: boolean;
}

export type MemoryType = 'profile' | 'preference' | 'project' | 'goal' | 'decision' | 'event' | 'instruction';

export interface UserMemory {
  id: string;
  userId: string;
  memoryType: MemoryType;
  content: string;
  embedding?: number[];
  sourceConversationId?: string;
  importance: number; // 1 to 5
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt?: number;
  similarity?: number;
}

export interface UserSettings {
  userName?: string;
  theme: 'light' | 'dark' | 'system';
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  enterToSend: boolean;
  useMockFallback: boolean;
  enableSearch?: boolean;
  enableMemory?: boolean;
}

export interface ChatStreamChunk {
  type: 'token' | 'start' | 'done' | 'error' | 'title' | 'search_start' | 'search_done';
  token?: string;
  messageId?: string;
  conversationId?: string;
  title?: string;
  error?: string;
  searchQuery?: string;
  searchSources?: SearchSource[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface UploadResponse {
  attachment: Attachment;
  message?: string;
}
