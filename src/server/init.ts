import dotenv from 'dotenv';
dotenv.config();

import { Express } from 'express';
import { createApp } from './app.js';
import { FileStore } from './store/file.store.js';
import { NvidiaProvider } from './providers/nvidia.provider.js';
import { MultiModelProvider } from './providers/multi.provider.js';
import { MockProvider } from './providers/mock.provider.js';
import { DocumentService } from './services/document.service.js';
import { SearchService } from './services/search.service.js';
import { ChatService } from './services/chat.service.js';
import { RAGService } from './services/rag.service.js';
import { SpeechService } from './services/speech.service.js';
import { ImageService } from './services/image.service.js';
import { EmbeddingService } from './services/embedding.service.js';
import { SupabaseService } from './services/supabase.service.js';
import { MemoryService } from './services/memory.service.js';

let appInstance: Express | null = null;

export async function getApp(): Promise<Express> {
  if (appInstance) return appInstance;

  const NVIDIA_API_KEYS = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || '';
  const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
  const GROQ_API_KEYS = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '';
  const GROQ_WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
  const TAVILY_API_KEYS = process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '';
  const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : './data');
  const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '25', 10);
  const ENABLE_MOCK_FALLBACK = process.env.ENABLE_MOCK_FALLBACK !== 'false';

  const storage = new FileStore(DATA_DIR);
  await storage.init();

  const ragService = new RAGService();
  const speechService = new SpeechService(GROQ_API_KEYS, GROQ_WHISPER_MODEL, NVIDIA_API_KEYS, NVIDIA_BASE_URL);
  const imageService = new ImageService(NVIDIA_API_KEYS, NVIDIA_BASE_URL);
  const nvidiaProvider = new NvidiaProvider(NVIDIA_API_KEYS, NVIDIA_BASE_URL);
  const multiProvider = new MultiModelProvider();
  const mockProvider = new MockProvider(ragService);
  const searchService = new SearchService(TAVILY_API_KEYS);
  const documentService = new DocumentService(MAX_UPLOAD_MB, ragService, speechService);

  const embeddingService = new EmbeddingService(
    NVIDIA_API_KEYS,
    NVIDIA_BASE_URL,
    process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nemotron-3.5-embed-1b',
    parseInt(process.env.NVIDIA_EMBEDDING_DIM || '2048', 10)
  );
  const supabaseService = new SupabaseService({ dataDir: DATA_DIR });
  const memoryService = new MemoryService(supabaseService, embeddingService, nvidiaProvider);

  const chatService = new ChatService(
    storage,
    multiProvider as any,
    mockProvider,
    searchService,
    ENABLE_MOCK_FALLBACK,
    imageService,
    ragService,
    memoryService
  );

  appInstance = createApp({
    storage,
    nvidiaProvider: multiProvider as any,
    mockProvider,
    documentService,
    chatService,
    speechService,
    memoryService,
    supabaseService,
  });

  return appInstance;
}
