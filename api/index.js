import { getApp } from '../dist/server/init.js';

let appPromise = null;

export default async function handler(req, res) {
  if (!appPromise) {
    appPromise = getApp();
  }
  const app = await appPromise;

  // Ensure request URL matches the Express route table
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return app(req, res);
}
