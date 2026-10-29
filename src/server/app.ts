import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { StorageInterface } from './store/storage.interface.js';
import { NvidiaProvider } from './providers/nvidia.provider.js';
import { MockProvider } from './providers/mock.provider.js';
import { ChatService } from './services/chat.service.js';
import { DocumentService } from './services/document.service.js';
import { createChatRouter } from './routes/chat.routes.js';
import { createConversationRouter } from './routes/conversation.routes.js';
import { createUploadRouter } from './routes/upload.routes.js';
import { createModelRouter } from './routes/model.routes.js';
import { createSettingsRouter } from './routes/settings.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createMemoryRouter } from './routes/memory.routes.js';
import { createTranscribeRouter } from './routes/transcribe.routes.js';
import { MemoryService } from './services/memory.service.js';
import { SupabaseService } from './services/supabase.service.js';
import { SpeechService } from './services/speech.service.js';
import { rateLimiter, securityHeaders } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface AppDependencies {
  storage: StorageInterface;
  nvidiaProvider: NvidiaProvider;
  mockProvider: MockProvider;
  documentService: DocumentService;
  chatService: ChatService;
  speechService?: SpeechService;
  memoryService?: MemoryService;
  supabaseService?: SupabaseService;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  const speechService = deps.speechService || new SpeechService();

  // Core Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(securityHeaders);
  app.use(rateLimiter);

  // API Routes
  app.use('/api/health', createHealthRouter());
  app.use('/api/chat', createChatRouter(deps.chatService, deps.supabaseService));
  app.use('/api/conversations', createConversationRouter(deps.storage));
  app.use('/api/upload', createUploadRouter(deps.documentService));
  app.use('/api/transcribe', createTranscribeRouter(speechService, deps.supabaseService));
  app.use('/api/audio/transcribe', createTranscribeRouter(speechService, deps.supabaseService));
  app.use('/api/models', createModelRouter(deps.nvidiaProvider));
  app.use('/api/settings', createSettingsRouter(deps.storage, deps.nvidiaProvider));
  if (deps.memoryService && deps.supabaseService) {
    app.use('/api/memory', createMemoryRouter(deps.memoryService, deps.supabaseService));
  }

  // Serve static client bundle in production
  const clientDist = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
