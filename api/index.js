import { getApp } from '../dist/server/init.js';

let appPromise = null;

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = getApp().catch((err) => {
        // Reset so the next request retries initialization
        appPromise = null;
        throw err;
      });
    }
    const app = await appPromise;

    // Vercel strips the /api prefix from req.url before passing to the function.
    // Restore it so Express route table (/api/chat, /api/models, etc.) matches correctly.
    if (req.url && !req.url.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }

    return app(req, res);
  } catch (err) {
    console.error('[Vercel Handler] Initialization error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server initialization failed. Please try again.' });
    }
  }
}
