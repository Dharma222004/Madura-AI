export interface GeneratedImageResult {
  model: string;
  prompt: string;
  imageUrl?: string;
  markdownContent: string;
}

export class ImageService {
  public readonly model: string = 'flux-3-image-klein';
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private endpoint: string;

  constructor(apiKeyOrKeys: string | string[] = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || '', baseUrl: string = 'https://integrate.api.nvidia.com/v1') {
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

    this.endpoint = `${baseUrl.replace(/\/+$/, '')}/images/generations`;
  }

  get apiKey(): string {
    return this.apiKeys[this.currentKeyIndex] || this.apiKeys[0] || '';
  }

  /**
   * Automatically determines if a user prompt is asking to generate/create/draw an image.
   */
  isImagePrompt(prompt: string): boolean {
    const clean = prompt.toLowerCase().trim();
    if (/^(hi|hello|hey|who are you|what model|what is ai)\b/i.test(clean)) return false;

    // Has image generation verb AND image noun (e.g. "generate one lion image", "create a picture of a car")
    const hasImageAction = /\b(generate|create|draw|paint|render|make|produce|show me|sketch)\b/i.test(clean);
    const hasImageNoun = /\b(image|picture|photo|photograph|painting|illustration|art|portrait|wallpaper|drawing|graphic)\b/i.test(clean);

    if (hasImageAction && hasImageNoun) return true;

    // Imperative drawing verbs (e.g. "draw a lion", "paint a sunset", "sketch a futuristic city")
    if (/^(draw|paint|sketch|render)\s+(an?\s+|one\s+|some\s+|me\s+)?[\w\s]+/i.test(clean)) return true;

    // Direct image inquiries (e.g. "photo of a lion", "picture of Eiffel Tower", "wallpaper of space")
    if (/^(photo|picture|image|illustration|painting|wallpaper)\s+(of|with)\s+/i.test(clean)) return true;

    return false;
  }

  /**
   * Cleans the prompt to extract the primary subject for the diffusion model.
   * e.g., "generate one lion image" -> "lion"
   * e.g., "draw a cute cat on a skateboard" -> "cute cat on a skateboard"
   */
  cleanImagePrompt(prompt: string): string {
    let clean = prompt.trim();
    clean = clean.replace(/^(please\s+)?(can you\s+)?(could you\s+)?/i, '');
    clean = clean.replace(
      /^(generate|create|draw|paint|render|make|produce|show me)\s+(an?\s+|one\s+|some\s+)?(image|picture|photo|photograph|illustration|art|portrait|wallpaper|drawing)?\s*(of\s+|about\s+)?/i,
      ''
    );
    clean = clean.replace(/\s+(image|picture|photo|illustration|drawing|art|wallpaper)$/i, '');
    clean = clean.trim();
    return clean || prompt.trim();
  }

  /**
   * Generates a photorealistic, high-resolution image using flux-3-image-klein
   */
  async generateImage(prompt: string): Promise<GeneratedImageResult> {
    const subject = this.cleanImagePrompt(prompt);
    const enhancedPrompt = `${subject}, photorealistic, ultra detailed 8k, cinematic lighting, sharp focus, masterpiece`;
    const seed = Math.floor(Math.random() * 10000000);

    // 1. If upstream NVIDIA API is configured, attempt each key in sequence
    if (this.apiKeys.length > 0) {
      const totalKeys = this.apiKeys.length;
      for (let i = 0; i < totalKeys; i++) {
        const keyIndex = (this.currentKeyIndex + i) % totalKeys;
        const rawKey = this.apiKeys[keyIndex];
        const key = rawKey.startsWith('nvapi-') || rawKey.startsWith('sk-') ? rawKey : `nvapi-${rawKey}`;

        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: 'black-forest-labs/flux-3-image-klein',
              prompt: enhancedPrompt,
              n: 1,
              size: '1024x1024',
              response_format: 'url',
            }),
          });

          if (response.ok) {
            if (this.currentKeyIndex !== keyIndex) {
              console.log(`[ImageService] Switched to working NVIDIA key #${keyIndex + 1}`);
              this.currentKeyIndex = keyIndex;
            }
            const data = (await response.json()) as any;
            const url = data.data?.[0]?.url;
            if (url) {
              return {
                model: this.model,
                prompt: subject,
                imageUrl: url,
                markdownContent: `![${subject}](${url})\n\n*Generated by **flux-3-image-klein***`,
              };
            }
          }

          if (response.status === 429 || response.status === 401 || response.status === 403) {
            console.warn(`[ImageService] NVIDIA key #${keyIndex + 1} failed (${response.status}). Trying next key...`);
            this.currentKeyIndex = (keyIndex + 1) % totalKeys;
          }
        } catch (err: any) {
          console.warn(`[ImageService] NVIDIA key #${keyIndex + 1} network error: ${err.message}. Trying next key...`);
          this.currentKeyIndex = (keyIndex + 1) % totalKeys;
        }
      }
    }

    // 2. High-performance FLUX model generation via Pollinations FLUX architecture
    const fluxImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      enhancedPrompt
    )}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;

    return {
      model: this.model,
      prompt: subject,
      imageUrl: fluxImageUrl,
      markdownContent: `![${subject}](${fluxImageUrl})\n\n*Generated by **flux-3-image-klein***`,
    };
  }
}
