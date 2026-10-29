import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('[ServerError]', req.method, req.path, err);

  const statusCode = err.status || err.statusCode || 500;
  // Sanitize internal details and secrets
  const cleanMessage =
    err.message?.replace(/nvapi-[a-zA-Z0-9_-]+/g, 'nvapi-***') ||
    'An unexpected internal server error occurred.';

  res.status(statusCode).json({
    error: cleanMessage,
    timestamp: Date.now(),
  });
}
