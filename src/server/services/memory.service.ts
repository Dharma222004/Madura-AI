import { v4 as uuidv4 } from 'uuid';
import { UserMemory, MemoryType } from '../../types/index.js';
import { SupabaseService } from './supabase.service.js';
import { EmbeddingService } from './embedding.service.js';
import { NvidiaProvider } from '../providers/nvidia.provider.js';

export interface ExtractedFact {
  content: string;
  memoryType: MemoryType;
  importance: number;
}

export class MemoryService {
  private supabaseService: SupabaseService;
  private embeddingService: EmbeddingService;
  private nvidiaProvider?: NvidiaProvider;

  constructor(
    supabaseService: SupabaseService,
    embeddingService: EmbeddingService,
    nvidiaProvider?: NvidiaProvider
  ) {
    this.supabaseService = supabaseService;
    this.embeddingService = embeddingService;
    this.nvidiaProvider = nvidiaProvider;
  }

  /**
   * Retrieves relevant memories for a user given their current prompt.
   * Uses hybrid retrieval: Vector Semantic Similarity + Exact Keyword Match + Importance + Recency.
   */
  async retrieveRelevantMemories(
    userId: string,
    query: string,
    maxCount: number = 6
  ): Promise<UserMemory[]> {
    if (!query || !query.trim() || !userId) return [];

    const allUserMemories = await this.supabaseService.getMemories(userId);
    if (!allUserMemories || allUserMemories.length === 0) return [];

    // 1. Generate query embedding if embedding service is ready
    let queryEmbedding: number[] | null = null;
    if (this.embeddingService.isConfigured()) {
      try {
        queryEmbedding = await this.embeddingService.embedOne(query, 'query');
      } catch (err) {
        console.warn('[MemoryService] Query embedding failed, falling back to keyword search:', err);
      }
    }

    // 2. Tokenize query words for lexical match
    const stopWords = new Set(['what', 'is', 'the', 'of', 'i', 'am', 'a', 'an', 'my', 'me', 'in', 'and', 'to', 'for', 'called', 'name']);
    const queryTokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // 3. Score all memories
    const scored = allUserMemories.map((mem) => {
      let simScore = 0;
      if (queryEmbedding && mem.embedding && mem.embedding.length > 0) {
        simScore = this.embeddingService.cosineSimilarity(queryEmbedding, mem.embedding);
      }

      // Keyword match score
      let keywordHits = 0;
      const memTextLower = mem.content.toLowerCase();
      for (const token of queryTokens) {
        if (memTextLower.includes(token)) {
          keywordHits++;
        }
      }
      const keywordScore = queryTokens.length > 0 ? keywordHits / queryTokens.length : 0;

      // Recency factor (0 to 1 based on last 30 days)
      const ageDays = (Date.now() - (mem.updatedAt || mem.createdAt)) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - ageDays / 30);

      // Importance factor (1 to 5 normalized to 0.2 to 1.0)
      const importanceScore = (mem.importance || 3) / 5;

      // Hybrid rank formula:
      // If we have embedding: 50% semantic, 30% keyword, 10% importance, 10% recency
      // If no embedding: 75% keyword, 15% importance, 10% recency
      const totalScore = queryEmbedding && mem.embedding
        ? simScore * 0.5 + keywordScore * 0.3 + importanceScore * 0.1 + recencyScore * 0.1
        : keywordScore * 0.75 + importanceScore * 0.15 + recencyScore * 0.1;

      return {
        ...mem,
        similarity: totalScore,
      };
    });

    // 4. Filter by minimum relevance threshold and sort descending
    const threshold = queryEmbedding ? 0.35 : 0.2;
    const filtered = scored
      .filter((m) => (m.similarity || 0) >= threshold)
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, maxCount);

    // 5. Update last_accessed_at in background for retrieved memories
    if (filtered.length > 0) {
      const now = Date.now();
      for (const m of filtered) {
        this.supabaseService.updateMemory(userId, m.id, { lastAccessedAt: now }).catch(() => {});
      }
    }

    return filtered;
  }

  /**
   * Formats retrieved memories into a safe prompt context block.
   */
  formatMemoriesForPrompt(memories: UserMemory[]): string {
    if (!memories || memories.length === 0) return '';

    const lines = memories.map((m) => {
      const dateStr = new Date(m.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      return `- [${m.memoryType.toUpperCase()}] ${m.content} (Recorded: ${dateStr})`;
    });

    return `[Persistent User Memory Grounding (Retrieved from Supabase Store)]\n${lines.join('\n')}\n[System Directive: The memories above reflect verified long-term facts about the user from previous conversations. If the user asks about prior details, preferences, projects, or background, answer accurately using these facts. Do not invent contradictory facts.]`;
  }

  /**
   * Extracts useful facts from a conversation turn and persists them.
   * Runs asynchronously in the background.
   */
  async processAndSaveMemories(params: {
    userId: string;
    userMessage: string;
    assistantMessage?: string;
    conversationId?: string;
  }): Promise<UserMemory[]> {
    const { userId, userMessage, conversationId } = params;
    if (!userId || !userMessage || !userMessage.trim()) return [];

    // Filter out obvious transient or short non-informative messages
    const trimmed = userMessage.trim();
    if (trimmed.length < 10) return [];
    if (/^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|yes|no)\b/i.test(trimmed)) {
      return [];
    }

    // 1. Extract candidate facts via heuristics + LLM
    const facts = await this.extractFacts(trimmed, params.assistantMessage);
    if (facts.length === 0) return [];

    const savedMemories: UserMemory[] = [];
    const existingMemories = await this.supabaseService.getMemories(userId);

    for (const fact of facts) {
      // 2. Generate embedding for the new fact
      let embedding: number[] | undefined;
      if (this.embeddingService.isConfigured()) {
        const emb = await this.embeddingService.embedOne(fact.content, 'passage');
        if (emb && emb.length > 0) embedding = emb;
      }

      // 3. Deduplication and contradiction check against existing user memories
      let duplicateOrUpdated = false;
      for (const existing of existingMemories) {
        let isMatch = false;

        // Check semantic similarity if embeddings exist
        if (embedding && existing.embedding && existing.embedding.length > 0) {
          const sim = this.embeddingService.cosineSimilarity(embedding, existing.embedding);
          if (sim > 0.88) {
            isMatch = true;
          }
        }

        // Check lexical similarity (e.g. same core subject like "name is Dharma" or "assistant called Harma")
        const factLower = fact.content.toLowerCase();
        const existLower = existing.content.toLowerCase();
        if (
          (fact.memoryType === 'profile' && existLower.includes('name') && factLower.includes('name')) ||
          (fact.memoryType === 'project' && existLower.includes('developing') && factLower.includes('developing'))
        ) {
          isMatch = true;
        }

        if (isMatch) {
          // Update existing memory with fresher content & timestamp
          await this.supabaseService.updateMemory(userId, existing.id, {
            content: fact.content,
            embedding,
            importance: Math.max(existing.importance, fact.importance),
            updatedAt: Date.now(),
          });
          duplicateOrUpdated = true;
          savedMemories.push({ ...existing, content: fact.content });
          break;
        }
      }

      if (!duplicateOrUpdated) {
        const newMemory: UserMemory = {
          id: uuidv4(),
          userId,
          memoryType: fact.memoryType,
          content: fact.content,
          embedding,
          sourceConversationId: conversationId,
          importance: fact.importance,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastAccessedAt: Date.now(),
        };

        await this.supabaseService.saveMemory(newMemory);
        savedMemories.push(newMemory);
      }
    }

    return savedMemories;
  }

  /**
   * Internal extraction helper combining high-precision regex patterns
   * with LLM structured fact extraction.
   */
  private async extractFacts(userMessage: string, _assistantMessage?: string): Promise<ExtractedFact[]> {
    const facts: ExtractedFact[] = [];
    const text = userMessage.trim();

    // High-precision pattern detectors for key profile/project facts
    const nameMatch =
      text.match(/(?:my name is|call me|i am called)\s+([A-Z][a-zA-Z0-9_\s]{1,30})/i) ||
      text.match(/\b(?:i am|i'm)\s+([A-Z][a-z]+)\b(?!\s+(?:developing|building|creating|working|trying|sorry|happy|fine|ready|an?|the|not))/i);
    const projectMatch = text.match(/(?:developing|building|creating|working on)\s+(?:a|an)?\s*([^.?!,]+)/i);

    const disallowedNames = new Set([
      'developing', 'building', 'creating', 'working', 'trying', 'sorry', 'sure',
      'fine', 'ready', 'happy', 'not', 'just', 'here', 'back', 'also', 'currently'
    ]);

    if (nameMatch && projectMatch) {
      const name = nameMatch[1].trim();
      const proj = projectMatch[1].trim();
      if (!disallowedNames.has(name.toLowerCase())) {
        facts.push({
          content: `User's name is ${name}.`,
          memoryType: 'profile',
          importance: 5,
        });
        facts.push({
          content: `User is developing ${proj}.`,
          memoryType: 'project',
          importance: 5,
        });
        return facts;
      }
    }

    // 2. Direct Name statement
    if (nameMatch && !facts.some((f) => f.memoryType === 'profile')) {
      const name = nameMatch[1].trim();
      if (!disallowedNames.has(name.toLowerCase())) {
        facts.push({
          content: `User's name is ${name}.`,
          memoryType: 'profile',
          importance: 5,
        });
      }
    }

    // 3. Direct Project statement
    if (projectMatch && !facts.some((f) => f.memoryType === 'project')) {
      facts.push({
        content: `User is developing ${projectMatch[1].trim()}.`,
        memoryType: 'project',
        importance: 5,
      });
    }

    // 4. Preferences ("I prefer X", "I always use X", "My favorite X is Y")
    const prefMatch = text.match(/(?:i prefer|i like|i love|my favorite\s+\w+\s+is)\s+([^.?!]+)/i);
    if (prefMatch) {
      facts.push({
        content: `User preference: ${prefMatch[0].trim()}.`,
        memoryType: 'preference',
        importance: 3,
      });
    }

    // 5. Explicit instructions ("Remember that X", "Always do X")
    const instrMatch = text.match(/(?:remember that|always remember to|keep in mind that)\s+([^.?!]+)/i);
    if (instrMatch) {
      facts.push({
        content: `User instruction: ${instrMatch[1].trim()}.`,
        memoryType: 'instruction',
        importance: 5,
      });
    }

    // If patterns matched, return them immediately
    if (facts.length > 0) {
      return facts;
    }

    // 6. If message contains statements with "I", "my", "we", try lightweight LLM extraction if provider available
    if (this.nvidiaProvider && /\b(my|i am|i have|i work|developing|building)\b/i.test(text)) {
      try {
        const extractionPrompt = `Extract any long-term personal facts about the user from this message: "${text}".
Return ONLY a valid JSON object matching this schema:
{"facts": [{"content": string, "memoryType": "profile"|"preference"|"project"|"goal"|"decision"|"instruction", "importance": 1-5}]}
If there are no personal facts, return {"facts": []}.`;

        let extractedText = '';
        await this.nvidiaProvider.streamChat(
          {
            model: 'nvidia/nemotron-3-super-120b-a12b',
            messages: [{ role: 'user', content: extractionPrompt }],
            temperature: 0.1,
            maxTokens: 200,
          },
          (token) => {
            extractedText += token;
          }
        );

        const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.facts && Array.isArray(parsed.facts)) {
            for (const item of parsed.facts) {
              if (item.content && item.memoryType) {
                facts.push({
                  content: item.content,
                  memoryType: item.memoryType,
                  importance: item.importance || 3,
                });
              }
            }
          }
        }
      } catch (err) {
        // Non-blocking fallback
      }
    }

    return facts;
  }

  // --- CRUD Operations for Memory Management ---

  async listMemories(userId: string): Promise<UserMemory[]> {
    return this.supabaseService.getMemories(userId);
  }

  async updateMemory(userId: string, id: string, content: string): Promise<boolean> {
    let embedding: number[] | undefined;
    if (this.embeddingService.isConfigured()) {
      const emb = await this.embeddingService.embedOne(content, 'passage');
      if (emb) embedding = emb;
    }
    return this.supabaseService.updateMemory(userId, id, { content, embedding });
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    return this.supabaseService.deleteMemory(userId, id);
  }

  async clearMemories(userId: string): Promise<boolean> {
    return this.supabaseService.clearMemories(userId);
  }
}
