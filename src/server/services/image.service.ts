import { ImageModelEntry, getImageModelRegistry } from '../config/image_models.config.js';
import { imageModelRouter, ImageRouterOptions, RouterSelectionResult } from './image_router.service.js';

export interface GeneratedImageResult {
  imageUrl: string;
  prompt: string;
  dimensions: { width: number; height: number };
  markdownContent: string;
  model: string; // Neutral identifier e.g. "Madura AI"
}

export interface ImageGenerationOptions extends ImageRouterOptions {
  enablePromptEnhancement?: boolean;
}

export class ImageService {
  public readonly model: string = 'Madura AI Image Engine';
  private modelCooldowns = new Map<string, number>(); // modelId -> timestamp when cooldown expires
  private cfAccountId: string;

  constructor(_apiKeyOrKeys?: string | string[], _baseUrl?: string) {
    this.cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  }

  /**
   * Automatically determines if a user prompt is asking to generate/create/draw an image.
   */
  isImagePrompt(prompt: string): boolean {
    const clean = (prompt || '').toLowerCase().trim();
    if (!clean) return false;
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
    let clean = (prompt || '').trim();
    clean = clean.replace(/^(please\s+)?(can you\s+)?(could you\s+)?/i, '');
    clean = clean.replace(
      /^(generate|create|draw|paint|render|make|produce|show me)\s+(an?\s+|one\s+|some\s+)?(image|picture|photo|photograph|illustration|art|portrait|wallpaper|drawing)?\s*(of\s+|about\s+)?/i,
      ''
    );
    clean = clean.replace(/^(a\s+|an\s+)?(photorealistic|hyperrealistic|realistic)\s+(image|picture|photo)?\s*(of\s+)?/i, '');
    clean = clean.replace(/\s+(image|picture|photo|illustration|drawing|art|wallpaper)$/i, '');
    clean = clean.trim();
    return clean || prompt.trim();
  }

  /**
   * Enriches short prompts with stylistic, lighting, and composition details
   * while strictly preserving the user's intended subject.
   */
  enhancePrompt(cleanSubject: string, styleCategory?: string): string {
    const wordCount = cleanSubject.split(/\s+/).filter(Boolean).length;
    // If prompt is already detailed (>= 8 words), keep it as-is
    if (wordCount >= 8) {
      return cleanSubject;
    }

    if (styleCategory === 'stylized' || /\b(anime|manga|cartoon|illustration|painting|sketch)\b/i.test(cleanSubject)) {
      return `${cleanSubject}, highly detailed, digital art, vibrant colors, expressive lighting, masterpiece`;
    }

    if (/\b(logo|text|typography|poster|sign)\b/i.test(cleanSubject)) {
      return `${cleanSubject}, vector graphic, clean lines, sharp typography, minimalist composition`;
    }

    // Default photorealistic enhancement for short subjects like "lion", "sunset"
    return `${cleanSubject}, photorealistic, natural lighting, high resolution, sharp focus, 8k`;
  }

  /**
   * Generates an image using automatic model routing, per-provider key rotation,
   * per-attempt timeout, and zero UI model exposure.
   */
  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<GeneratedImageResult> {
    const startTime = Date.now();
    const subject = this.cleanImagePrompt(prompt);

    // 1. Automatic model routing
    const route: RouterSelectionResult = await imageModelRouter.select(prompt, options);
    const candidates = route.candidates;

    const seed = Math.floor(Math.random() * 10000000);
    const enhancedPrompt = options?.enablePromptEnhancement !== false
      ? this.enhancePrompt(subject, route.matchedRule?.includes('Stylized') ? 'stylized' : undefined)
      : subject;

    let attempts = 0;
    let chosenEntry: ImageModelEntry | null = null;
    let finalImageUrl: string | null = null;
    let finalDimensions = { width: 1024, height: 1024 };

    // 2. Iterate candidates in priority order with fallback chain
    for (const entry of candidates) {
      if (!entry.enabled && entry.provider !== 'pollinations') {
        continue;
      }

      // Check cooldown (skip models that failed recently, unless in test environment)
      const cooldownUntil = this.modelCooldowns.get(entry.id);
      if (process.env.NODE_ENV !== 'test' && cooldownUntil && cooldownUntil > Date.now()) {
        console.log(`[ImageService] Skipping ${entry.id} (cooling down for ${Math.round((cooldownUntil - Date.now()) / 1000)}s)`);
        continue;
      }

      attempts++;
      chosenEntry = entry;
      finalDimensions = entry.maxResolution;

      try {
        const url = await this.executeCandidate(entry, subject, enhancedPrompt, seed);
        if (url) {
          finalImageUrl = url;
          // Successfully completed — clear any cooldown
          this.modelCooldowns.delete(entry.id);
          break;
        }
      } catch (err: any) {
        console.warn(`[ImageService] Model candidate ${entry.id} failed: ${err.message}. Trying next candidate...`);
        // Apply 2-minute cooldown on candidate failure
        this.modelCooldowns.set(entry.id, Date.now() + 120000);
      }
    }

    // 3. Last-resort fallback if all candidates failed: Pollinations FLUX
    if (!finalImageUrl) {
      attempts++;
      console.log('[ImageService] All candidates exhausted. Using universal Pollinations fallback.');
      finalImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        enhancedPrompt
      )}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
      finalDimensions = { width: 1024, height: 1024 };
      chosenEntry = {
        id: 'pollinations-flux',
        provider: 'pollinations',
        realModel: 'flux',
        apiKeys: [],
        strengths: ['fallback'],
        speed: 'medium',
        maxResolution: { width: 1024, height: 1024 },
        supportsNegativePrompt: false,
        supportsImageEdit: false,
        hasWatermark: false,
        enabled: true,
      };
    }

    const durationMs = Date.now() - startTime;

    // Log internally on server only (no provider/model leaked to client)
    console.log(
      `[ImageService] Image generated successfully in ${durationMs}ms | Model: ${chosenEntry?.realModel} (${chosenEntry?.provider}) | Reason: ${route.reason} (${route.matchedRule}) | Attempts: ${attempts}`
    );

    // Format client-facing markdown without model name
    const markdownContent = `![${subject}](${finalImageUrl})\n\n*Generated by **Madura AI***`;

    return {
      imageUrl: finalImageUrl,
      prompt: subject,
      dimensions: finalDimensions,
      markdownContent,
      model: 'Madura AI',
    };
  }

  /**
   * Executes a specific model candidate, rotating through all of its API keys on auth/rate limits.
   */
  private async executeCandidate(
    entry: ImageModelEntry,
    subject: string,
    enhancedPrompt: string,
    seed: number
  ): Promise<string | null> {
    const timeoutMs = process.env.NODE_ENV === 'test' ? 3000 : 45000;

    // A. Cloudflare Workers AI
    if (entry.provider === 'cloudflare') {
      const keys = entry.apiKeys.length > 0 ? entry.apiKeys : (process.env.CLOUDFLARE_API_KEY ? [process.env.CLOUDFLARE_API_KEY] : []);
      const accountId = this.cfAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const form = new FormData();
          form.append('prompt', enhancedPrompt);

          const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${entry.realModel}`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${key}`,
              },
              body: form,
              signal: controller.signal,
            }
          );
          clearTimeout(timer);

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('image/')) {
              const arrayBuf = await response.arrayBuffer();
              const base64 = Buffer.from(arrayBuf).toString('base64');
              return `data:${contentType};base64,${base64}`;
            } else {
              const data = (await response.json()) as any;
              const b64 = data.result?.image || data.image;
              if (b64) {
                const mime = b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                return `data:${mime};base64,${b64}`;
              }
            }
          }

          // Key-specific errors: rotate key
          if (response.status === 401 || response.status === 403 || response.status === 429) {
            console.warn(`[ImageService] Cloudflare key #${i + 1} failed with status ${response.status}. Trying next key...`);
            continue;
          }

          // Request-specific error: break and fallback to next model
          const errText = await response.text().catch(() => '');
          console.warn(`[ImageService] Cloudflare request error (${response.status}): ${errText.slice(0, 80)}`);
          break;
        } catch (err: any) {
          console.warn(`[ImageService] Cloudflare key #${i + 1} error: ${err.message}`);
          continue;
        }
      }
      return null;
    }

    // B. Oxlo Stable Diffusion 1.5
    if (entry.provider === 'oxlo') {
      const keys = entry.apiKeys;
      const baseUrl = (process.env.OXLO_BASE_URL || 'https://api.oxlo.ai/v1').replace(/\/+$/, '');

      if (keys.length === 0) return null;

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const response = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: entry.realModel,
              prompt: enhancedPrompt,
              n: 1,
              size: `${entry.maxResolution.width}x${entry.maxResolution.height}`,
              response_format: 'url',
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (response.ok) {
            const data = (await response.json()) as any;
            const url = data.data?.[0]?.url || data.url || data.image_url;
            if (url) return url;
          }

          if (response.status === 401 || response.status === 403 || response.status === 429) {
            console.warn(`[ImageService] Oxlo key #${i + 1} failed (${response.status}). Trying next key...`);
            continue;
          }
          break;
        } catch (err: any) {
          console.warn(`[ImageService] Oxlo key #${i + 1} error: ${err.message}`);
          continue;
        }
      }
      return null;
    }

    // C. Pollinations FLUX Architecture
    if (entry.provider === 'pollinations') {
      const width = entry.maxResolution.width;
      const height = entry.maxResolution.height;
      return `https://image.pollinations.ai/prompt/${encodeURIComponent(
        enhancedPrompt
      )}?width=${width}&height=${height}&model=${entry.realModel}&nologo=true&seed=${seed}`;
    }

    return null;
  }
}

export const imageService = new ImageService();
