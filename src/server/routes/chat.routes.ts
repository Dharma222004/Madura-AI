import { Router, Request, Response } from 'express';
import { ChatService } from '../services/chat.service.js';
import { SupabaseService } from '../services/supabase.service.js';

export function createChatRouter(chatService: ChatService, supabaseService?: SupabaseService): Router {
  const router = Router();

  // POST /api/chat - Stream conversation response via SSE
  router.post('/', async (req: Request, res: Response) => {
    const { conversationId, message, model, attachments, enableSearch } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message content is required' });
      return;
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
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    // Flush headers immediately
    res.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
        messageContent: message.trim(),
        model,
        userId,
        attachments,
        enableSearch: Boolean(enableSearch),
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
