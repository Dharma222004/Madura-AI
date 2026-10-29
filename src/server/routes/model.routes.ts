import { Router, Request, Response } from 'express';
import { AIProvider } from '../providers/provider.interface.js';

export function createModelRouter(provider: AIProvider): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const models = await provider.listModels();
      res.json({ models });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
