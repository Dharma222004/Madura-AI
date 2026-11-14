import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MultiModelProvider } from '../src/server/providers/multi.provider.js';
import { MockProvider } from '../src/server/providers/mock.provider.js';
import { FileStore } from '../src/server/store/file.store.js';
import { ChatService } from '../src/server/services/chat.service.js';
import { DocumentService } from '../src/server/services/document.service.js';
import { createApp } from '../src/server/app.js';

const MISTRAL_MODEL = 'mistralai/mistral-large-4-1t-a52b';
const messages = [{ role: 'user' as const, content: 'Say hello' }];

function data(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseResponse(wire: string, bytesPerChunk = 1024): Response {
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += bytesPerChunk) {
        controller.enqueue(bytes.slice(offset, offset + bytesPerChunk));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function successfulResponse(text = 'Hello!'): Response {
  return sseResponse(
    data({ choices: [{ delta: { role: 'assistant', content: text } }] }) +
    data({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  );
}

describe('Auto Mistral multi-provider gateway', () => {
  let temporaryDirectory: string | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Keep all requests deterministic, independent of the developer's API keys.
    for (const provider of ['NVIDIA', 'GEMINI', 'GROQ', 'TAVILY']) {
      vi.stubEnv(`${provider}_API_KEY`, '');
      vi.stubEnv(`${provider}_API_KEYS`, '');
      for (let index = 1; index <= 10; index++) {
        vi.stubEnv(`${provider}_API_KEY_${index}`, '');
      }
    }
    vi.stubEnv('NVIDIA_MODEL', '');
    vi.stubEnv('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1');
    vi.stubEnv('NVIDIA_API_KEY', 'nvapi-test-primary');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (temporaryDirectory) {
      const cleanupTarget = path.resolve(temporaryDirectory);
      if (path.dirname(cleanupTarget) !== path.resolve(os.tmpdir()) ||
          !path.basename(cleanupTarget).startsWith('madura-mistral-api-')) {
        throw new Error('Unexpected test cleanup directory');
      }
      fs.rmSync(cleanupTarget, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('sends Auto to Mistral Chat Completions and streams the complete answer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => successfulResponse());
    const provider = new MultiModelProvider();
    const chunks: string[] = [];

    const result = await provider.streamChat(
      { model: 'auto', messages, temperature: 0.25, maxTokens: 64 },
      (chunk) => chunks.push(chunk)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(JSON.parse(init!.body as string)).toEqual({
      model: MISTRAL_MODEL,
      messages,
      temperature: 0.25,
      max_tokens: 64,
      stream: true,
    });
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer nvapi-test-primary',
      Accept: 'text/event-stream',
    });
    expect(chunks.join('')).toBe('Hello!');
    expect(result.fullText).toBe('Hello!');
    expect(result.thought).toBeUndefined();
    expect(result.finishReason).toBe('stop');
    expect((await provider.listModels()).find((model) => model.id === 'mistral-large-4'))
      .toMatchObject({ name: 'Mistral Large 4' });
    expect((await provider.listModels()).find((model) => model.id === 'auto')).toBeUndefined();
  });

  it.each(['default', 'gpt-oss-20b', 'openai/gpt-oss-20b', MISTRAL_MODEL])(
    'routes the model identifier %s to the new Auto backend',
    (modelId) => {
      expect(new MultiModelProvider().getModelConfig(modelId).realModel).toBe(MISTRAL_MODEL);
    }
  );

  it('keeps an explicitly configured NVIDIA model override', () => {
    vi.stubEnv('NVIDIA_MODEL', 'mistralai/custom-deployment');
    expect(new MultiModelProvider().getModelConfig('auto').realModel)
      .toBe('mistralai/custom-deployment');
  });

  it('reconstructs fragmented UTF-8 and SSE lines, including the final line without a newline', async () => {
    const expectedText = 'வணக்கம் 👋!';
    const wire = ': keepalive\r\n\r\n' +
      data({ choices: [{ delta: { role: 'assistant', content: '' } }] }) +
      data({ choices: [{ delta: { content: 'வணக்கம் ' } }] }) +
      `data: ${JSON.stringify({ choices: [{ delta: { content: '👋!' }, finish_reason: 'stop' }] })}`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse(wire, 1));
    const chunks: string[] = [];

    const result = await new MultiModelProvider().streamChat(
      { model: 'auto', messages },
      (chunk) => chunks.push(chunk)
    );

    expect(chunks.join('')).toBe(expectedText);
    expect(result.fullText).toBe(expectedText);
  });

  it('preserves a token-limit finish reason instead of reporting a complete response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse(
      data({ choices: [{ delta: { content: 'A partial answer' } }] }) +
      data({ choices: [{ delta: {}, finish_reason: 'length' }] }) +
      'data: [DONE]\n\n'
    ));

    const result = await new MultiModelProvider().streamChat({ model: 'auto', messages }, () => {});

    expect(result.fullText).toBe('A partial answer');
    expect(result.finishReason).toBe('length');
  });

  it('rotates a rate-limited NVIDIA key and keeps the working key for later requests', async () => {
    vi.stubEnv('NVIDIA_API_KEYS', 'nvapi-test-primary,nvapi-test-secondary');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 }))
      .mockImplementation(async () => successfulResponse());
    const provider = new MultiModelProvider();

    await provider.streamChat({ model: 'auto', messages }, () => {});
    await provider.streamChat({ model: 'auto', messages }, () => {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, init]) => (init!.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer nvapi-test-primary', 'Bearer nvapi-test-secondary', 'Bearer nvapi-test-secondary']);
    expect(fetchMock.mock.calls.every(([, init]) => JSON.parse(init!.body as string).model === MISTRAL_MODEL))
      .toBe(true);
  });

  it('fails promptly when no provider keys exist instead of entering a fallback cycle', async () => {
    vi.stubEnv('NVIDIA_API_KEY', '');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(new MultiModelProvider().streamChat({ model: 'auto', messages }, () => {}))
      .rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors an already aborted options.signal without making an API request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(new MultiModelProvider().streamChat({ model: 'auto', messages, signal: controller.signal }, () => {}))
      .rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds cross-provider retries when both Auto and Gemini fail authorization', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ error: { message: 'Authorization failed' } }), { status: 403 })
    );

    await expect(new MultiModelProvider().streamChat({ model: 'auto', messages }, () => {}))
      .rejects.toThrow(/403|Authorization/);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(new Set(fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string).model)))
      .toEqual(new Set([MISTRAL_MODEL, 'gemini-2.5-flash']));
  });

  it('uses a working cross-provider response after Auto produces no visible content', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_endpoint, init) =>
      JSON.parse(init!.body as string).model === MISTRAL_MODEL
        ? sseResponse('data: [DONE]\n\n')
        : successfulResponse('A fallback answer')
    );
    const chunks: string[] = [];

    const result = await new MultiModelProvider().streamChat({ model: 'auto', messages }, (chunk) => chunks.push(chunk));

    expect(chunks.join('')).toBe('A fallback answer');
    expect(result.fullText).toBe('A fallback answer');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string).model).toBe('gemini-2.5-flash');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it.each([
    ['an empty stream', ': keepalive\n\ndata: [DONE]\n\n'],
    ['an embedded API error', data({ error: { message: 'Mistral generation failed' } })],
    ['a failed completion', data({ choices: [{ delta: {}, finish_reason: 'error', message: { content: 'Mistral generation failed' } }] })],
  ])('rejects %s instead of returning a successful blank answer', async (_description, wire) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse(wire));
    const chunks: string[] = [];

    await expect(new MultiModelProvider().streamChat({ model: 'auto', messages }, (chunk) => chunks.push(chunk)))
      .rejects.toThrow();

    expect(chunks).toEqual([]);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('propagates an error after visible content without appending a retry or fallback answer', async () => {
    vi.stubEnv('NVIDIA_API_KEYS', 'nvapi-test-primary,nvapi-test-secondary');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse(
      data({ choices: [{ delta: { content: 'A partial answer' } }] }) +
      data({ error: { message: 'Mistral stream disconnected' } })
    ));
    const chunks: string[] = [];

    await expect(new MultiModelProvider().streamChat({ model: 'auto', messages }, (chunk) => chunks.push(chunk)))
      .rejects.toThrow(/Mistral stream disconnected/);

    expect(chunks.join('')).toBe('A partial answer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('delivers and persists an Auto API answer with local mock fallback disabled', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'madura-mistral-api-'));
    const storage = new FileStore(temporaryDirectory);
    await storage.init();
    await storage.saveSettings({ model: 'auto', useMockFallback: false });
    const provider = new MultiModelProvider();
    const mockProvider = new MockProvider();
    const localFallback = vi.spyOn(mockProvider, 'streamChat');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => successfulResponse('Vanakkam!'));
    const chatService = new ChatService(storage, provider, mockProvider, undefined, false);
    const app = createApp({
      storage,
      nvidiaProvider: provider,
      mockProvider,
      documentService: new DocumentService(25),
      chatService,
    });

    const response = await request(app).post('/api/chat').send({ model: 'auto', message: 'Say hello' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = response.text.split('\n\n').filter((event) => event.startsWith('event: '));
    const tokenEvents = events.filter((event) => event.startsWith('event: token\n'));
    expect(tokenEvents.map((event) => JSON.parse(event.split('\ndata: ')[1]).token).join(''))
      .toBe('Vanakkam!');
    const doneEvent = events.find((event) => event.startsWith('event: done\n'));
    expect(doneEvent).toBeDefined();
    const done = JSON.parse(doneEvent!.split('\ndata: ')[1]);
    expect(done.assistantMessage).toMatchObject({ content: 'Vanakkam!', status: 'completed' });
    expect(await storage.getMessages(done.conversation.id))
      .toContainEqual(expect.objectContaining({ role: 'assistant', content: 'Vanakkam!', status: 'completed' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).model).toBe(MISTRAL_MODEL);
    expect(localFallback).not.toHaveBeenCalled();
  });

  it('retains a failed partial API answer without appending local fallback content', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'madura-mistral-api-'));
    const storage = new FileStore(temporaryDirectory);
    await storage.init();
    await storage.saveSettings({ model: 'auto', useMockFallback: true });
    const provider = new MultiModelProvider();
    const mockProvider = new MockProvider();
    const localFallback = vi.spyOn(mockProvider, 'streamChat');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse(
      data({ choices: [{ delta: { content: 'A partial answer' } }] }) +
      data({ error: { message: 'Mistral stream disconnected' } })
    ));
    const chatService = new ChatService(storage, provider, mockProvider, undefined, true);
    const app = createApp({
      storage,
      nvidiaProvider: provider,
      mockProvider,
      documentService: new DocumentService(25),
      chatService,
    });

    const response = await request(app).post('/api/chat').send({ model: 'auto', message: 'Say hello' });

    expect(response.status).toBe(200);
    const doneEvent = response.text.split('\n\n').find((event) => event.startsWith('event: done\n'));
    expect(doneEvent).toBeDefined();
    const done = JSON.parse(doneEvent!.split('\ndata: ')[1]);
    expect(done.assistantMessage).toMatchObject({
      content: 'A partial answer',
      status: 'failed',
      errorMessage: expect.stringContaining('Mistral stream disconnected'),
    });
    expect(await storage.getMessages(done.conversation.id))
      .toContainEqual(expect.objectContaining({ role: 'assistant', content: 'A partial answer', status: 'failed' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localFallback).not.toHaveBeenCalled();
  });

  it('routes oxlo model alias and deepseek-v3.2 to Oxlo API endpoint', async () => {
    vi.stubEnv('OXLO_API_KEY', 'sk_test_oxlo_key');
    vi.stubEnv('OXLO_BASE_URL', 'https://api.oxlo.ai/v1');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => successfulResponse('Oxlo response'));
    const provider = new MultiModelProvider();
    const chunks: string[] = [];

    // Test with model: 'oxlo' alias
    const result = await provider.streamChat(
      { model: 'oxlo', messages, temperature: 0.7, maxTokens: 1024 },
      (chunk) => chunks.push(chunk)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.oxlo.ai/v1/chat/completions');
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'deepseek-v3.2',
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
    });
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer sk_test_oxlo_key',
      Accept: 'text/event-stream',
    });
    expect(result.fullText).toBe('Oxlo response');
  });

  it('handles Oxlo object-style detail error response safely without crashing', async () => {
    vi.stubEnv('OXLO_API_KEY', 'sk_test_oxlo_key_1,sk_test_oxlo_key_2');
    vi.stubEnv('OXLO_BASE_URL', 'https://api.oxlo.ai/v1');

    let callCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Return Oxlo's structured object detail error (e.g. rate limit / model access denied)
        return new Response(
          JSON.stringify({
            detail: {
              error: 'model_access_denied',
              message: 'Your current plan does not include access',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return successfulResponse('Recovered on key 2');
    });

    const provider = new MultiModelProvider();
    const chunks: string[] = [];

    const result = await provider.streamChat(
      { model: 'deepseek-v3.2', messages, temperature: 0.7, maxTokens: 1024 },
      (chunk) => chunks.push(chunk)
    );

    expect(result.fullText).toBe('Recovered on key 2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
