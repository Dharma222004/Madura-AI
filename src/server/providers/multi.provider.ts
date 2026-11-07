/**
 * Madura AI — Multi-Provider Gateway
 *
 * Routes each model ID to the correct API key, base URL, and real model name.
 * Default model: Mistral Large 4 via NVIDIA NIM (displayed in UI as "Auto").
 * Supports Gemini 2.5 Flash, Qwen 3.8, GPT-OSS-120B, and Nvidia Ultron.
 */

import { AIProvider, ChatCompletionOptions, StreamChatResult } from './provider.interface.js';
import { ModelInfo } from '../../types/index.js';
import { DEFAULT_CHAT_MODEL } from './model.config.js';

// ── Model Registry ────────────────────────────────────────────────────────────

export interface ModelFallbackConfig {
  realModel: string;
  baseUrl: string;
  apiKey: string;
  // additional fallback hops in priority order
  chain?: Array<{ realModel: string; baseUrl: string; apiKey: string }>;
}

export type ProviderName = 'nvidia' | 'gemini' | 'groq' | 'openrouter' | 'oxlo' | 'cloudflare';

// ── Per-provider max_tokens caps ─────────────────────────────────────────────
// Some free-plan providers enforce lower token limits than the default 8192.
const PROVIDER_MAX_TOKENS_CAP: Partial<Record<ProviderName, number>> = {
  oxlo: 4096,
};

// ── Timeout helpers ───────────────────────────────────────────────────────────
/**
 * Creates an AbortSignal that fires after `ms` milliseconds.
 * Returns the signal and a cancel function to clear the timer early.
 */
function makeTimeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${ms}ms`)), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

export class ProviderKeyPool {
  private pools: Map<ProviderName, {
    keys: string[];
    currentIndex: number;
    cooldowns: Map<string, number>;
    lastWorkingIndex: number;
  }> = new Map();

  constructor(initial: Partial<Record<ProviderName, string[]>>) {
    for (const [provider, keys] of Object.entries(initial) as [ProviderName, string[]][]) {
      this.pools.set(provider, {
        keys: [...(keys || [])],
        currentIndex: 0,
        cooldowns: new Map(),
        lastWorkingIndex: 0,
      });
    }
  }

  /**
   * Returns an ordered list of keys for the provider.
   * - Starts from lastWorkingIndex (the key that last succeeded).
   * - Healthy (non-cooldown) keys come before cooldown keys.
   * - Keys already tried this request are excluded entirely.
   */
  getOrderedKeys(
    provider?: ProviderName,
    overrideKeys?: string[],
    triedKeys?: Set<string>
  ): string[] {
    const pool = provider ? this.pools.get(provider) : undefined;
    const allKeys = pool && pool.keys.length > 0 ? pool.keys : (overrideKeys || []);
    if (allKeys.length === 0) return [];

    const total = allKeys.length;
    const startIdx = pool ? pool.lastWorkingIndex : 0;
    const now = Date.now();

    // Build rotation starting from lastWorkingIndex
    const rotated: string[] = [];
    for (let i = 0; i < total; i++) {
      const idx = (startIdx + i) % total;
      const k = allKeys[idx];
      // Skip keys already tried this request
      if (triedKeys && triedKeys.has(k)) continue;
      rotated.push(k);
    }

    // Separate healthy vs cooldown (but both are still tried if no healthy remain)
    const healthy: string[] = [];
    const inCooldown: string[] = [];
    for (const key of rotated) {
      const cooldownEnd = pool?.cooldowns.get(key) || 0;
      if (cooldownEnd <= now) {
        healthy.push(key);
      } else {
        inCooldown.push(key);
      }
    }

    return healthy.length > 0 ? [...healthy, ...inCooldown] : rotated;
  }

  /**
   * Resets cooldown and records that this key successfully served a request.
   * Updates lastWorkingIndex so the next request starts here.
   */
  recordSuccess(provider: ProviderName | undefined, key: string): void {
    if (!provider) return;
    const pool = this.pools.get(provider);
    if (!pool) return;
    pool.cooldowns.delete(key);
    const idx = pool.keys.indexOf(key);
    if (idx !== -1) {
      if (pool.lastWorkingIndex !== idx) {
        console.log(`[ProviderKeyPool] ${provider.toUpperCase()} key #${idx + 1}/${pool.keys.length} succeeded — pinning as preferred.`);
        pool.lastWorkingIndex = idx;
      }
      pool.currentIndex = idx;
    }
  }

  /**
   * Applies cooldown for a failed key but does NOT change lastWorkingIndex
   * (we only pin on success). The next call to getOrderedKeys will skip the
   * cooldown key automatically.
   */
  recordFailure(provider: ProviderName | undefined, key: string, status: number, reason: string): void {
    if (!provider) return;
    const pool = this.pools.get(provider);
    if (!pool) return;

    let cooldownMs = 60_000; // 60s for 429 rate-limit
    if (status === 401 || status === 403 || status === 400) {
      cooldownMs = 300_000; // 5 min for auth/quota/invalid
    } else if (status >= 500) {
      cooldownMs = 30_000; // 30s for server error
    }

    pool.cooldowns.set(key, Date.now() + cooldownMs);

    const idx = pool.keys.indexOf(key);
    const total = pool.keys.length;
    // Find next available (non-cooldown) key for display purposes
    const nextIdx = total > 1 && idx !== -1 ? (idx + 1) % total : -1;
    if (nextIdx !== -1) {
      console.warn(
        `[ProviderKeyPool] ${provider.toUpperCase()} key #${idx + 1}/${total} failed (${status}: ${reason.slice(0, 80)}). Will try key #${nextIdx + 1} next...`
      );
    } else {
      console.warn(
        `[ProviderKeyPool] ${provider.toUpperCase()} key #${idx + 1}/${total} failed (${status}: ${reason.slice(0, 80)}). No more keys in pool.`
      );
    }
  }
}

export interface ModelConfig {
  id: string;          // Internal ID used by the frontend
  displayName: string; // Shown in UI
  realModel: string;   // Actual model name sent to the API
  baseUrl: string;     // API base URL
  apiKey: string;      // Primary API key
  apiKeys?: string[];  // All API keys for fallback rotation
  providerName: ProviderName;
  isDefault?: boolean;
  description: string;
  contextWindow: number;
  supportsVision: boolean;
  isReasoning?: boolean;
  isResponsesApi?: boolean;
  customHeaders?: Record<string, string>;
  fallback?: ModelFallbackConfig;
  crossProviderFallbackId?: string;  // Last-resort fallback to a different provider's model
}

function resolveProviderKeys(
  primaryKey: string,
  envKeysList?: string,
  indexedPrefix?: string,
  isNvidia = false
): string[] {
  const raw: string[] = [];
  if (primaryKey) raw.push(primaryKey);
  if (envKeysList) raw.push(...envKeysList.split(','));
  if (indexedPrefix) {
    for (let i = 1; i <= 10; i++) {
      const v = process.env[`${indexedPrefix}_${i}`];
      if (v) raw.push(v);
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (let k of raw) {
    k = (k || '').trim();
    if (!k) continue;
    if (isNvidia) {
      k = k.replace(/^nvapi--+/, 'nvapi-');
      if (!k.startsWith('nvapi-') && !k.includes('.')) {
        k = `nvapi-${k}`;
      }
    }
    if (!seen.has(k)) {
      seen.add(k);
      result.push(k);
    }
  }
  return result;
}

export function buildModelRegistry(): ModelConfig[] {
  const nvidiaBase = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  const openrouterBase = 'https://openrouter.ai/api/v1';
  const oxloBase = (process.env.OXLO_BASE_URL || 'https://api.oxlo.ai/v1').replace(/\/+$/, '');

  const nvidiaKeys = resolveProviderKeys(
    process.env.NVIDIA_API_KEY || '',
    process.env.NVIDIA_API_KEYS,
    'NVIDIA_API_KEY',
    true
  );

  const geminiKeys = resolveProviderKeys(
    process.env.GEMINI_API_KEY || '',
    process.env.GEMINI_API_KEYS,
    'GEMINI_API_KEY',
    false
  );

  const groqKeys = resolveProviderKeys(
    process.env.GROQ_API_KEY || '',
    process.env.GROQ_API_KEYS,
    'GROQ_API_KEY',
    false
  );

  const openrouterKeys = resolveProviderKeys(
    process.env.OPENROUTER_API_KEY || '',
    process.env.OPENROUTER_API_KEYS,
    'OPENROUTER_API_KEY',
    false
  );

  const oxloKeys = resolveProviderKeys(
    process.env.OXLO_API_KEY || '',
    process.env.OXLO_API_KEYS,
    'OXLO_API_KEY',
    false
  );

  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const cloudflareBase = cfAccountId
    ? `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`
    : 'https://api.cloudflare.com/client/v4/accounts/default/ai/v1';

  const cloudflareKeys = resolveProviderKeys(
    process.env.CLOUDFLARE_API_KEY || '',
    process.env.CLOUDFLARE_API_KEYS,
    'CLOUDFLARE_API_KEY',
    false
  );

  return [
    // 1. Auto (Default Model) — NVIDIA NIM Mistral Large 4
    {
      id: 'auto',
      displayName: 'Auto',
      realModel: process.env.NVIDIA_MODEL || DEFAULT_CHAT_MODEL,
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      isDefault: true,
      description: 'Mistral Large 4',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'gemini-flash',
    },
    // 2. Gemini 2.5 Flash — Google Generative Language
    {
      id: 'gemini-flash',
      displayName: 'Gemini 2.5 Flash',
      realModel: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: geminiKeys[0] || '',
      apiKeys: geminiKeys,
      providerName: 'gemini',
      description: 'Fast multimodal model',
      contextWindow: 1000000,
      supportsVision: true,
      crossProviderFallbackId: 'auto',
    },
    // 3. Qwen 3.8 — Groq Qwen 3.8
    {
      id: 'qwen-3.8',
      displayName: 'Qwen 3.8',
      realModel: process.env.GROQ_QWEN_MODEL || 'qwen/qwen3.8-27b',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: groqKeys[0] || '',
      apiKeys: groqKeys,
      providerName: 'groq',
      description: 'High performance model',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'gemini-flash',
    },
    // 4. GPT-OSS-120B — Groq GPT-OSS-120B
    {
      id: 'gpt-oss-120b',
      displayName: 'GPT-OSS-120B',
      realModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: groqKeys[0] || '',
      apiKeys: groqKeys,
      providerName: 'groq',
      description: 'High-speed 120B model',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'nvidia-ultron',
    },
    // 5. Nemotron-3 Ultra — NVIDIA NIM Nemotron Ultra 550B
    {
      id: 'nvidia-ultron',
      displayName: 'Nemotron-3 Ultra',
      realModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'Deep reasoning model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'gpt-oss-120b',
    },
    // 6. Nemotron 3.5 Lightning — NVIDIA NIM
    {
      id: 'nemotron-lightning',
      displayName: 'Nemotron 3.5 Lightning',
      realModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'High-speed 30B reasoning model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 6. Nemotron Omni — NVIDIA NIM Image Recognition & Multimodal Reasoning
    {
      id: 'nemotron-omni',
      displayName: 'Nemotron Omni (Vision)',
      realModel: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'Image recognition & omni reasoning model',
      contextWindow: 128000,
      supportsVision: true,
      isReasoning: true,
      crossProviderFallbackId: 'gemini-flash',
    },
    // 7. Minimax- M3 Flash — NVIDIA NIM (outputs <think> reasoning tags)
    {
      id: 'minimax-m3.1-flash',
      displayName: 'Minimax- M3 Flash',
      realModel: 'minimaxai/minimax-m3.1-flash',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'High-speed Minimax reasoning model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 8. Deepseek-v4 Flash — NVIDIA NIM (outputs <think> reasoning tags)
    {
      id: 'deepseek-v4.1-flash',
      displayName: 'Deepseek-v4 Flash',
      realModel: 'deepseek-ai/deepseek-v4.1-flash',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'DeepSeek V4.1 Flash model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 9. GLM 5.3 Flash — NVIDIA NIM (outputs <think> reasoning tags — must be treated as reasoning)
    {
      id: 'glm-5.3-flash',
      displayName: 'GLM 5.3 Flash',
      realModel: 'z-ai/glm-5.3-flash',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'GLM 5.3 Flash model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 10. Muse-Glimmer-30B — NVIDIA NIM
    {
      id: 'muse-glimmer-30b',
      displayName: 'Muse-Glimmer-30B',
      realModel: 'meta/muse-glimmer-30b',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      description: 'Meta Muse Glimmer 30B model',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // ── OpenRouter Models ──────────────────────────────────────────────────────
    // 6. Nemotron 3.5 Super — OpenRouter (free)
    {
      id: 'nemotron-3.5-super',
      displayName: 'Nemotron 3.5 Super',
      realModel: 'nvidia/nemotron-3.5-super-vl:free',
      baseUrl: openrouterBase,
      apiKey: openrouterKeys[0] || '',
      apiKeys: openrouterKeys,
      providerName: 'openrouter',
      description: 'Nemotron vision-language model',
      contextWindow: 128000,
      supportsVision: true,
      crossProviderFallbackId: 'gemini-flash',
    },
    // 7. Gemma-4 26B — OpenRouter (free)
    {
      id: 'gemma-4',
      displayName: 'Gemma-4',
      realModel: 'google/gemma-4-26b-a4b-it:free',
      baseUrl: openrouterBase,
      apiKey: openrouterKeys[0] || '',
      apiKeys: openrouterKeys,
      providerName: 'openrouter',
      description: 'Google Gemma 4 26B',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'gemini-flash',
    },
    // 8. Recursive Flint — OpenRouter (free)
    {
      id: 'recursive',
      displayName: 'Recursive',
      realModel: 'recursive/flint-v1.0:free',
      baseUrl: openrouterBase,
      apiKey: openrouterKeys[0] || '',
      apiKeys: openrouterKeys,
      providerName: 'openrouter',
      description: 'Recursive Flint model',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 9. Xingchen — OpenRouter (free)
    {
      id: 'xingchen',
      displayName: 'Xingchen',
      realModel: 'xingchen-agi/xing4.0-29b-a4b:free',
      baseUrl: openrouterBase,
      apiKey: openrouterKeys[0] || '',
      apiKeys: openrouterKeys,
      providerName: 'openrouter',
      description: 'Xingchen AGI 29B model',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 10. Gemma-4 31B — OpenRouter (free)
    {
      id: 'gemma-4-31b',
      displayName: 'Gemma -4 31B',
      realModel: 'google/gemma-4-31b-it:free',
      baseUrl: openrouterBase,
      apiKey: openrouterKeys[0] || '',
      apiKeys: openrouterKeys,
      providerName: 'openrouter',
      description: 'Google Gemma 4 31B',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'gemini-flash',
    },
    // ── Oxlo Models ───────────────────────────────────────────────────────────
    // 11. Deepseek V3.2 — Oxlo (Flagship 671B MoE)
    {
      id: 'deepseek-v3.2',
      displayName: 'DeepSeek V3.2 (Oxlo)',
      realModel: 'deepseek-v3.2',
      baseUrl: oxloBase,
      apiKey: oxloKeys[0] || '',
      apiKeys: oxloKeys,
      providerName: 'oxlo',
      description: 'DeepSeek V3.2 671B MoE on Oxlo API',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'cf-qwen3.8-27b',
    },
    // 12. Mistral 7B — Oxlo
    {
      id: 'mistral-7b',
      displayName: 'Mistral 7B (Oxlo)',
      realModel: 'mistral-7b',
      baseUrl: oxloBase,
      apiKey: oxloKeys[0] || '',
      apiKeys: oxloKeys,
      providerName: 'oxlo',
      description: 'Mistral 7B on Oxlo API',
      contextWindow: 32000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 13. Llama 3.2 3B — Oxlo
    {
      id: 'llama-3.2-3b',
      displayName: 'Llama 3.2 3B (Oxlo)',
      realModel: 'llama-3.2-3b',
      baseUrl: oxloBase,
      apiKey: oxloKeys[0] || '',
      apiKeys: oxloKeys,
      providerName: 'oxlo',
      description: 'Llama 3.2 3B on Oxlo API',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 14. Stable Diffusion 1.5 — Oxlo (image generation)
    {
      id: 'stable-diffusion-1.5',
      displayName: 'Stable Image Creation',
      realModel: 'stable-diffusion-1.5',
      baseUrl: oxloBase,
      apiKey: oxloKeys[0] || '',
      apiKeys: oxloKeys,
      providerName: 'oxlo',
      description: 'AI image generation',
      contextWindow: 1024,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // ── Cloudflare Workers AI Models ──────────────────────────────────────────
    // 15. Qwen 3.8 27B — Cloudflare Workers AI
    {
      id: 'cf-qwen3.8-27b',
      displayName: 'Qwen 3.8 27B (CF)',
      realModel: '@cf/qwen/qwen3.8-27b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'Qwen 3.8 27B on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'qwen-3.8',
    },
    // 16. Gemma-4 26B — Cloudflare Workers AI
    {
      id: 'cf-gemma-4-26b',
      displayName: 'Gemma-4 26B (CF)',
      realModel: '@cf/google/gemma-4-26b-a4b-it',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'Google Gemma-4 26B on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'gemma-4',
    },
    // 17. Nemotron-3 120B — Cloudflare Workers AI
    {
      id: 'cf-nemotron-3-120b',
      displayName: 'Nemotron-3 120B (CF)',
      realModel: '@cf/nvidia/nemotron-3-120b-a12b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'NVIDIA Nemotron-3 120B on Cloudflare',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 18. GLM 4.7 Flash — Cloudflare Workers AI
    {
      id: 'cf-glm-4.7-flash',
      displayName: 'GLM 4.7 Flash',
      realModel: '@cf/zai-org/glm-4.7-flash',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'GLM 4.7 Flash on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'glm-5.3-flash',
    },
    // 19. GPT 120B — Cloudflare Workers AI
    {
      id: 'cf-gpt-120b',
      displayName: 'GPT 120B',
      realModel: '@cf/openai/gpt-oss-120b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'OpenAI GPT-OSS 120B on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'gpt-oss-120b',
    },
    // 20. GPT-OSS 20B — Cloudflare Workers AI
    {
      id: 'cf-gpt-oss-20b',
      displayName: 'GPT-OSS 20B',
      realModel: '@cf/openai/gpt-oss-20b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'OpenAI GPT-OSS 20B on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
      crossProviderFallbackId: 'auto',
    },
    // 21. Qwen3 30B FP8 — Cloudflare Workers AI
    {
      id: 'cf-qwen3-30b-fp8',
      displayName: 'Qwen3 30B FP8',
      realModel: '@cf/qwen/qwen3-30b-a3b-fp8',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'Qwen3 30B FP8 on Cloudflare Workers AI',
      contextWindow: 128000,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 22. Flux-2 Klein 4B — Cloudflare Workers AI (Image Creation)
    {
      id: 'cf-flux-2-klein-4b',
      displayName: 'Flux-2 Klein 4B',
      realModel: '@cf/black-forest-labs/flux-2-klein-4b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'Black Forest Labs Flux-2 Klein 4B image creation',
      contextWindow: 1024,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
    // 23. Flux-2 Klein 9B — Cloudflare Workers AI (Image Creation)
    {
      id: 'cf-flux-2-klein-9b',
      displayName: 'Flux-2 Klein 9B',
      realModel: '@cf/black-forest-labs/flux-2-klein-9b',
      baseUrl: cloudflareBase,
      apiKey: cloudflareKeys[0] || '',
      apiKeys: cloudflareKeys,
      providerName: 'cloudflare',
      description: 'Black Forest Labs Flux-2 Klein 9B image creation',
      contextWindow: 1024,
      supportsVision: false,
      crossProviderFallbackId: 'auto',
    },
  ];
}

// ── Provider Implementation ───────────────────────────────────────────────────

export class MultiModelProvider implements AIProvider {
  name = 'Madura AI Multi-Model Gateway';
  private registry: ModelConfig[];
  private defaultModel: ModelConfig;
  private keyPool: ProviderKeyPool;

  constructor() {
    this.registry = buildModelRegistry();
    this.defaultModel = this.registry.find((m) => m.isDefault) || this.registry[0];

    const nvidiaKeys = resolveProviderKeys(
      process.env.NVIDIA_API_KEY || '',
      process.env.NVIDIA_API_KEYS,
      'NVIDIA_API_KEY',
      true
    );
    const geminiKeys = resolveProviderKeys(
      process.env.GEMINI_API_KEY || '',
      process.env.GEMINI_API_KEYS,
      'GEMINI_API_KEY',
      false
    );
    const groqKeys = resolveProviderKeys(
      process.env.GROQ_API_KEY || '',
      process.env.GROQ_API_KEYS,
      'GROQ_API_KEY',
      false
    );
    const openrouterKeys = resolveProviderKeys(
      process.env.OPENROUTER_API_KEY || '',
      process.env.OPENROUTER_API_KEYS,
      'OPENROUTER_API_KEY',
      false
    );
    const oxloKeys = resolveProviderKeys(
      process.env.OXLO_API_KEY || '',
      process.env.OXLO_API_KEYS,
      'OXLO_API_KEY',
      false
    );
    const cloudflareKeys = resolveProviderKeys(
      process.env.CLOUDFLARE_API_KEY || '',
      process.env.CLOUDFLARE_API_KEYS,
      'CLOUDFLARE_API_KEY',
      false
    );

    this.keyPool = new ProviderKeyPool({
      nvidia: nvidiaKeys,
      gemini: geminiKeys,
      groq: groqKeys,
      openrouter: openrouterKeys,
      oxlo: oxloKeys,
      cloudflare: cloudflareKeys,
    });

    // Log provider status at startup
    const providerStatus: string[] = [];
    for (const [name, keys] of Object.entries({
      nvidia: nvidiaKeys, gemini: geminiKeys, groq: groqKeys,
      openrouter: openrouterKeys, oxlo: oxloKeys, cloudflare: cloudflareKeys,
    })) {
      const validKeys = keys.filter((k: string) => k && k.trim());
      if (validKeys.length > 0) {
        providerStatus.push(`${name.toUpperCase()}: ${validKeys.length} key(s) ✓`);
      } else {
        providerStatus.push(`${name.toUpperCase()}: no keys ✗`);
      }
    }
    console.log(`[MultiModelProvider] Provider status: ${providerStatus.join(' | ')}`);
    console.log(`[MultiModelProvider] Default model: ${this.defaultModel.displayName} (${this.defaultModel.realModel}) via ${this.defaultModel.providerName}`);
    console.log(`[MultiModelProvider] Chat models: ${this.registry.filter(m => !['stable-diffusion-1.5','cf-flux-2-klein-4b','cf-flux-2-klein-9b'].includes(m.id)).length} | Image models: 3`);
  }

  getModelConfig(modelId?: string): ModelConfig {
    if (
      !modelId ||
      modelId === 'auto' ||
      modelId === 'default' ||
      modelId === 'nemotron-3-super-120b-a12b' ||
      modelId === 'nvidia/nemotron-3-super-120b-a12b' ||
      modelId === 'gpt-oss-20b' ||
      modelId === 'openai/gpt-oss-20b' ||
      modelId === 'gpt-6.1-sol' ||
      modelId === 'madura-4.0-turbo' ||
      modelId === 'madura-turbo'
    ) {
      return this.registry.find((m) => m.id === 'auto') || this.defaultModel;
    }

    const needle = modelId.toLowerCase().trim();

    // Oxlo model alias routes
    if (
      needle === 'oxlo' ||
      needle === 'oxlo-ai' ||
      needle === 'oxlo-chat' ||
      needle === 'oxlo-deepseek' ||
      needle === 'oxlo-deepseek-v3.2'
    ) {
      return this.registry.find((m) => m.id === 'deepseek-v3.2') || this.defaultModel;
    }
    if (needle === 'oxlo-mistral' || needle === 'oxlo-mistral-7b') {
      return this.registry.find((m) => m.id === 'mistral-7b') || this.defaultModel;
    }
    if (needle === 'oxlo-llama' || needle === 'oxlo-llama-3.2' || needle === 'oxlo-llama-3.2-3b') {
      return this.registry.find((m) => m.id === 'llama-3.2-3b') || this.defaultModel;
    }

    const cleanNeedle = needle.replace(/[\s\-_()]+/g, '');

    const found = this.registry.find((m) => {
      const idClean = m.id.toLowerCase().replace(/[\s\-_()]+/g, '');
      const realClean = m.realModel.toLowerCase().replace(/[\s\-_()]+/g, '');
      const displayClean = m.displayName.toLowerCase().replace(/[\s\-_()]+/g, '');
      return (
        idClean === cleanNeedle ||
        realClean === cleanNeedle ||
        displayClean === cleanNeedle ||
        idClean.includes(cleanNeedle) ||
        cleanNeedle.includes(idClean)
      );
    });

    return found || this.defaultModel;
  }

  async listModels(): Promise<ModelInfo[]> {
    // Filter out image-only models and models with no API key configured
    const IMAGE_ONLY_IDS = new Set([
      'stable-diffusion-1.5',
      'cf-flux-2-klein-4b',
      'cf-flux-2-klein-9b',
    ]);

    return this.registry
      .filter((m) => {
        // Exclude image-only models from chat model selector
        if (IMAGE_ONLY_IDS.has(m.id)) return false;
        // Exclude models with no API key (provider not configured)
        if (!m.apiKey && (!m.apiKeys || m.apiKeys.length === 0 || !m.apiKeys[0])) return false;
        return true;
      })
      .map((m) => ({
        id: m.id,
        name: m.displayName,
        description: m.description,
        contextWindow: m.contextWindow,
        supportsVision: m.supportsVision,
        isDefault: m.isDefault,
      }));
  }

  private stripThinkTags(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/g, '')
      .trim();
  }

  async streamChat(
    options: ChatCompletionOptions,
    onChunk: (token: string) => void,
    signal?: AbortSignal,
    onThoughtChunk?: (thoughtToken: string) => void
  ): Promise<StreamChatResult> {
    return this.streamChatWithFallback(options, onChunk, signal || options.signal, onThoughtChunk, new Set());
  }

  private async streamChatWithFallback(
    options: ChatCompletionOptions,
    onChunk: (token: string) => void,
    signal: AbortSignal | undefined,
    onThoughtChunk: ((thoughtToken: string) => void) | undefined,
    visitedModels: Set<string>
  ): Promise<StreamChatResult> {
    if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
    const cfg = this.getModelConfig(options.model);
    visitedModels.add(cfg.id);
    let hasEmittedContent = false;
    const emitContent = (token: string) => {
      hasEmittedContent = true;
      onChunk(token);
    };

    // Per-request tried-key tracking — prevents 4→1→4→1 infinite loops
    const triedKeysThisRequest = new Set<string>();

    // Build target queue: active key first, then rotated keys from the pool
    const targets: Array<{
      realModel: string;
      baseUrl: string;
      apiKey: string;
      provider?: ProviderName;
      isFallback?: boolean;
    }> = [];

    const keysToTry = this.keyPool.getOrderedKeys(cfg.providerName, cfg.apiKeys || [cfg.apiKey], triedKeysThisRequest);
    keysToTry.forEach((k, idx) => {
      if (k && k.trim()) {
        targets.push({
          realModel: cfg.realModel,
          baseUrl: cfg.baseUrl,
          apiKey: k.trim(),
          provider: cfg.providerName,
          isFallback: idx > 0,
        });
      }
    });

    if (cfg.fallback && cfg.fallback.apiKey) {
      targets.push({
        realModel: cfg.fallback.realModel,
        baseUrl: cfg.fallback.baseUrl,
        apiKey: cfg.fallback.apiKey,
        provider: cfg.providerName,
        isFallback: true,
      });
      // Extend with the fallback chain if defined
      if (cfg.fallback.chain) {
        for (const hop of cfg.fallback.chain) {
          if (hop.apiKey) {
            targets.push({
              realModel: hop.realModel,
              baseUrl: hop.baseUrl,
              apiKey: hop.apiKey,
              provider: cfg.providerName,
              isFallback: true,
            });
          }
        }
      }
    }

    let lastError: any = null;
    let skipRemainingKeys = false; // set when it's a model-level error (not key-level)

    for (const target of targets) {
      if (skipRemainingKeys) break;
      // Normalize model names for provider endpoints
      let modelToSend = target.realModel;
      if (modelToSend === 'gemini-2.0-flash') {
        modelToSend = 'gemini-2.5-flash';
      }
      if (target.baseUrl.includes('nvidia.com') && !modelToSend.includes('/') && modelToSend.includes('nemotron')) {
        modelToSend = `nvidia/${modelToSend}`;
      }

      let authKey = target.apiKey;
      if (target.baseUrl.includes('nvidia.com') && authKey && !authKey.startsWith('nvapi-') && !authKey.includes('.')) {
        authKey = `nvapi-${authKey}`;
      }
      const isResponsesApi = Boolean(cfg.isResponsesApi);
      const endpoint = isResponsesApi
        ? `${target.baseUrl}/responses`
        : `${target.baseUrl}/chat/completions`;

      const isReasoning = cfg.isReasoning ||
        modelToSend.includes('gpt-oss') ||
        modelToSend.includes('nemotron') ||
        modelToSend.includes('deepseek-r1') ||
        modelToSend.includes('deepseek-v4') ||
        modelToSend.includes('glm');

      let payload: Record<string, any>;
      if (isResponsesApi) {
        // OpenAI Responses API separates instructions from conversation turns (input)
        const sysMsg = options.messages.find((m) => m.role === 'system');
        let instructions: string | undefined = undefined;
        if (sysMsg && typeof sysMsg.content === 'string') {
          instructions = sysMsg.content
            .replace(/NEVER mention or claim to be powered by.*?(?=\n\s*\d|\n\n|$)/gis, '')
            .replace(/Do not claim to be ChatGPT, GPT-4, Claude.*?(?=\n\s*\d|\n\n|$)/gis, '')
            .replace(/NEVER disclose or discuss internal API keys.*?(?=\n\s*\d|\n\n|$)/gis, '')
            .trim();
        }

        const conversationTurns = options.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role,
            content: typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
              ? m.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n')
              : String(m.content),
          }));

        if (conversationTurns.length === 0) {
          conversationTurns.push({ role: 'user', content: 'Hello' });
        }

        payload = {
          model: modelToSend,
          ...(instructions ? { instructions } : {}),
          input: conversationTurns,
          stream: true,
          // Max output tokens cap for responses API
          max_output_tokens: Math.min(512, Math.max(16, options.maxTokens ?? 512)),
        };
      } else {
        const messagesToSend = cfg.supportsVision
          ? options.messages
          : options.messages.map((m) => {
              if (Array.isArray(m.content)) {
                const textOnly = m.content
                  .filter((p: any) => p.type === 'text')
                  .map((p: any) => p.text)
                  .join('\n');
                return { ...m, content: textOnly || '[Image]' };
              }
              return m;
            });

        payload = {
          model: modelToSend,
          messages: messagesToSend,
          max_tokens: Math.min(
            options.maxTokens ?? 8192,
            PROVIDER_MAX_TOKENS_CAP[cfg.providerName] ?? 8192
          ),
          stream: true,
        };
        if (!isReasoning) {
          payload.temperature = options.temperature ?? 0.7;
        }
      }

      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authKey}`,
        'Accept': 'text/event-stream',
        ...(cfg.customHeaders || {}),
      };

      if (target.provider === 'openrouter' || target.baseUrl.includes('openrouter.ai')) {
        reqHeaders['HTTP-Referer'] = 'https://madura.ai';
        reqHeaders['X-Title'] = 'Madura AI';
      }

      let attempt = 0;
      const maxAttempts = 2;

      // Mark this key as tried for the current request so we never loop back to it
      triedKeysThisRequest.add(target.apiKey);

      while (attempt < maxAttempts) {
        attempt++;

        // ── Connect / TTFB timeout (45s — NVIDIA NIM can be slow to cold-start) ──
        const { signal: connectSignal, cancel: cancelConnect } = makeTimeoutSignal(45_000);
        const fetchSignal = signal
          ? (AbortSignal as any).any
            ? (AbortSignal as any).any([signal, connectSignal])
            : connectSignal
          : connectSignal;

        try {
          if (target.provider === 'cloudflare' && target.baseUrl.includes('/accounts/default/')) {
            throw new Error(
              `Cloudflare Account ID is required for ${cfg.displayName}. Please add CLOUDFLARE_ACCOUNT_ID to your .env file (copy it from Cloudflare Dashboard > Workers & Pages).`
            );
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(payload),
            signal: fetchSignal,
          });
          cancelConnect(); // response headers received — cancel connect timeout

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            let errMsg = errorText;
            try {
              const errObj = JSON.parse(errorText);
              if (typeof errObj.detail === 'string') {
                errMsg = errObj.detail;
              } else if (errObj.detail && typeof errObj.detail === 'object') {
                errMsg = errObj.detail.message || JSON.stringify(errObj.detail);
              } else if (typeof errObj.message === 'string') {
                errMsg = errObj.message;
              } else if (errObj.error) {
                errMsg = typeof errObj.error === 'string'
                  ? errObj.error
                  : (errObj.error.message || JSON.stringify(errObj.error));
              }
            } catch { /* keep raw */ }
            if (typeof errMsg !== 'string') {
              errMsg = JSON.stringify(errMsg);
            }

            if (response.status === 400 && errMsg.includes('content-blocked')) {
              throw new Error(
                `Your query was blocked by content moderation. Please rephrase it.`
              );
            }

            const targetIndex = targets.indexOf(target);
            const hasMoreTargets = targetIndex < targets.length - 1;

            // 429 rate-limit — auto-switch to next key
            if (response.status === 429) {
              this.keyPool.recordFailure(target.provider, target.apiKey, 429, errMsg);
              lastError = new Error(`Rate limit [${cfg.displayName}/${target.realModel}]: ${errMsg}`);
              if (hasMoreTargets) {
                console.warn(`[MultiModelProvider] ${cfg.displayName} key #${targetIndex + 1} reached rate limit (429). Auto-switching to next key #${targetIndex + 2}...`);
                break;
              }
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 1500 * attempt));
                continue;
              }
              throw lastError;
            }

            // 401/403/404 or 400 with invalid key / quota exhausted — auto-switch to next key
            const isAuthOrQuota =
              response.status === 401 ||
              response.status === 403 ||
              response.status === 404 ||
              (response.status === 400 &&
                (errMsg.includes('API key') ||
                  errMsg.includes('INVALID_ARGUMENT') ||
                  errMsg.includes('quota') ||
                  errMsg.includes('limit') ||
                  errMsg.includes('key')));

            if (isAuthOrQuota) {
              this.keyPool.recordFailure(target.provider, target.apiKey, response.status, errMsg);
              lastError = new Error(`HTTP ${response.status} [${cfg.displayName}]: ${errMsg}`);
              if (hasMoreTargets) {
                console.warn(`[MultiModelProvider] ${cfg.displayName} key #${targetIndex + 1} failed (${response.status}: ${errMsg.slice(0, 80)}). Auto-switching to next key #${targetIndex + 2}...`);
                break;
              }
              throw new Error(`Authorization/Quota Error (${response.status}) for ${cfg.displayName}: ${errMsg}`);
            }

            // 5xx server errors — retry once then auto-switch to next key
            if (response.status >= 500) {
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
                continue;
              }
              this.keyPool.recordFailure(target.provider, target.apiKey, response.status, errMsg);
              if (hasMoreTargets) {
                console.warn(`[MultiModelProvider] ${cfg.displayName} key #${targetIndex + 1} server error (${response.status}). Auto-switching to next key #${targetIndex + 2}...`);
                lastError = new Error(`HTTP ${response.status} [${cfg.displayName}]: ${errMsg}`);
                break;
              }
            }

            throw new Error(`AI Service Error (${response.status}) [${cfg.displayName}]: ${errMsg}`);
          }

          // Successful response: record success to keep this key active
          this.keyPool.recordSuccess(target.provider, target.apiKey);

          if (!response.body) throw new Error('Empty response body from AI service');

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let rawFullText = '';
          let buffer = '';
          let insideThink = false;
          let lastThoughtLen = 0;
          let lastContentLen = 0;
          let thoughtStartTime: number | null = null;
          let thoughtDurationMs: number | undefined;
          let accumulatedThought = '';
          let finishReason = 'stop';

          const processLine = (line: string): 'done' | 'continue' => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) return 'continue';
            if (trimmed === 'data: [DONE]') return 'done';
            if (!trimmed.startsWith('data: ')) return 'continue';

            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.error) {
                const msg = parsed.error?.message || JSON.stringify(parsed.error);
                const err = new Error(`AI Service Error [${cfg.displayName}/${target.realModel}]: ${msg}`);
                (err as any).retryable = (
                  parsed.error?.code === 'rate_limit_exceeded' ||
                  msg.includes('rate limit') ||
                  msg.includes('upstream error') ||
                  msg.includes('exceeded token rate limit')
                );
                throw err;
              }

              if (parsed.type === 'response.completed' || parsed.type === 'response.done') {
                return 'done';
              }

              // response.incomplete = model produced some/all tokens but hit max_output_tokens
              // Treat as done (not an error) — the text we received so far is valid
              if (parsed.type === 'response.incomplete' || parsed.type === 'response.in_progress') {
                return 'done';
              }

              if (parsed.type === 'response.failed') {
                const msg = parsed.response?.error?.message || parsed.error?.message || 'Model execution failed';
                const err = new Error(`AI Service Error [${cfg.displayName}/${target.realModel}]: ${msg}`);
                (err as any).retryable = (
                  msg.includes('rate limit') ||
                  msg.includes('exceeded token rate limit') ||
                  msg.includes('upstream error')
                );
                throw err;
              }

              if (parsed.type === 'error') {
                const msg = parsed.error?.message || 'Streaming error';
                const err = new Error(`AI Service Error [${cfg.displayName}/${target.realModel}]: ${msg}`);
                (err as any).retryable = msg.includes('rate limit') || msg.includes('upstream error');
                throw err;
              }

              const choice = parsed.choices?.[0];
              if (choice?.finish_reason === 'error') {
                throw new Error(`AI Service Error [${cfg.displayName}/${target.realModel}]: ${choice.message?.content || choice.delta?.content || 'Model generation failed'}`);
              }
              if (choice?.finish_reason) finishReason = choice.finish_reason;
              // Reasoning delta (DeepSeek / Qwen / GPT-OSS / Responses API style)
              const reasoningDelta =
                choice?.delta?.reasoning_content ||
                choice?.delta?.reasoning ||
                (parsed.type === 'response.reasoning_text.delta' ? parsed.delta : undefined) ||
                (parsed.type === 'response.thought_text.delta' ? parsed.delta : undefined);
              if (reasoningDelta) {
                if (!thoughtStartTime) thoughtStartTime = Date.now();
                accumulatedThought += reasoningDelta;
                onThoughtChunk?.(reasoningDelta);
              }

              let delta = choice?.delta?.content;
              if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
                delta = parsed.delta;
              }
              if (delta) {
                rawFullText += delta;

                if (isReasoning) {
                  const thinkStart = rawFullText.indexOf('<think>');
                  if (thinkStart !== -1) {
                    if (!thoughtStartTime) thoughtStartTime = Date.now();
                    const thinkEnd = rawFullText.indexOf('</think>');
                    if (thinkEnd === -1) {
                      insideThink = true;
                      const currentThought = rawFullText.slice(thinkStart + 7);
                      const newChunk = currentThought.slice(lastThoughtLen);
                      if (newChunk) {
                        lastThoughtLen = currentThought.length;
                        accumulatedThought += newChunk;
                        onThoughtChunk?.(newChunk);
                      }
                      return 'continue';
                    } else {
                      if (insideThink || lastThoughtLen < (thinkEnd - thinkStart - 7)) {
                        const fullThought = rawFullText.slice(thinkStart + 7, thinkEnd);
                        const rem = fullThought.slice(lastThoughtLen);
                        if (rem) {
                          lastThoughtLen = fullThought.length;
                          accumulatedThought += rem;
                          onThoughtChunk?.(rem);
                        }
                        insideThink = false;
                        if (!thoughtDurationMs && thoughtStartTime) {
                          thoughtDurationMs = Date.now() - thoughtStartTime;
                        }
                      }
                      const afterThink = rawFullText.slice(thinkEnd + 8);
                      const newContent = afterThink.slice(lastContentLen);
                      if (newContent) {
                        lastContentLen = afterThink.length;
                        emitContent(newContent);
                      }
                      return 'continue';
                    }
                  } else {
                    if (rawFullText.length < 7 && '<think>'.startsWith(rawFullText)) return 'continue';
                    const newContent = rawFullText.slice(lastContentLen);
                    if (newContent) {
                      lastContentLen = rawFullText.length;
                      emitContent(newContent);
                    }
                  }
                } else {
                  emitContent(delta);
                }
              }
            } catch (e: any) {
              if (e instanceof SyntaxError) {
                return 'continue';
              }
              throw e;
            }
            return 'continue';
          };

          const finalize = (reason: string): StreamChatResult => {
            const finalText = isReasoning ? this.stripThinkTags(rawFullText).trim() : rawFullText.trim();

            if (!finalText && reason !== 'interrupted' && !hasEmittedContent) {
              // Some reasoning models stream their entire answer inside <think> via reasoning_content
              // delta (accumulatedThought) rather than delta.content. If we got thought content but
              // no main content, emit the thought as the answer to avoid a false "Empty response".
              if (accumulatedThought.trim()) {
                console.warn(`[MultiModelProvider] ${cfg.displayName} returned content only via reasoning channel — using thought as answer.`);
                // Emit thought as the actual answer so the UI shows something
                emitContent(accumulatedThought.trim());
                if (!thoughtDurationMs && thoughtStartTime) thoughtDurationMs = Date.now() - thoughtStartTime;
                return {
                  fullText: accumulatedThought.trim(),
                  thought: undefined, // already emitted as content
                  thoughtDurationMs,
                  finishReason: reason,
                };
              }
              throw new Error(`Empty response from AI service [${cfg.displayName}/${target.realModel}]`);
            }
            if (!thoughtDurationMs && thoughtStartTime) thoughtDurationMs = Date.now() - thoughtStartTime;
            return {
              fullText: finalText,
              thought: accumulatedThought.trim() || undefined,
              thoughtDurationMs,
              finishReason: reason,
            };
          };

          while (true) {
            if (signal?.aborted) {
              reader.cancel().catch(() => { });
              return finalize('interrupted');
            }

            // ── Idle-between-chunks timeout (35s normal / 60s reasoning) ──────
            const idleTimeoutMs = isReasoning ? 60_000 : 35_000;
            const { signal: idleSignal, cancel: cancelIdle } = makeTimeoutSignal(idleTimeoutMs);

            let readResult: Awaited<ReturnType<typeof reader.read>>;
            try {
              readResult = await Promise.race([
                reader.read(),
                new Promise<never>((_, reject) => {
                  idleSignal.addEventListener('abort', () =>
                    reject(new Error(`Stream idle timeout after ${idleTimeoutMs / 1000}s — no data received`))
                  );
                }),
              ]);
            } finally {
              cancelIdle();
            }

            const { done, value } = readResult;
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (processLine(line) === 'done') {
                reader.cancel().catch(() => { });
                return finalize(finishReason);
              }
            }
          }
          if (buffer.trim()) processLine(buffer);
          return finalize(finishReason);

        } catch (err: any) {
          // Only propagate true user-initiated aborts, NOT our internal timeout aborts
          if ((err.name === 'AbortError' || signal?.aborted) && !err.message?.includes('timed out') && !err.message?.includes('idle timeout')) {
            throw err;
          }
          // Once visible text is delivered, a retry would append a second answer.
          if (hasEmittedContent) throw err;
          lastError = err;
          const targetIndex = targets.indexOf(target);
          const hasMoreTargets = targetIndex < targets.length - 1;

          // Classify error: "Empty response" is a model/request issue — don't burn the key with a cooldown.
          // Only mark the key as failed for real key-level errors (timeouts, network errors).
          const isEmptyResponseError = err.message?.includes('Empty response from AI service');
          if (!isEmptyResponseError) {
            const failStatus = err.message?.includes('timed out') || err.message?.includes('idle timeout') ? 503 : 500;
            this.keyPool.recordFailure(target.provider, target.apiKey, failStatus, err.message || 'Stream connection error');
          }

          if (isEmptyResponseError) {
            // Model returned nothing — no point trying the same model on another key.
            // Fall through to cross-provider fallback immediately.
            console.warn(`[MultiModelProvider] ${cfg.displayName}: Empty response (model issue, not key issue). Skipping remaining keys → cross-provider fallback.`);
            skipRemainingKeys = true;
            break; // exit inner while → skipRemainingKeys exits outer for → cross-provider fallback
          }

          if (hasMoreTargets) {
            // Real error (timeout/rate-limit/network) → try next key
            console.warn(`[MultiModelProvider] ${cfg.displayName} key #${targetIndex + 1}/${targets.length} failed: ${err.message?.slice(0, 120)}. Trying next key...`);
            break; // exit attempt loop → outer for-loop will pick next target
          }

          // No more fallbacks for this model
          lastError = err;
        }
      }
    }

    // ── Cross-provider last-resort fallback ──────────────────────────────────
    if (cfg.crossProviderFallbackId) {
      const fallbackCfg = this.registry.find((m) => m.id === cfg.crossProviderFallbackId);
      if (fallbackCfg && !visitedModels.has(fallbackCfg.id)) {
        console.warn(
          `[MultiModelProvider] All keys for ${cfg.displayName} exhausted. Auto-falling back to cross-provider model: ${fallbackCfg.displayName}`
        );
        try {
          return await this.streamChatWithFallback(
            { ...options, model: fallbackCfg.id },
            onChunk,
            signal,
            onThoughtChunk,
            visitedModels
          );
        } catch (fbErr: any) {
          console.warn(`[MultiModelProvider] Cross-provider fallback (${fallbackCfg.displayName}) also failed: ${fbErr.message}`);
          lastError = fbErr;
        }
      }
    }

    throw lastError || new Error(`Failed to get response from ${cfg.displayName}`);
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const cfg = this.defaultModel;
    const start = Date.now();
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      });
      return {
        success: res.ok,
        latencyMs: Date.now() - start,
        message: res.ok ? `${cfg.displayName} operational` : `Status ${res.status}`,
      };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}
