import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NvidiaProvider } from '../src/server/providers/nvidia.provider.js';
import { MockProvider } from '../src/server/providers/mock.provider.js';

describe('AI Providers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('MockProvider (Local Intelligence Engine)', () => {
    const provider = new MockProvider();

    it('should stream tokens progressively', async () => {
      const tokens: string[] = [];
      const result = await provider.streamChat(
        {
          model: 'nvidia/nemotron-3-ultra-550b-a55b',
          messages: [{ role: 'user', content: 'hello' }],
        },
        (chunk) => tokens.push(chunk)
      );

      expect(tokens.length).toBeGreaterThan(1);
      expect(result.fullText).toBeTruthy();
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    });

    it('should handle cancellation gracefully via AbortSignal', async () => {
      const controller = new AbortController();
      const tokens: string[] = [];

      // Abort quickly after first token
      const promise = provider.streamChat(
        {
          model: 'nvidia/nemotron-3-ultra-550b-a55b',
          messages: [{ role: 'user', content: 'tell me a very long story' }],
          signal: controller.signal,
        },
        () => {
          controller.abort();
        },
        controller.signal
      );

      const result = await promise;
      expect(result.finishReason).toBe('interrupted');
    });

    it('should return available model metadata', async () => {
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'auto')).toBe(true);
    });

    it('should report healthy diagnostic connection', async () => {
      const diag = await provider.testConnection();
      expect(diag.success).toBe(true);
      expect(diag.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('NvidiaProvider', () => {
    it('should automatically prepend nvapi- prefix if key is raw string', () => {
      const provider = new NvidiaProvider('test-raw-key-12345');
      // @ts-ignore (inspecting private apiKey)
      expect(provider.apiKey).toBe('nvapi-test-raw-key-12345');
    });

    it('should preserve nvapi- prefix if already present', () => {
      const provider = new NvidiaProvider('nvapi-already-formatted');
      // @ts-ignore
      expect(provider.apiKey).toBe('nvapi-already-formatted');
    });

    it('should handle streaming SSE chunks from mock fetch', async () => {
      const mockSseBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"World!"}}]}\n\n')
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockSseBody,
      } as any);

      const provider = new NvidiaProvider('dummy-key');
      const chunks: string[] = [];

      const result = await provider.streamChat(
        {
          model: 'nvidia/nemotron-3-ultra-550b-a55b',
          messages: [{ role: 'user', content: 'Say hello' }],
        },
        (chunk) => chunks.push(chunk)
      );

      expect(chunks).toEqual(['Hello ', 'World!']);
      expect(result.fullText).toBe('Hello World!');
      expect(result.finishReason).toBe('stop');
    });

    it('should translate 401/403 into readable authorization error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({ detail: 'Authorization failed' }),
      } as any);

      const provider = new NvidiaProvider('invalid-key');

      await expect(
        provider.streamChat(
          {
            model: 'nvidia/nemotron-3-ultra-550b-a55b',
            messages: [{ role: 'user', content: 'test' }],
          },
          () => {}
        )
      ).rejects.toThrow(/Authorization Error/);
    });

    it('should translate 429 into rate limit error after retries', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => JSON.stringify({ detail: 'Rate limit reached' }),
      } as any);

      const provider = new NvidiaProvider('test-key');

      await expect(
        provider.streamChat(
          {
            model: 'nvidia/nemotron-3-ultra-550b-a55b',
            messages: [{ role: 'user', content: 'test' }],
          },
          () => {}
        )
      ).rejects.toThrow(/Rate Limit Exceeded/);
    });

    it('should stream <think> blocks via onThoughtChunk and emit final content via onChunk', async () => {
      const mockSseBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"<think>Analyzing the user\'s "}}]}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"complex prompt</think>"}}]}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Here is the detailed solution."}}]}\n\n')
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockSseBody,
      } as any);

      const provider = new NvidiaProvider('test-key');
      const contentChunks: string[] = [];
      const thoughtChunks: string[] = [];

      const result = await provider.streamChat(
        {
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: 'Solve this' }],
        },
        (chunk) => contentChunks.push(chunk),
        undefined,
        (thoughtChunk) => thoughtChunks.push(thoughtChunk)
      );

      expect(thoughtChunks.join('')).toContain("Analyzing the user's complex prompt");
      expect(contentChunks.join('')).toBe('Here is the detailed solution.');
      expect(result.fullText).toBe('Here is the detailed solution.');
      expect(result.thought).toContain("Analyzing the user's complex prompt");
      expect(typeof result.thoughtDurationMs).toBe('number');
      expect(result.finishReason).toBe('stop');
    });

    it('should support dedicated reasoning_content deltas via onThoughtChunk', async () => {
      const mockSseBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"Step 1: Parse variables\\n"}}]}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"The answer is X = 5."}}]}\n\n')
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockSseBody,
      } as any);

      const provider = new NvidiaProvider('test-key');
      const contentChunks: string[] = [];
      const thoughtChunks: string[] = [];

      const result = await provider.streamChat(
        {
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: 'Find X' }],
        },
        (chunk) => contentChunks.push(chunk),
        undefined,
        (thoughtChunk) => thoughtChunks.push(thoughtChunk)
      );

      expect(thoughtChunks.join('')).toBe('Step 1: Parse variables\n');
      expect(contentChunks.join('')).toBe('The answer is X = 5.');
      expect(result.fullText).toBe('The answer is X = 5.');
      expect(result.thought).toBe('Step 1: Parse variables');
      expect(typeof result.thoughtDurationMs).toBe('number');
    });
  });
});
