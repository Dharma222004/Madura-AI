import { Router, Request, Response } from 'express';
import { ChatService } from '../services/chat.service.js';
import { SupabaseService } from '../services/supabase.service.js';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_MB,
  getFileCategory,
  sanitizeFileName,
} from '../../types/upload.config.js';

export function createChatRouter(chatService: ChatService, supabaseService?: SupabaseService): Router {
  const router = Router();

  // POST /api/chat - Stream conversation response via SSE
  router.post('/', async (req: Request, res: Response) => {
    const { conversationId, message, model, attachments, enableSearch, memoryPrompt, memoryEnabled } = req.body;

    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const messageStr = typeof message === 'string' ? message.trim() : '';

    if (!messageStr && !hasAttachments) {
      res.status(400).json({ error: 'Message content or at least one file attachment is required' });
      return;
    }

    // Server-side validation of file count, total payload size, and allowed MIME types
    if (hasAttachments) {
      if (attachments.length > MAX_FILES) {
        res.status(400).json({
          error: `Maximum of ${MAX_FILES} files allowed per message (received ${attachments.length}).`,
        });
        return;
      }

      let totalSize = 0;
      for (const att of attachments) {
        const safeName = sanitizeFileName(att?.fileName || 'attachment');
        const mimeType = typeof att?.mimeType === 'string' ? att.mimeType : '';
        const fileSize = typeof att?.fileSize === 'number' ? att.fileSize : 0;

        if (fileSize > MAX_FILE_BYTES) {
          res.status(400).json({
            error: `"${safeName}" exceeds the ${MAX_FILE_MB} MB per-file limit.`,
          });
          return;
        }
        totalSize += fileSize;
        if (totalSize > MAX_TOTAL_BYTES) {
          res.status(400).json({
            error: `Total attachments exceed the ${MAX_TOTAL_MB} MB per-message limit.`,
          });
          return;
        }

        const category = getFileCategory(safeName, mimeType);
        if (category === 'unsupported') {
          res.status(400).json({
            error: `Unsupported file type: ${safeName}`,
          });
          return;
        }
      }
    }

    // Resolve authenticated user ID
    let userId = 'default-user';
    const authHeader = req.headers.authorization;
    if (authHeader && supabaseService) {
      const verified = await supabaseService.verifyUserToken(authHeader);
      if (verified) userId = verified;
    }
    const headerUserId = req.headers['x-user-id'] as string;
    if (headerUserId && headerUserId.trim() && userId === 'default-user') {
      userId = headerUserId.trim();
    }

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (nginx/Vercel)
    res.setHeader('Transfer-Encoding', 'chunked'); // Force chunked transfer for Vercel SSE

    // Flush headers immediately
    res.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Explicitly flush after each write so Vercel / proxies don't buffer SSE chunks
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    let clientDisconnected = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        if (conversationId) {
          chatService.abortStream(conversationId);
        }
      }
    });

    try {
      sendEvent('start', { status: 'started' });

      const result = await chatService.handleUserMessage({
        conversationId,
        messageContent: messageStr,
        model,
        userId,
        attachments,
        enableSearch: Boolean(enableSearch),
        memoryPrompt: typeof memoryPrompt === 'string' ? memoryPrompt : undefined,
        memoryEnabled: typeof memoryEnabled === 'boolean' ? memoryEnabled : undefined,
        onToken: (token: string) => {
          if (!clientDisconnected) {
            sendEvent('token', { token });
          }
        },
        onThoughtToken: (token: string) => {
          if (!clientDisconnected) {
            sendEvent('thought_token', { token });
          }
        },
        onTitleGenerated: (title: string, conversationId: string) => {
          if (!clientDisconnected) {
            sendEvent('title', { title, conversationId });
          }
        },
        onSearchStart: (query: string) => {
          if (!clientDisconnected) {
            sendEvent('search_start', { query });
          }
        },
        onSearchDone: (sources) => {
          if (!clientDisconnected) {
            sendEvent('search_done', { sources });
          }
        },
      });

      if (!clientDisconnected) {
        sendEvent('done', {
          conversation: result.conversation,
          assistantMessage: result.assistantMessage,
        });
      }
    } catch (err: any) {
      if (!clientDisconnected) {
        const errorMsg = err.message || 'Failed to complete chat stream';
        sendEvent('error', { error: errorMsg });
      }
    } finally {
      if (!clientDisconnected) {
        res.end();
      }
    }
  });

  // POST /api/chat/abort - Cancel actively streaming generation
  router.post('/abort', (req: Request, res: Response) => {
    const { conversationId } = req.body;
    if (!conversationId) {
      res.status(400).json({ error: 'conversationId is required' });
      return;
    }

    const aborted = chatService.abortStream(conversationId);
    res.json({ success: true, aborted });
  });

  return router;
}
