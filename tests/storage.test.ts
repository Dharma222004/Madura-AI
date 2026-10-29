import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FileStore } from '../src/server/store/file.store.js';

describe('FileStore Persistence', () => {
  const testDir = './data-test';
  let store: FileStore;

  beforeEach(async () => {
    store = new FileStore(testDir);
    await store.init();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize and return default settings', async () => {
    const settings = await store.getSettings();
    expect(settings).toBeDefined();
    expect(settings.model).toBe('auto');
    expect(settings.temperature).toBe(0.7);
  });

  it('should save and retrieve updated settings', async () => {
    await store.saveSettings({ temperature: 0.2, enterToSend: false });
    const updated = await store.getSettings();
    expect(updated.temperature).toBe(0.2);
    expect(updated.enterToSend).toBe(false);
  });

  it('should create and retrieve conversations with message cascading', async () => {
    const conv = await store.createConversation({
      id: 'conv-1',
      title: 'First Chat',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(conv.id).toBe('conv-1');

    // Add messages
    await store.addMessage({
      id: 'msg-1',
      conversationId: 'conv-1',
      role: 'user',
      content: 'Hello Madura',
      status: 'completed',
      createdAt: 1000,
    });

    await store.addMessage({
      id: 'msg-2',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Hello! How can I assist you?',
      status: 'completed',
      createdAt: 2000,
    });

    const retrieved = await store.getConversation('conv-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.messages?.length).toBe(2);
    expect(retrieved?.messages?.[0].content).toBe('Hello Madura');
    expect(retrieved?.messages?.[1].content).toBe('Hello! How can I assist you?');
  });

  it('should pin and sort conversations properly', async () => {
    await store.createConversation({
      id: 'conv-a',
      title: 'Alpha',
      model: 'model',
      pinned: false,
      createdAt: 100,
      updatedAt: 100,
    });

    await store.createConversation({
      id: 'conv-b',
      title: 'Beta (Pinned)',
      model: 'model',
      pinned: true,
      createdAt: 50,
      updatedAt: 50,
    });

    const list = await store.getConversations();
    expect(list[0].id).toBe('conv-b'); // Pinned conversation comes first
  });

  it('should search conversations by title or message content', async () => {
    await store.createConversation({
      id: 'conv-x',
      title: 'Python Scripting',
      model: 'model',
      pinned: false,
      createdAt: 100,
      updatedAt: 100,
    });

    await store.createConversation({
      id: 'conv-y',
      title: 'Casual Chat',
      model: 'model',
      pinned: false,
      createdAt: 200,
      updatedAt: 200,
    });

    await store.addMessage({
      id: 'msg-y',
      conversationId: 'conv-y',
      role: 'user',
      content: 'Can you explain quantum computing?',
      status: 'completed',
      createdAt: 300,
    });

    const resultsByTitle = await store.getConversations('python');
    expect(resultsByTitle.length).toBe(1);
    expect(resultsByTitle[0].id).toBe('conv-x');

    const resultsByContent = await store.getConversations('quantum');
    expect(resultsByContent.length).toBe(1);
    expect(resultsByContent[0].id).toBe('conv-y');
  });

  it('should delete conversation and remove its messages', async () => {
    await store.createConversation({
      id: 'conv-del',
      title: 'To Delete',
      model: 'model',
      pinned: false,
      createdAt: 100,
      updatedAt: 100,
    });

    await store.addMessage({
      id: 'msg-del',
      conversationId: 'conv-del',
      role: 'user',
      content: 'Goodbye',
      status: 'completed',
      createdAt: 100,
    });

    await store.deleteConversation('conv-del');
    const conv = await store.getConversation('conv-del');
    expect(conv).toBeNull();

    const messages = await store.getMessages('conv-del');
    expect(messages.length).toBe(0);
  });
});
