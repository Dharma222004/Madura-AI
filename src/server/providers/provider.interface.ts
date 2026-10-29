import { Message, ModelInfo } from '../../types/index.js';

export interface ChatCompletionOptions {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StreamChatResult {
  fullText: string;
  thought?: string;
  thoughtDurationMs?: number;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  name: string;
  streamChat(
    options: ChatCompletionOptions,
    onChunk: (token: string) => void,
    signal?: AbortSignal,
    onThoughtChunk?: (thoughtToken: string) => void
  ): Promise<StreamChatResult>;
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }>;
}
