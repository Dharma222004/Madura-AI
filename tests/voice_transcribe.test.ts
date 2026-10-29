import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { createApp } from '../src/server/app.js';
import { FileStore } from '../src/server/store/file.store.js';
import { NvidiaProvider } from '../src/server/providers/nvidia.provider.js';
import { MockProvider } from '../src/server/providers/mock.provider.js';
import { DocumentService } from '../src/server/services/document.service.js';
import { ChatService } from '../src/server/services/chat.service.js';
import { SpeechService } from '../src/server/services/speech.service.js';

// Helper to generate a minimal valid 16kHz mono WAV buffer
function createSampleWav(durationSeconds: number = 0.5): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  return buffer;
}

describe('Groq Whisper Large V3 Turbo Voice-to-Text System', () => {
  const testDir = './data-voice-test';
  let app: any;
  let speechService: SpeechService;

  beforeEach(async () => {
    const storage = new FileStore(testDir);
    await storage.init();
    const nvidiaProvider = new NvidiaProvider('test-key');
    const mockProvider = new MockProvider();
    speechService = new SpeechService('mock-groq-key', 'whisper-large-v3-turbo');
    const documentService = new DocumentService(25, undefined, speechService);
    const chatService = new ChatService(storage, nvidiaProvider, mockProvider, true);

    app = createApp({
      storage,
      nvidiaProvider,
      mockProvider,
      documentService,
      chatService,
      speechService,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('1. SpeechService Model & Configuration', () => {
    it('should use whisper-large-v3-turbo model identifier', () => {
      expect(speechService.model).toBe('whisper-large-v3-turbo');
    });

    it('should accurately validate supported audio formats', () => {
      expect(speechService.isAudioFormatSupported('recording.webm', 'audio/webm')).toBe(true);
      expect(speechService.isAudioFormatSupported('voice.wav', 'audio/wav')).toBe(true);
      expect(speechService.isAudioFormatSupported('note.mp3', 'audio/mpeg')).toBe(true);
      expect(speechService.isAudioFormatSupported('audio.ogg', 'audio/ogg')).toBe(true);
      expect(speechService.isAudioFormatSupported('voice.m4a', 'audio/mp4')).toBe(true);
      expect(speechService.isAudioFormatSupported('voice.flac', 'audio/flac')).toBe(true);

      // Rejects non-audio formats
      expect(speechService.isAudioFormatSupported('doc.pdf', 'application/pdf')).toBe(false);
      expect(speechService.isAudioFormatSupported('text.txt', 'text/plain')).toBe(false);
      expect(speechService.isAudioFormatSupported('app.exe', 'application/octet-stream')).toBe(false);
    });

    it('should reject empty audio buffers (< 32 bytes)', async () => {
      const emptyBuffer = Buffer.alloc(10);
      await expect(
        speechService.transcribeAudio(emptyBuffer, 'test.webm', 'audio/webm')
      ).rejects.toThrow(/empty or corrupt/i);
    });

    it('should reject files exceeding 25 MB Groq limit', async () => {
      // Create a virtual buffer header that indicates 26MB
      const hugeBuffer = { length: 26 * 1024 * 1024 } as unknown as Buffer;
      await expect(
        speechService.transcribeAudio(hugeBuffer, 'huge.wav', 'audio/wav')
      ).rejects.toThrow(/exceeds maximum size/i);
    });
  });

  describe('2. Endpoint Authentication & Authorization', () => {
    it('should reject unauthenticated requests without session identifier with 401', async () => {
      const sampleWav = createSampleWav(0.2);
      const res = await request(app)
        .post('/api/transcribe')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });

    it('should accept requests with x-user-id header', async () => {
      const sampleWav = createSampleWav(0.2);

      // Mock upstream Groq response
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({ text: 'Hello, testing voice input with Groq Whisper.', duration: 1.2 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'test-user-123')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(200);
      expect(res.body.text).toContain('Hello, testing voice input');
      expect(res.body.model).toBe('whisper-large-v3-turbo');
    });
  });

  describe('3. Audio File Format & Payload Validation', () => {
    it('should return 400 when no audio file is provided', async () => {
      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No audio file provided');
    });

    it('should return 400 when uploaded audio file is too short/empty', async () => {
      const emptyBuffer = Buffer.alloc(20);
      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .attach('file', emptyBuffer, 'empty.webm');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('empty or too short');
    });

    it('should return 415 when unsupported file format is uploaded', async () => {
      const fakeDoc = Buffer.from('This is a text file, not speech audio');
      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .attach('file', fakeDoc, 'readme.txt');

      expect(res.status).toBe(415);
      expect(res.body.error).toContain('Unsupported audio format');
    });
  });

  describe('4. Language Support & Groq API Integration', () => {
    it('should pass English (en) parameter when requested', async () => {
      const sampleWav = createSampleWav(0.5);

      let capturedBody: FormData | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
        capturedBody = init?.body as FormData;
        return new Response(
          JSON.stringify({ text: 'Artificial intelligence is developing rapidly.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .field('language', 'en')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(200);
      expect(res.body.text).toBe('Artificial intelligence is developing rapidly.');
      expect(capturedBody).not.toBeNull();
      expect((capturedBody as any).get('language')).toBe('en');
      expect((capturedBody as any).get('model')).toBe('whisper-large-v3-turbo');
    });

    it('should pass Tamil (ta) parameter for Tamil speech recognition', async () => {
      const sampleWav = createSampleWav(0.5);

      let capturedLanguage: string | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
        const fd = init?.body as FormData;
        capturedLanguage = fd.get('language') as string;
        return new Response(
          JSON.stringify({ text: 'வணக்கம், மதுரை AI உங்களை வரவேற்கிறது.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .field('language', 'ta')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(200);
      expect(res.body.text).toBe('வணக்கம், மதுரை AI உங்களை வரவேற்கிறது.');
      expect(capturedLanguage).toBe('ta');
    });

    it('should omit language parameter when "auto" is selected', async () => {
      const sampleWav = createSampleWav(0.5);

      let capturedLanguage: any = undefined;
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
        const fd = init?.body as FormData;
        capturedLanguage = fd.get('language');
        return new Response(
          JSON.stringify({ text: 'Automatically detected language text.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .field('language', 'auto')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(200);
      expect(capturedLanguage).toBeNull(); // omitted from FormData
    });
  });

  describe('5. Error Handling, Resilience & Rate Limits', () => {
    it('should handle Groq rate limit (429) gracefully', async () => {
      const sampleWav = createSampleWav(0.3);

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limit exceeded: TPM limit' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(429);
      expect(res.body.error.toLowerCase()).toContain('rate limit');
    });

    it('should never expose GROQ_API_KEY on authentication failure', async () => {
      const sampleWav = createSampleWav(0.3);

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({ error: { message: 'Invalid API Key provided: gsk_test...' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(503);
      // Ensure the raw key is never echoed
      expect(JSON.stringify(res.body)).not.toContain('gsk_');
    });

    it('should handle empty speech detection gracefully without throwing an error', async () => {
      const sampleWav = createSampleWav(0.3);

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({ text: '   ' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await request(app)
        .post('/api/transcribe')
        .set('x-user-id', 'user-1')
        .attach('file', sampleWav, 'recording.wav');

      expect(res.status).toBe(200);
      expect(res.body.text).toBe('');
      expect(res.body.message).toContain('No clear speech detected');
    });
  });

  describe('6. Real End-to-End Live API Transcription (when key configured)', () => {
    it('should successfully communicate with Groq Whisper Large V3 Turbo with live credentials', async () => {
      const realKey = process.env.GROQ_API_KEY;
      if (!realKey || realKey.includes('your_groq')) {
        console.log('[LiveTest] Skipped: real GROQ_API_KEY not configured.');
        return;
      }

      const liveSpeechService = new SpeechService(realKey, 'whisper-large-v3-turbo');
      const sampleWav = createSampleWav(0.8);

      const result = await liveSpeechService.transcribeAudio(sampleWav, 'live_sample.wav', 'audio/wav', {
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(result.model).toBe('whisper-large-v3-turbo');
      expect(typeof result.text).toBe('string');
      console.log(`[LiveTest] Live Groq transcription successful: "${result.text}" (model: ${result.model})`);
    });
  });
});
