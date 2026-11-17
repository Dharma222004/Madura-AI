import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdownContent } from './markdown';
import { MultiModelProvider } from '../../server/providers/multi.provider';
import { securityHeaders } from '../../server/middleware/security';

test('formatMarkdownContent escapes currency amounts while preserving LaTeX math and code blocks', () => {
  const input = 'Revenue rose from $100 million to $250B while $E = mc^2$ and `$50` stay intact.';
  const formatted = formatMarkdownContent(input);
  assert.equal(formatted.includes('\\$100 million'), true);
  assert.equal(formatted.includes('\\$250B'), true);
  assert.equal(formatted.includes('$E = mc^2$'), true);
  assert.equal(formatted.includes('`$50`'), true);
});

test('MultiModelProvider.listModels returns non-image chat models and excludes removed models', async () => {
  const provider = new MultiModelProvider();
  const models = await provider.listModels();
  assert.equal(models.length > 0, true);
  assert.equal(models.some((m) => m.id === 'gemini-flash'), true);
  assert.equal(models.some((m) => m.id === 'mistral-large-4'), false);
  assert.equal(models.some((m) => m.id === 'deepseek-v4.1-flash'), false);
  assert.equal(models.some((m) => m.id === 'glm-5.3-flash'), false);
  assert.equal(models.some((m) => m.id === 'xingchen'), false);
  assert.equal(models.some((m) => m.id === 'stable-diffusion-1.5'), false);
});

test('securityHeaders sets X-Frame-Options: DENY on API routes but omits it on frontend routes for iframe preview', () => {
  const apiHeaders: Record<string, string> = {};
  securityHeaders(
    { path: '/api/health' } as any,
    { setHeader: (k: string, v: string) => { apiHeaders[k] = v; } } as any,
    () => {}
  );
  assert.equal(apiHeaders['X-Frame-Options'], 'DENY');
  assert.equal(apiHeaders['X-Content-Type-Options'], 'nosniff');

  const rootHeaders: Record<string, string> = {};
  securityHeaders(
    { path: '/' } as any,
    { setHeader: (k: string, v: string) => { rootHeaders[k] = v; } } as any,
    () => {}
  );
  assert.equal(rootHeaders['X-Frame-Options'], undefined);
  assert.equal(rootHeaders['X-Content-Type-Options'], 'nosniff');
});
