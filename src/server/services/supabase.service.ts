import fs from 'fs';
import path from 'path';
import { UserMemory } from '../../types/index.js';

export interface LocalMemoryConfig {
  dataDir?: string;
  url?: string;
  publishableKey?: string;
}

/**
 * Local memory store — persistent JSON file-backed storage.
 * Completely replaces external Supabase dependency.
 */
export class SupabaseService {
  private dataDir: string;
  private storePath: string;
  private localMemories: Map<string, UserMemory[]> = new Map(); // userId -> UserMemory[]

  constructor(config?: Partial<LocalMemoryConfig>) {
    this.dataDir = config?.dataDir || process.env.DATA_DIR || './data';
    this.storePath = path.join(this.dataDir, 'user_memories.json');
    this.loadStore();
  }

  isReady(): boolean {
    return true;
  }

  getClient(): null {
    return null;
  }

  /**
   * Token verification stub (local auth uses x-user-id header).
   */
  async verifyUserToken(token?: string): Promise<string | null> {
    if (!token) return null;
    return null;
  }

  /**
   * Persists a memory to the local JSON store.
   */
  async saveMemory(memory: UserMemory): Promise<boolean> {
    const list = this.localMemories.get(memory.userId) || [];
    const existingIdx = list.findIndex((m) => m.id === memory.id);
    if (existingIdx !== -1) {
      list[existingIdx] = memory;
    } else {
      list.push(memory);
    }
    this.localMemories.set(memory.userId, list);
    this.persistStore();
    return true;
  }

  /**
   * Retrieves all memories for a user.
   */
  async getMemories(userId: string): Promise<UserMemory[]> {
    return this.localMemories.get(userId) || [];
  }

  /**
   * Updates an existing memory's content or importance.
   */
  async updateMemory(userId: string, id: string, updates: Partial<UserMemory>): Promise<boolean> {
    const list = this.localMemories.get(userId) || [];
    const idx = list.findIndex((m) => m.id === id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        ...updates,
        updatedAt: Date.now(),
      };
      this.localMemories.set(userId, list);
      this.persistStore();
      return true;
    }
    return false;
  }

  /**
   * Deletes a single memory by ID for a user.
   */
  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const list = this.localMemories.get(userId) || [];
    this.localMemories.set(
      userId,
      list.filter((m) => m.id !== id)
    );
    this.persistStore();
    return true;
  }

  /**
   * Clears all memories for a user.
   */
  async clearMemories(userId: string): Promise<boolean> {
    this.localMemories.delete(userId);
    this.persistStore();
    return true;
  }

  /**
   * Stub for vector search RPC (MemoryService handles vector similarity locally).
   */
  async searchMemoriesRPC(
    _userId: string,
    _queryEmbedding: number[],
    _threshold: number = 0.5,
    _limit: number = 6
  ): Promise<UserMemory[] | null> {
    return null;
  }

  private loadStore() {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [uid, items] of Object.entries(parsed)) {
          this.localMemories.set(uid, items as UserMemory[]);
        }
      }
    } catch (err: any) {
      console.warn('[MemoryStore] Notice loading local memories:', err.message);
    }
  }

  private persistStore() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const obj: Record<string, UserMemory[]> = {};
      for (const [uid, items] of this.localMemories.entries()) {
        obj[uid] = items;
      }
      fs.writeFileSync(this.storePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[MemoryStore] Notice persisting local memories:', err.message);
    }
  }
}
