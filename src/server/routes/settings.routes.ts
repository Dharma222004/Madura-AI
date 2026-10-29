import { Router, Request, Response } from 'express';
import { StorageInterface } from '../store/storage.interface.js';
import { AIProvider } from '../providers/provider.interface.js';

export function createSettingsRouter(
  storage: StorageInterface,
  provider: AIProvider
): Router {
  const router = Router();

  // GET /api/settings - Fetch current settings
  router.get('/', async (req: Request, res: Response) => {
    try {
      const settings = await storage.getSettings();
      res.json({ settings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/settings - Update settings
  router.post('/', async (req: Request, res: Response) => {
    try {
      const allowedKeys = [
        'userName',
        'theme',
        'model',
        'temperature',
        'maxTokens',
        'systemPrompt',
        'enterToSend',
        'useMockFallback',
      ];
      const updates: any = {};
      for (const key of allowedKeys) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }

      const updated = await storage.saveSettings(updates);
      res.json({ settings: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/settings/test-connection - Test NVIDIA API connectivity & latency
  router.post('/test-connection', async (req: Request, res: Response) => {
    try {
      const result = await provider.testConnection();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        latencyMs: 0,
        message: err.message || 'Connection test failed',
      });
    }
  });

  return router;
}
