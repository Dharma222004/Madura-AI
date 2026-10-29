/**
 * EmbeddingService — Generates semantic embeddings using NVIDIA NIM API
 * Model: nvidia/nemotron-3.5-embed-1b (dimension: 2048)
 */
export class EmbeddingService {
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private baseUrl: string;
  private model: string;
  private dimension: number;

  constructor(
    apiKeyOrKeys: string | string[] = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || '',
    baseUrl: string = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    model: string = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nemotron-3.5-embed-1b',
    dimension: number = parseInt(process.env.NVIDIA_EMBEDDING_DIM || '2048', 10)
  ) {
    const raw: string[] = [];
    if (Array.isArray(apiKeyOrKeys)) {
      raw.push(...apiKeyOrKeys);
    } else if (typeof apiKeyOrKeys === 'string') {
      raw.push(...apiKeyOrKeys.split(','));
    }
    if (process.env.NVIDIA_API_KEYS) {
      raw.push(...process.env.NVIDIA_API_KEYS.split(','));
    }
    if (process.env.NVIDIA_API_KEY) {
      raw.push(process.env.NVIDIA_API_KEY);
    }
    for (let i = 1; i <= 10; i++) {
      const envKey = process.env[`NVIDIA_API_KEY_${i}`];
      if (envKey) raw.push(envKey);
    }

    const seen = new Set<string>();
    for (let k of raw) {
      k = (k || '').trim();
      if (!k) continue;
      k = k.replace(/^nvapi--+/, 'nvapi-');
      if (!k.startsWith('nvapi-') && !k.includes('.')) {
        k = `nvapi-${k}`;
      }
      if (!seen.has(k)) {
        seen.add(k);
        this.apiKeys.push(k);
      }
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.dimension = dimension;
  }

  isConfigured(): boolean {
    return this.apiKeys.length > 0 && this.apiKeys[0] !== 'your_nvidia_api_key_here';
  }

  getDimension(): number {
    return this.dimension;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Generates embeddings for an array of input texts with multi-key auto-failover.
   * @param texts Array of string texts to embed.
   * @param inputType 'query' for search queries, 'passage' for stored documents/memories.
   */
  async embedTexts(texts: string[], inputType: 'query' | 'passage' = 'passage'): Promise<number[][]> {
    if (!this.isConfigured() || texts.length === 0) {
      return texts.map(() => []);
    }

    const cleanTexts = texts.map((t) => t.trim().slice(0, 4000)).filter(Boolean);
    if (cleanTexts.length === 0) return [];

    const totalKeys = this.apiKeys.length;

    for (let i = 0; i < totalKeys; i++) {
      const keyIndex = (this.currentKeyIndex + i) % totalKeys;
      const key = this.apiKeys[keyIndex];

      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: cleanTexts,
            model: this.model,
            input_type: inputType,
          }),
        });

        if (response.ok) {
          if (this.currentKeyIndex !== keyIndex) {
            console.log(`[EmbeddingService] Switched to working NVIDIA embedding key #${keyIndex + 1}`);
            this.currentKeyIndex = keyIndex;
          }

          const json = (await response.json()) as any;
          if (!json.data || !Array.isArray(json.data)) {
            return texts.map(() => []);
          }

          // Sort by index to preserve order
          const sorted = json.data.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
          return sorted.map((item: any) => item.embedding as number[]);
        }

        const errorText = await response.text().catch(() => '');
        console.warn(
          `[EmbeddingService] NVIDIA embedding key #${keyIndex + 1} failed (${response.status}: ${errorText.slice(0, 100)}). Auto-switching to next key...`
        );
        this.currentKeyIndex = (keyIndex + 1) % totalKeys;
      } catch (err: any) {
        console.warn(
          `[EmbeddingService] NVIDIA embedding key #${keyIndex + 1} network exception: ${err.message}. Auto-switching to next key...`
        );
        this.currentKeyIndex = (keyIndex + 1) % totalKeys;
      }
    }

    return texts.map(() => []);
  }

  /**
   * Generates a single embedding for text.
   */
  async embedOne(text: string, inputType: 'query' | 'passage' = 'passage'): Promise<number[] | null> {
    const embeddings = await this.embedTexts([text], inputType);
    return embeddings[0] && embeddings[0].length > 0 ? embeddings[0] : null;
  }

  /**
   * Calculates cosine similarity between two vector arrays.
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
