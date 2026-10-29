import dotenv from 'dotenv';
dotenv.config();

import { getApp } from './init.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('   Starting Madura AI — Multi-Model Assistant Server');
  console.log('----------------------------------------------------');

  const app = await getApp();

  const server = app.listen(PORT, () => {
    console.log(`[Server] Madura AI backend active on http://localhost:${PORT}`);
    console.log(`[Models] Auto (default) | Gemini 2.5 Flash | Qwen 3.8 | GPT-OSS-120B | Ultron`);
  });

  const shutdown = () => {
    console.log('\n[Server] Shutting down gracefully...');
    server.close(() => {
      console.log('[Server] Closed.');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal bootstrap error:', err);
  process.exit(1);
});
