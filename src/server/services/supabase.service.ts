import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { UserMemory } from '../../types/index.js';

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  dataDir?: string;
}

export class SupabaseService {
  private client: SupabaseClient | null = null;
  private isConfigured: boolean = false;
  private dataDir: string;
  private fallbackStorePath: string;
  private localMemories: Map<string, UserMemory[]> = new Map(); // userId -> UserMemory[]

  constructor(config?: Partial<SupabaseConfig>) {
    const url = config?.url || process.env.SUPABASE_URL || '';
    const key = config?.publishableKey || process.env.SUPABASE_PUBLISHABLE_KEY || '';
    this.dataDir = config?.dataDir || process.env.DATA_DIR || './data';
    this.fallbackStorePath = path.join(this.dataDir, 'user_memories.json');

    if (url && key && !url.includes('your_supabase')) {
      try {
        this.client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        this.isConfigured = true;
      } catch (err) {
        console.warn('[SupabaseService] Client initialization error:', err);
      }
    }

    this.loadLocalFallback();
  }

  isReady(): boolean {
    return this.isConfigured && this.client !== null;
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  /**
   * Validates a bearer token against Supabase Auth and returns the authenticated user ID.
   * If no valid token or auth error, returns null or fallback guest ID.
   */
  async verifyUserToken(token?: string): Promise<string | null> {
    if (!token || !this.client) return null;
    try {
      const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
      const { data, error } = await this.client.auth.getUser(cleanToken);
      if (error || !data.user) {
        return null;
      }
      return data.user.id;
    } catch {
      return null;
    }
  }

  /**
   * Persists a new user memory to Supabase table `user_memories`,
   * with automatic fallback to local JSON store if tables are not yet created.
   */
  async saveMemory(memory: UserMemory): Promise<boolean> {
    // 1. Always keep local mirror updated for resilience
    this.addLocalMemory(memory);

    // 2. Persist to Supabase if available
    if (this.client) {
      try {
        const row = {
          id: memory.id,
          user_id: memory.userId,
          memory_type: memory.memoryType,
          content: memory.content,
          embedding: memory.embedding && memory.embedding.length > 0 ? memory.embedding : null,
          source_conversation_id: memory.sourceConversationId || null,
          importance: memory.importance || 3,
          created_at: new Date(memory.createdAt).toISOString(),
          updated_at: new Date(memory.updatedAt).toISOString(),
          last_accessed_at: new Date(memory.lastAccessedAt).toISOString(),
        };

        const { error } = await this.client
          .from('user_memories')
          .upsert(row, { onConflict: 'id' });

        if (error) {
          // Table may not be created yet in Supabase SQL editor
          if (error.code === 'PGRST205') {
            // Expected before user runs the SQL migration in dashboard
            return true;
          }
          console.warn('[SupabaseService] Save memory notice:', error.message);
        } else {
          return true;
        }
      } catch (err: any) {
        console.warn('[SupabaseService] Error saving to Supabase:', err.message);
      }
    }

    return true;
  }

  /**
   * Retrieves all memories for a user.
   */
  async getMemories(userId: string): Promise<UserMemory[]> {
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('user_memories')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return data.map((d: any) => ({
            id: d.id,
            userId: d.user_id,
            memoryType: d.memory_type,
            content: d.content,
            embedding: d.embedding,
            sourceConversationId: d.source_conversation_id,
            importance: d.importance,
            createdAt: new Date(d.created_at).getTime(),
            updatedAt: new Date(d.updated_at).getTime(),
            lastAccessedAt: new Date(d.last_accessed_at).getTime(),
          }));
        }
      } catch (err: any) {
        // Fallback to local store
      }
    }

    return this.localMemories.get(userId) || [];
  }

  /**
   * Updates an existing memory's content or importance.
   */
  async updateMemory(userId: string, id: string, updates: Partial<UserMemory>): Promise<boolean> {
    // 1. Update local
    const list = this.localMemories.get(userId) || [];
    const idx = list.findIndex((m) => m.id === id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        ...updates,
        updatedAt: Date.now(),
      };
      this.persistLocalFallback();
    }

    // 2. Update Supabase
    if (this.client) {
      try {
        const payload: any = {
          updated_at: new Date().toISOString(),
        };
        if (updates.content) payload.content = updates.content;
        if (updates.importance) payload.importance = updates.importance;
        if (updates.embedding) payload.embedding = updates.embedding;

        await this.client
          .from('user_memories')
          .update(payload)
          .eq('id', id)
          .eq('user_id', userId);
      } catch {}
    }

    return true;
  }

  /**
   * Deletes a single memory by ID for a user.
   */
  async deleteMemory(userId: string, id: string): Promise<boolean> {
    // 1. Delete local
    const list = this.localMemories.get(userId) || [];
    this.localMemories.set(userId, list.filter((m) => m.id !== id));
    this.persistLocalFallback();

    // 2. Delete Supabase
    if (this.client) {
      try {
        await this.client
          .from('user_memories')
          .delete()
          .eq('id', id)
          .eq('user_id', userId);
      } catch {}
    }

    return true;
  }

  /**
   * Clears all memories for a user.
   */
  async clearMemories(userId: string): Promise<boolean> {
    this.localMemories.delete(userId);
    this.persistLocalFallback();

    if (this.client) {
      try {
        await this.client
          .from('user_memories')
          .delete()
          .eq('user_id', userId);
      } catch {}
    }

    return true;
  }

  /**
   * Vector search using Supabase RPC `match_user_memories`.
   */
  async searchMemoriesRPC(
    userId: string,
    queryEmbedding: number[],
    threshold: number = 0.5,
    limit: number = 6
  ): Promise<UserMemory[] | null> {
    if (!this.client || !queryEmbedding || queryEmbedding.length === 0) {
      return null;
    }

    try {
      const { data, error } = await this.client.rpc('match_user_memories', {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: limit,
        p_user_id: userId,
      });

      if (error || !data) {
        return null;
      }

      return data.map((d: any) => ({
        id: d.id,
        userId: d.user_id,
        memoryType: d.memory_type,
        content: d.content,
        importance: d.importance,
        similarity: d.similarity,
        createdAt: new Date(d.created_at).getTime(),
        updatedAt: new Date(d.created_at).getTime(),
        lastAccessedAt: new Date().getTime(),
      }));
    } catch {
      return null;
    }
  }

  // --- Local Fallback Persistence Methods ---

  private addLocalMemory(memory: UserMemory) {
    const list = this.localMemories.get(memory.userId) || [];
    const existingIdx = list.findIndex((m) => m.id === memory.id);
    if (existingIdx !== -1) {
      list[existingIdx] = memory;
    } else {
      list.push(memory);
    }
    this.localMemories.set(memory.userId, list);
    this.persistLocalFallback();
  }

  private loadLocalFallback() {
    try {
      if (fs.existsSync(this.fallbackStorePath)) {
        const raw = fs.readFileSync(this.fallbackStorePath, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [uid, items] of Object.entries(parsed)) {
          this.localMemories.set(uid, items as UserMemory[]);
        }
      }
    } catch {}
  }

  private persistLocalFallback() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const obj: Record<string, UserMemory[]> = {};
      for (const [uid, items] of this.localMemories.entries()) {
        obj[uid] = items;
      }
      fs.writeFileSync(this.fallbackStorePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {}
  }
}
