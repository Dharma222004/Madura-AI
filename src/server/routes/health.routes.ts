import { Router, Request, Response } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      app: 'Madura AI',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: Date.now(),
      environment: process.env.NODE_ENV || 'development',
    });
  });

  return router;
}
