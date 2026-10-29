import { Router, Request, Response } from 'express';
import { MemoryService } from '../services/memory.service.js';
import { SupabaseService } from '../services/supabase.service.js';

export function createMemoryRouter(
  memoryService: MemoryService,
  supabaseService: SupabaseService
): Router {
  const router = Router();

  const getEffectiveUserId = async (req: Request): Promise<string> => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const verifiedId = await supabaseService.verifyUserToken(authHeader);
      if (verifiedId) return verifiedId;
    }
    const headerUserId = req.headers['x-user-id'] as string;
    if (headerUserId && headerUserId.trim()) {
      return headerUserId.trim();
    }
    return 'default-user';
  };

  // GET /api/memory - List all memories for user
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = await getEffectiveUserId(req);
      const memories = await memoryService.listMemories(userId);
      res.json({ memories, count: memories.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list memories' });
    }
  });

  // PATCH /api/memory/:id - Update / correct a memory
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const userId = await getEffectiveUserId(req);
      const id = String(req.params.id);
      const { content } = req.body;
      if (!content || !content.trim()) {
        res.status(400).json({ error: 'Updated memory content is required' });
        return;
      }
      const success = await memoryService.updateMemory(userId, id, content.trim());
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update memory' });
    }
  });

  // DELETE /api/memory/:id - Delete a single memory
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const userId = await getEffectiveUserId(req);
      const id = String(req.params.id);
      const success = await memoryService.deleteMemory(userId, id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete memory' });
    }
  });

  // DELETE /api/memory - Clear all memories for user
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const userId = await getEffectiveUserId(req);
      const success = await memoryService.clearMemories(userId);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to clear memories' });
    }
  });

  return router;
}
