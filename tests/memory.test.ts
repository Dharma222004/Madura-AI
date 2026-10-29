import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MemoryService } from '../src/server/services/memory.service.js';
import { SupabaseService } from '../src/server/services/supabase.service.js';
import { EmbeddingService } from '../src/server/services/embedding.service.js';

describe('Persistent Memory & Supabase Retrieval System', () => {
  const testDir = './data/test_memory';
  let supabaseService: SupabaseService;
  let embeddingService: EmbeddingService;
  let memoryService: MemoryService;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    supabaseService = new SupabaseService({ dataDir: testDir });
    embeddingService = new EmbeddingService('mock-api-key', 'https://integrate.api.nvidia.com/v1');
    memoryService = new MemoryService(supabaseService, embeddingService);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('1. should extract and save useful facts from user statements (Dharma & Harma scenario)', async () => {
    const userMessage = 'My name is Dharma, and I am developing a personal AI assistant called Harma.';
    const saved = await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage,
      conversationId: 'conv-session-1',
    });

    expect(saved.length).toBeGreaterThanOrEqual(1);
    const combinedContent = saved.map((s) => s.content).join(' ');
    expect(combinedContent).toContain('Dharma');
    expect(combinedContent).toContain('Harma');

    // Verify stored in SupabaseService
    const stored = await supabaseService.getMemories('user-dharma');
    expect(stored.length).toBeGreaterThanOrEqual(1);
  });

  it('2. should retrieve the stored fact in a separate conversation session', async () => {
    // Session 1: User introduces themselves
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: 'My name is Dharma, and I am developing a personal AI assistant called Harma.',
      conversationId: 'conv-session-1',
    });

    // Session 2: Days later, new conversation with exact question
    const query = 'What is the name of the AI assistant I am developing?';
    const retrieved = await memoryService.retrieveRelevantMemories('user-dharma', query);

    expect(retrieved.length).toBeGreaterThan(0);
    const topResult = retrieved[0];
    expect(topResult.content.toLowerCase()).toContain('harma');
    expect(topResult.content.toLowerCase()).toContain('developing');
  });

  it('3. should retrieve memories from paraphrased questions', async () => {
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: 'My name is Dharma, and I am developing a personal AI assistant called Harma.',
      conversationId: 'conv-1',
    });

    // Paraphrased query 1
    const p1 = await memoryService.retrieveRelevantMemories('user-dharma', 'Tell me about the assistant project I am building');
    expect(p1.some((m) => m.content.toLowerCase().includes('harma'))).toBe(true);

    // Paraphrased query 2
    const p2 = await memoryService.retrieveRelevantMemories('user-dharma', 'Do you remember what my name is?');
    expect(p2.some((m) => m.content.toLowerCase().includes('dharma'))).toBe(true);
  });

  it('4. should update memory when user provides a correction', async () => {
    // Initial memory
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: 'My name is Dharma, and I am developing a personal AI assistant called Harma.',
      conversationId: 'conv-1',
    });

    // User corrects the project name
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: 'Actually, I am developing a personal AI assistant called Harma Pro.',
      conversationId: 'conv-2',
    });

    const memories = await memoryService.listMemories('user-dharma');
    const projectMem = memories.find((m) => m.memoryType === 'project');
    expect(projectMem).toBeDefined();
    expect(projectMem?.content).toContain('Harma Pro');
  });

  it('5. should prevent duplicate memories for the same fact', async () => {
    const text = 'My name is Dharma, and I am developing a personal AI assistant called Harma.';
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: text,
      conversationId: 'conv-1',
    });

    const countAfterFirst = (await memoryService.listMemories('user-dharma')).length;

    // Repeating the same fact
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: text,
      conversationId: 'conv-2',
    });

    const countAfterSecond = (await memoryService.listMemories('user-dharma')).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('6. should enforce strict user isolation (no cross-user memory leakage)', async () => {
    // User 1
    await memoryService.processAndSaveMemories({
      userId: 'user-alice',
      userMessage: 'My name is Alice and I am developing Project Wonderland.',
      conversationId: 'conv-alice',
    });

    // User 2
    await memoryService.processAndSaveMemories({
      userId: 'user-bob',
      userMessage: 'My name is Bob and I am developing Project Builder.',
      conversationId: 'conv-bob',
    });

    // Alice queries memories
    const aliceMems = await memoryService.retrieveRelevantMemories('user-alice', 'What project am I developing?');
    expect(aliceMems.every((m) => !m.content.includes('Builder'))).toBe(true);
    expect(aliceMems.some((m) => m.content.includes('Wonderland'))).toBe(true);

    // Bob queries memories
    const bobMems = await memoryService.retrieveRelevantMemories('user-bob', 'What project am I developing?');
    expect(bobMems.every((m) => !m.content.includes('Wonderland'))).toBe(true);
    expect(bobMems.some((m) => m.content.includes('Builder'))).toBe(true);
  });

  it('7. should handle memory deletion and clearing', async () => {
    await memoryService.processAndSaveMemories({
      userId: 'user-dharma',
      userMessage: 'My name is Dharma, and I am developing a personal AI assistant called Harma.',
      conversationId: 'conv-1',
    });

    let memories = await memoryService.listMemories('user-dharma');
    expect(memories.length).toBeGreaterThan(0);

    // Delete one memory
    await memoryService.deleteMemory('user-dharma', memories[0].id);
    const afterDelete = await memoryService.listMemories('user-dharma');
    expect(afterDelete.length).toBe(memories.length - 1);

    // Clear all
    await memoryService.clearMemories('user-dharma');
    const afterClear = await memoryService.listMemories('user-dharma');
    expect(afterClear.length).toBe(0);
  });

  it('8. should format memories safely into prompt injection context', () => {
    const memories = [
      {
        id: 'mem-1',
        userId: 'user-dharma',
        memoryType: 'profile' as const,
        content: "User's name is Dharma.",
        importance: 5,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        lastAccessedAt: 1700000000000,
      },
      {
        id: 'mem-2',
        userId: 'user-dharma',
        memoryType: 'project' as const,
        content: 'User is developing a personal AI assistant called Harma.',
        importance: 5,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        lastAccessedAt: 1700000000000,
      },
    ];

    const block = memoryService.formatMemoriesForPrompt(memories);
    expect(block).toContain('[Persistent User Memory Grounding (Retrieved from Supabase Store)]');
    expect(block).toContain("User's name is Dharma.");
    expect(block).toContain('User is developing a personal AI assistant called Harma.');
    expect(block).toContain('[System Directive:');
  });

  it('9. should accurately calculate cosine similarity for vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(embeddingService.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    expect(embeddingService.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 5);
  });
});
