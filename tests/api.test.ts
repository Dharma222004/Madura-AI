import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { createApp } from '../src/server/app.js';
import { FileStore } from '../src/server/store/file.store.js';
import { NvidiaProvider } from '../src/server/providers/nvidia.provider.js';
import { MockProvider } from '../src/server/providers/mock.provider.js';
import { DocumentService } from '../src/server/services/document.service.js';
import { ChatService } from '../src/server/services/chat.service.js';

describe('Madura AI API Endpoints', () => {
  const testDir = './data-api-test';
  let app: any;
  let storage: FileStore;

  beforeEach(async () => {
    storage = new FileStore(testDir);
    await storage.init();
    const nvidiaProvider = new NvidiaProvider('test-key');
    const mockProvider = new MockProvider();
    const documentService = new DocumentService(25);
    const chatService = new ChatService(storage, nvidiaProvider, mockProvider, true);

    app = createApp({
      storage,
      nvidiaProvider,
      mockProvider,
      documentService,
      chatService,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('GET /api/health should return 200 and healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.app).toBe('Madura AI');
  });

  it('GET /api/models should list available models', async () => {
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(res.body.models.length).toBeGreaterThan(0);
  });

  it('CRUD /api/conversations workflow', async () => {
    // 1. Create
    const createRes = await request(app)
      .post('/api/conversations')
      .send({ title: 'Integration Test Chat' });
    expect(createRes.status).toBe(201);
    const convId = createRes.body.conversation.id;
    expect(convId).toBeDefined();

    // 2. Read single
    const getRes = await request(app).get(`/api/conversations/${convId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.conversation.title).toBe('Integration Test Chat');

    // 3. Update title and pin
    const patchRes = await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ title: 'Renamed Chat', pinned: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.conversation.title).toBe('Renamed Chat');
    expect(patchRes.body.conversation.pinned).toBe(true);

    // 4. Delete
    const delRes = await request(app).delete(`/api/conversations/${convId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // 5. Verify deleted
    const verifyRes = await request(app).get(`/api/conversations/${convId}`);
    expect(verifyRes.status).toBe(404);
  });

  it('GET & POST /api/settings', async () => {
    const getRes = await request(app).get('/api/settings');
    expect(getRes.status).toBe(200);
    expect(getRes.body.settings.model).toBeDefined();

    const postRes = await request(app)
      .post('/api/settings')
      .send({ temperature: 0.1, enterToSend: false });
    expect(postRes.status).toBe(200);
    expect(postRes.body.settings.temperature).toBe(0.1);
    expect(postRes.body.settings.enterToSend).toBe(false);
  });

  it('POST /api/upload should process multipart file uploads', async () => {
    const fileContent = 'Sample file content for upload test';
    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from(fileContent), 'test-upload.txt');

    expect(res.status).toBe(200);
    expect(res.body.attachment).toBeDefined();
    expect(res.body.attachment.fileName).toBe('test-upload.txt');
    expect(res.body.attachment.extractedText).toBe(fileContent);
  });

  it('POST /api/chat/abort should accept conversation abort requests', async () => {
    const res = await request(app)
      .post('/api/chat/abort')
      .send({ conversationId: 'dummy-id' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should include security headers on all responses', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
  });
});
