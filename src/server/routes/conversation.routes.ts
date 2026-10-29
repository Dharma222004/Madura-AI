import { Router, Request, Response } from 'express';
import { StorageInterface } from '../store/storage.interface.js';
import { v4 as uuidv4 } from 'uuid';

export function createConversationRouter(storage: StorageInterface): Router {
  const router = Router();

  // GET /api/conversations - List conversations with optional query
  router.get('/', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const conversations = await storage.getConversations(q);
      res.json({ conversations });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/conversations/:id - Get conversation with full message history
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const conversation = await storage.getConversation(id);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json({ conversation });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/conversations - Create empty or named conversation
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { title, model } = req.body;
      const settings = await storage.getSettings();
      const newConv = await storage.createConversation({
        id: uuidv4(),
        title: title || 'New Conversation',
        model: model || settings.model,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      res.status(201).json({ conversation: newConv });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/conversations/:id - Update title, pinned status, or model
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { title, pinned, model } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (pinned !== undefined) updates.pinned = Boolean(pinned);
      if (model !== undefined) updates.model = model;

      const updated = await storage.updateConversation(id, updates);
      if (!updated) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json({ conversation: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/conversations/:id - Delete single conversation
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const deleted = await storage.deleteConversation(id);
      if (!deleted) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json({ success: true, message: 'Conversation deleted' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/conversations - Clear all conversations
  router.delete('/', async (req: Request, res: Response) => {
    try {
      await storage.clearAllConversations();
      res.json({ success: true, message: 'All conversations cleared' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
