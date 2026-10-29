/**
 * Madura AI — Multi-Provider Gateway
 *
 * Routes each model ID to the correct API key, base URL, and real model name.
 * Default model: GPT-OSS-20B via NVIDIA NIM (displayed in UI as "Auto").
 * Supports Gemini 2.5 Flash, GPT-OSS-120B, DeepSeek V3, Gemma-4, and Nvidia Ultron.
 */

import { AIProvider, ChatCompletionOptions, StreamChatResult } from './provider.interface.js';
import { ModelInfo } from '../../types/index.js';

// ── Model Registry ────────────────────────────────────────────────────────────

export interface ModelFallbackConfig {
  realModel: string;
  baseUrl: string;
  apiKey: string;
  // additional fallback hops in priority order
  chain?: Array<{ realModel: string; baseUrl: string; apiKey: string }>;
}

export type ProviderName = 'nvidia' | 'gemini' | 'groq';

export class ProviderKeyPool {
  private pools: Map<ProviderName, {
    keys: string[];
    currentIndex: number;
    cooldowns: Map<string, number>;
  }> = new Map();

  constructor(initial: Record<ProviderName, string[]>) {
    for (const [provider, keys] of Object.entries(initial) as [ProviderName, string[]][]) {
      this.pools.set(provider, {
        keys: [...keys],
        currentIndex: 0,
        cooldowns: new Map(),
      });
    }
  }

  /**
   * Returns an ordered list of keys for the provider starting with the active key.
   * Keys that are not in rate-limit cooldown are prioritized first.
   */
  getOrderedKeys(provider?: ProviderName, overrideKeys?: string[]): string[] {
    const pool = provider ? this.pools.get(provider) : undefined;
    const allKeys = pool && pool.keys.length > 0 ? pool.keys : (overrideKeys || []);
    if (allKeys.length === 0) return [];

    const total = allKeys.length;
    const currentIdx = pool ? pool.currentIndex : 0;
    const now = Date.now();

    const rotated: string[] = [];
    for (let i = 0; i < total; i++) {
      const idx = (currentIdx + i) % total;
      rotated.push(allKeys[idx]);
    }

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
   */
  recordSuccess(provider: ProviderName | undefined, key: string): void {
    if (!provider) return;
    const pool = this.pools.get(provider);
    if (!pool) return;
    pool.cooldowns.delete(key);
    const idx = pool.keys.indexOf(key);
    if (idx !== -1 && pool.currentIndex !== idx) {
      console.log(`[ProviderKeyPool] Switched active ${provider.toUpperCase()} key to #${idx + 1}/${pool.keys.length}`);
      pool.currentIndex = idx;
    }
  }

  /**
   * Applies cooldown and auto-switches to the next key in the pool.
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
    if (total > 1 && idx !== -1) {
      const nextIdx = (idx + 1) % total;
      pool.currentIndex = nextIdx;
      console.warn(
        `[ProviderKeyPool] ${provider.toUpperCase()} key #${idx + 1} limit reached / failed (${status}: ${reason.slice(0, 80)}). Auto-switching to key #${nextIdx + 1}/${total}...`
      );
    } else {
      console.warn(
        `[ProviderKeyPool] ${provider.toUpperCase()} key failed (${status}: ${reason.slice(0, 80)}). No alternative keys available in pool.`
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
  const nvidiaBase = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

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
  return [
    // 1. Auto (Default Model) — NVIDIA NIM GPT-OSS-20B
    {
      id: 'auto',
      displayName: 'Auto',
      realModel: process.env.NVIDIA_MODEL || 'openai/gpt-oss-20b',
      baseUrl: nvidiaBase,
      apiKey: nvidiaKeys[0] || '',
      apiKeys: nvidiaKeys,
      providerName: 'nvidia',
      isDefault: true,
      description: 'Smart default model',
      contextWindow: 128000,
      supportsVision: false,
      isReasoning: true,
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
    // 5. Ultron — NVIDIA NIM Nemotron Ultra 550B
    {
      id: 'nvidia-ultron',
      displayName: 'Ultron',
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

    this.keyPool = new ProviderKeyPool({
      nvidia: nvidiaKeys,
      gemini: geminiKeys,
      groq: groqKeys,
    });
  }

  getModelConfig(modelId?: string): ModelConfig {
    if (
      !modelId ||
      modelId === 'auto' ||
      modelId === 'default' ||
      modelId === 'gpt-oss-20b' ||
      modelId === 'openai/gpt-oss-20b' ||
      modelId === 'gpt-6.1-sol'
    ) {
      return this.registry.find((m) => m.id === 'auto') || this.defaultModel;
    }
    const needle = modelId.toLowerCase();
    const found = this.registry.find(
      (m) =>
        m.id.toLowerCase() === needle ||
        m.realModel.toLowerCase() === needle ||
        m.displayName.toLowerCase() === needle
    );
    return found || this.defaultModel;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.registry.map((m) => ({
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
    const cfg = this.getModelConfig(options.model);

    // Build target queue: active key first, then rotated keys from the pool
    const targets: Array<{
      realModel: string;
      baseUrl: string;
      apiKey: string;
      provider?: ProviderName;
      isFallback?: boolean;
    }> = [];

    const keysToTry = this.keyPool.getOrderedKeys(cfg.providerName, cfg.apiKeys || [cfg.apiKey]);
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

    for (const target of targets) {
      // Normalize model names for provider endpoints
      let modelToSend = target.realModel;
      if (modelToSend === 'gemini-2.0-flash') {
        modelToSend = 'gemini-2.5-flash';
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
        modelToSend.includes('nemotron');

      let payload: Record<string, any>;
      if (isResponsesApi) {
        // OpenAI Responses API separates instructions from conversation turns (input)
        const sysMsg = options.messages.find((m) => m.role === 'system');
        let instructions: string | undefined = undefined;
        if (sysMsg && sysMsg.content) {
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
            content: m.content,
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
        payload = {
          model: modelToSend,
          messages: options.messages,
          max_tokens: options.maxTokens ?? 8192,
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

      let attempt = 0;
      const maxAttempts = 2;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(payload),
            signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            let errMsg = errorText;
            try {
              const errObj = JSON.parse(errorText);
              errMsg = errObj.detail || errObj.message || errObj.error?.message || errorText;
            } catch { /* keep raw */ }

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
                        onChunk(newContent);
                      }
                      return 'continue';
                    }
                  } else {
                    if (rawFullText.length < 7 && '<think>'.startsWith(rawFullText)) return 'continue';
                    const newContent = rawFullText.slice(lastContentLen);
                    if (newContent) {
                      lastContentLen = rawFullText.length;
                      onChunk(newContent);
                    }
                  }
                } else {
                  onChunk(delta);
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
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (processLine(line) === 'done') return finalize('stop');
            }
          }
          if (buffer.trim()) processLine(buffer);
          return finalize('stop');

        } catch (err: any) {
          if (err.name === 'AbortError' || signal?.aborted) throw err;
          lastError = err;
          const targetIndex = targets.indexOf(target);
          const hasMoreTargets = targetIndex < targets.length - 1;

          this.keyPool.recordFailure(target.provider, target.apiKey, 500, err.message || 'Stream connection error');

          if (hasMoreTargets) {
            // Any error (including retryable rate-limit/upstream errors) → auto-switch to next fallback
            console.warn(`[MultiModelProvider] Target #${targetIndex + 1} (${target.realModel}) failed: ${err.message?.slice(0, 120)}. Auto-switching to next key/fallback...`);
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
      if (fallbackCfg) {
        console.warn(
          `[MultiModelProvider] All keys for ${cfg.displayName} exhausted. Auto-falling back to cross-provider model: ${fallbackCfg.displayName}`
        );
        try {
          return await this.streamChat(
            { ...options, model: fallbackCfg.id },
            onChunk,
            signal,
            onThoughtChunk
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
