import { ImageModelEntry, getImageModelRegistry } from '../config/image_models.config.js';

export interface ImageRouterOptions {
  model?: string;
  style?: string;
  hasAttachment?: boolean;
  llmClassifier?: (prompt: string) => Promise<LLMClassificationResult | null>;
}

export interface LLMClassificationResult {
  style?: 'photorealistic' | 'stylized' | 'fast';
  needsText?: boolean;
  quality?: 'high' | 'draft';
  isEdit?: boolean;
}

export interface RouterSelectionResult {
  primaryModel: ImageModelEntry;
  candidates: ImageModelEntry[];
  reason: 'explicit' | 'rule' | 'llm' | 'default';
  matchedRule?: string;
}

export class ImageModelRouter {
  private classificationCache = new Map<string, { result: LLMClassificationResult; expiresAt: number }>();

  /**
   * Selects an ordered list of candidate models for image generation.
   */
  async select(
    prompt: string,
    options?: ImageRouterOptions
  ): Promise<RouterSelectionResult> {
    const registry = getImageModelRegistry();
    const cleanPrompt = (prompt || '').toLowerCase().trim();

    // 1. Explicit model choice overrides router
    if (options?.model) {
      const explicit = registry.find(
        (m) =>
          m.id === options.model ||
          m.realModel === options.model ||
          options.model?.includes(m.id)
      );
      if (explicit) {
        const remaining = registry.filter((m) => m.id !== explicit.id && !m.hasWatermark);
        const watermarked = registry.filter((m) => m.hasWatermark);
        return {
          primaryModel: explicit,
          candidates: [explicit, ...remaining, ...watermarked],
          reason: 'explicit',
          matchedRule: `User explicitly specified model: ${options.model}`,
        };
      }
    }

    // 2. Rules-based routing (Fast, zero-latency)
    const ruleMatch = this.matchRules(cleanPrompt, options);
    if (ruleMatch) {
      const candidates = this.orderCandidates(ruleMatch.targetId, registry);
      return {
        primaryModel: candidates[0],
        candidates,
        reason: 'rule',
        matchedRule: ruleMatch.ruleName,
      };
    }

    // 3. Ambiguous prompt -> LLM classification with 2s timeout & caching
    if (options?.llmClassifier) {
      const cached = this.classificationCache.get(cleanPrompt);
      let classification: LLMClassificationResult | null = null;

      if (cached && cached.expiresAt > Date.now()) {
        classification = cached.result;
      } else {
        try {
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
          classification = await Promise.race([
            options.llmClassifier(cleanPrompt),
            timeoutPromise,
          ]);

          if (classification) {
            // Cache for 5 minutes
            this.classificationCache.set(cleanPrompt, {
              result: classification,
              expiresAt: Date.now() + 5 * 60 * 1000,
            });
          }
        } catch {
          classification = null;
        }
      }

      if (classification) {
        const targetId = this.mapClassificationToModelId(classification);
        const candidates = this.orderCandidates(targetId, registry);
        return {
          primaryModel: candidates[0],
          candidates,
          reason: 'llm',
          matchedRule: `LLM classified style=${classification.style}, text=${classification.needsText}`,
        };
      }
    }

    // 4. Default fallback: Premier photorealistic model
    const defaultCandidates = this.orderCandidates('cf-flux-2-klein-9b', registry);
    return {
      primaryModel: defaultCandidates[0],
      candidates: defaultCandidates,
      reason: 'default',
      matchedRule: 'Default high-quality realistic selection',
    };
  }

  /**
   * Deterministic rule matcher prioritizing prompt characteristics.
   */
  private matchRules(
    prompt: string,
    options?: ImageRouterOptions
  ): { targetId: string; ruleName: string } | null {
    // A. Image edit / modification request or attached image
    if (
      options?.hasAttachment ||
      /\b(edit|modify|remove|replace|change|inpaint|outpaint|erase)\b/i.test(prompt)
    ) {
      return {
        targetId: 'cf-flux-2-klein-9b',
        ruleName: 'Image edit / inpaint capability required',
      };
    }

    // B. Fast / draft / quick requests
    if (
      /\b(quick|draft|simple|low-detail|fast|instant|speed|rough sketch)\b/i.test(prompt) ||
      /\b(quick sketch)\b/i.test(prompt)
    ) {
      return {
        targetId: 'cf-flux-2-klein-4b',
        ruleName: 'Fast / draft generation requested',
      };
    }

    // C. Typography / text / logo / poster / sign requests
    if (
      /\b(text|typography|font|logo|poster|sign|words|lettering|label|quote|t-shirt)\b/i.test(prompt) ||
      /['"][^'"]{2,}['"]/.test(prompt) // Quoted text like "Madura AI"
    ) {
      return {
        targetId: 'cf-flux-2-klein-9b',
        ruleName: 'Text rendering / typography capability required',
      };
    }

    // D. Stylized / anime / cartoon / illustration / pixel art / sketch / 3D render
    if (
      /\b(anime|manga|cartoon|illustration|pixel art|pixelart|sketch|painting|watercolor|oil painting|3d render|render 3d|cgi|comic|drawing|doodle)\b/i.test(prompt)
    ) {
      // If Oxlo SD 1.5 is available, use it; otherwise Flux-2 Klein 4B or 9B
      return {
        targetId: 'oxlo-sd-1.5',
        ruleName: 'Stylized / artistic rendering requested',
      };
    }

    // E. Photorealistic / portrait / animal / landscape / product / "photo of"
    if (
      /\b(photo|photorealistic|hyperrealistic|realistic|portrait|animal|product|landscape|nature|scenery|mountain|beach|forest|macro|candid)\b/i.test(prompt) ||
      /^(photo|picture|photograph)\s+of\b/i.test(prompt) ||
      /\b(lion|tiger|elephant|dog|cat|bird|horse|car|watch|shoe)\b/i.test(prompt)
    ) {
      return {
        targetId: 'cf-flux-2-klein-9b',
        ruleName: 'Photorealistic / animal / portrait rendering requested',
      };
    }

    return null;
  }

  /**
   * Maps LLM classification result to preferred model ID.
   */
  private mapClassificationToModelId(cls: LLMClassificationResult): string {
    if (cls.isEdit) return 'cf-flux-2-klein-9b';
    if (cls.needsText) return 'cf-flux-2-klein-9b';
    if (cls.quality === 'draft' || cls.style === 'fast') return 'cf-flux-2-klein-4b';
    if (cls.style === 'stylized') return 'oxlo-sd-1.5';
    return 'cf-flux-2-klein-9b';
  }

  /**
   * Sorts candidates with targetId first, followed by remaining non-watermarked, then watermarked models.
   */
  private orderCandidates(targetId: string, registry: ImageModelEntry[]): ImageModelEntry[] {
    const primary = registry.find((m) => m.id === targetId) || registry[0];
    const remaining = registry.filter((m) => m.id !== primary.id);

    // Non-watermarked first, watermarked as last resort
    const nonWatermarked = remaining.filter((m) => !m.hasWatermark);
    const watermarked = remaining.filter((m) => m.hasWatermark);

    return [primary, ...nonWatermarked, ...watermarked];
  }
}

export const imageModelRouter = new ImageModelRouter();

