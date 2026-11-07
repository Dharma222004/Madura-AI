import { AIProvider, ChatCompletionOptions, StreamChatResult } from './provider.interface.js';
import { ModelInfo } from '../../types/index.js';
import { DEFAULT_CHAT_MODEL } from './model.config.js';

export const CLEAN_MODELS: ModelInfo[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Mistral Large 4',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: true,
  },
  {
    id: 'gemini-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast multimodal model',
    contextWindow: 1000000,
    supportsVision: true,
    isDefault: false,
  },
  {
    id: 'qwen-3.8',
    name: 'Qwen 3.8',
    description: 'High performance model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS-120B',
    description: 'High-speed 120B model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'nvidia-ultron',
    name: 'Nemotron-3 Ultra',
    description: 'Deep reasoning model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'nemotron-lightning',
    name: 'Nemotron 3.5 Lightning',
    description: 'High-speed 30B reasoning model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'nemotron-omni',
    name: 'Nemotron Omni (Vision)',
    description: 'Image recognition & omni reasoning model',
    contextWindow: 128000,
    supportsVision: true,
    isDefault: false,
  },
  {
    id: 'minimax-m3.1-flash',
    name: 'Minimax- M3 Flash',
    description: 'High-speed Minimax reasoning model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'Deepseek-v4 Flash',
    description: 'DeepSeek V4.1 Flash model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    description: 'GLM 5.3 Flash model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'muse-glimmer-30b',
    name: 'Muse-Glimmer-30B',
    description: 'Meta Muse Glimmer 30B model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  // ── OpenRouter Models ──────────────────────────────────────────────────────
  {
    id: 'nemotron-3.5-super',
    name: 'Nemotron 3.5 Super',
    description: 'Nemotron vision-language model',
    contextWindow: 128000,
    supportsVision: true,
    isDefault: false,
  },
  {
    id: 'gemma-4',
    name: 'Gemma-4',
    description: 'Google Gemma 4 26B',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'recursive',
    name: 'Recursive',
    description: 'Recursive Flint model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'xingchen',
    name: 'Xingchen',
    description: 'Xingchen AGI 29B model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'gemma-4-31b',
    name: 'Gemma -4 31B',
    description: 'Google Gemma 4 31B',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  // ── Oxlo Models ───────────────────────────────────────────────────────────
  {
    id: 'deepseek-v3.2',
    name: 'Deepseek V 3.2',
    description: 'DeepSeek V3.2 model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B',
    description: 'Mistral 7B model',
    contextWindow: 32000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama3.2',
    description: 'Llama 3.2 3B model',
    contextWindow: 128000,
    supportsVision: false,
    isDefault: false,
  },
  {
    id: 'stable-diffusion-1.5',
    name: 'Stable Image Creation',
    description: 'AI image generation',
    contextWindow: 1024,
    supportsVision: false,
    isDefault: false,
  },
];

// Backward-compatible alias
export const KNOWN_NVIDIA_MODELS: ModelInfo[] = CLEAN_MODELS;

export class NvidiaProvider implements AIProvider {
  name = 'Madura AI Gateway';
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private baseUrl: string;

  constructor(apiKeyOrKeys: string | string[] = '', baseUrl: string = 'https://integrate.api.nvidia.com/v1') {
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
  }

  // Backward-compatible getter for tests inspecting private apiKey
  get apiKey(): string {
    return this.apiKeys[this.currentKeyIndex] || this.apiKeys[0] || '';
  }

  resolveModel(_modelId?: string): string {
    // Always resolve to the configured NVIDIA model (Mistral Large 4).
    // The 'auto' ID and any unrecognised aliases are intentionally mapped here
    // so the correct real model name is sent to the NVIDIA NIM API.
    const model = process.env.NVIDIA_MODEL || DEFAULT_CHAT_MODEL;
    // Prefix bare nemotron model names with the nvidia/ namespace
    if (!model.includes('/') && model.includes('nemotron')) {
      return `nvidia/${model}`;
    }
    return model;
  }

  /**
   * Strips reasoning model <think>...</think> tags from streamed content.
   * Reasoning models emit internal chain-of-thought
   * wrapped in <think> tags that should not be shown to the user.
   */
  private stripThinkTags(text: string): string {
    // Remove completed <think>...</think> blocks (including multiline)
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    // Remove any trailing unclosed <think> block (still thinking)
    cleaned = cleaned.replace(/<think>[\s\S]*$/g, '');
    return cleaned;
  }

  async streamChat(
    options: ChatCompletionOptions,
    onChunk: (token: string) => void,
    signal?: AbortSignal,
    onThoughtChunk?: (thoughtToken: string) => void
  ): Promise<StreamChatResult> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const backendModel = this.resolveModel(options.model);
    const isReasoningModel = backendModel.includes('gpt-oss') || backendModel.includes('o1') || backendModel.includes('o3') || backendModel.includes('lightning') || backendModel.includes('reasoning') || backendModel.includes('nemotron');

    const payload: Record<string, any> = {
      model: backendModel,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    };

    // Reasoning models may not support temperature; let the API use its default
    if (isReasoningModel) {
      delete payload.temperature;
    }

    const totalKeys = this.apiKeys.length || 1;
    let lastError: any = null;

    for (let k = 0; k < totalKeys; k++) {
      const keyIndex = (this.currentKeyIndex + k) % totalKeys;
      const activeKey = this.apiKeys[keyIndex] || this.apiKey;
      const hasMoreKeys = k < totalKeys - 1;

      let attempt = 0;
      const maxAttempts = 2;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeKey}`,
              'Accept': 'text/event-stream',
            },
            body: JSON.stringify(payload),
            signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            let parsedErrorTitle = '';
            try {
              const errObj = JSON.parse(errorText);
              if (typeof errObj.detail === 'string') {
                parsedErrorTitle = errObj.detail;
              } else if (errObj.detail && typeof errObj.detail === 'object') {
                parsedErrorTitle = errObj.detail.message || JSON.stringify(errObj.detail);
              } else if (typeof errObj.message === 'string') {
                parsedErrorTitle = errObj.message;
              } else if (typeof errObj.title === 'string') {
                parsedErrorTitle = errObj.title;
              } else {
                parsedErrorTitle = errorText;
              }
            } catch {
              parsedErrorTitle = errorText;
            }
            if (typeof parsedErrorTitle !== 'string') {
              parsedErrorTitle = JSON.stringify(parsedErrorTitle);
            }

            if (response.status === 401 || response.status === 403) {
              if (hasMoreKeys) {
                console.warn(`[NvidiaProvider] Key #${keyIndex + 1} authorization failed (${response.status}). Auto-switching to next key...`);
                this.currentKeyIndex = (keyIndex + 1) % totalKeys;
                break;
              }
              throw new Error(`AI Service Authorization Error (${response.status}): ${parsedErrorTitle || 'Authorization failed. Please check system configuration.'}`);
            }

            if (response.status === 429) {
              if (hasMoreKeys) {
                console.warn(`[NvidiaProvider] Key #${keyIndex + 1} rate limited (429). Auto-switching to next key...`);
                this.currentKeyIndex = (keyIndex + 1) % totalKeys;
                break;
              }
              if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 1500 * attempt));
                continue;
              }
              throw new Error(`AI Service Rate Limit Exceeded (429): ${parsedErrorTitle || 'Please wait a moment before trying again.'}`);
            }

            if (response.status >= 500 && attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, 1000 * attempt));
              continue;
            }

            if (hasMoreKeys) {
              console.warn(`[NvidiaProvider] Key #${keyIndex + 1} server error (${response.status}). Auto-switching to next key...`);
              this.currentKeyIndex = (keyIndex + 1) % totalKeys;
              break;
            }

            throw new Error(`AI Service Error (${response.status}): ${parsedErrorTitle || response.statusText}`);
          }

          if (this.currentKeyIndex !== keyIndex) {
            this.currentKeyIndex = keyIndex;
          }

        if (!response.body) {
          throw new Error('AI Service returned empty response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let rawFullText = '';
        let buffer = '';
        let insideThinkBlock = false;
        let lastEmittedThoughtLength = 0;
        let lastEmittedContentLength = 0;
        let thoughtStartTime: number | null = null;
        let thoughtDurationMs: number | undefined;
        let accumulatedThought = '';

        const processSSELine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) return 'continue'; // Skip comments/keepalives

          if (trimmed === 'data: [DONE]') {
            return 'done';
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);

              // Detect API-level errors embedded inside the SSE stream
              if (parsed.error) {
                const errMsg = parsed.error?.message || parsed.error?.detail || JSON.stringify(parsed.error);
                throw new Error(`AI Service Stream Error: ${errMsg}`);
              }

              // Detect finish_reason=error on a choice
              const choice = parsed.choices?.[0];
              if (choice?.finish_reason === 'error') {
                const errMsg = choice?.message?.content || choice?.delta?.content || 'Model generation failed';
                throw new Error(`AI Service Model Error: ${errMsg}`);
              }

              // 1. Handle dedicated reasoning_content delta (e.g. DeepSeek/Qwen style NIM endpoints)
              const reasoningDelta = choice?.delta?.reasoning_content || choice?.delta?.reasoning;
              if (reasoningDelta) {
                if (!thoughtStartTime) thoughtStartTime = Date.now();
                accumulatedThought += reasoningDelta;
                onThoughtChunk?.(reasoningDelta);
              }

              // 2. Handle standard content delta
              const delta = choice?.delta?.content;
              if (delta) {
                rawFullText += delta;

                // For reasoning models, track <think>...</think> blocks
                if (isReasoningModel) {
                  const thinkStartIdx = rawFullText.indexOf('<think>');

                  if (thinkStartIdx !== -1) {
                    if (!thoughtStartTime) thoughtStartTime = Date.now();
                    const thinkEndIdx = rawFullText.indexOf('</think>');

                    if (thinkEndIdx === -1) {
                      // Currently inside thinking block
                      insideThinkBlock = true;
                      const currentThought = rawFullText.slice(thinkStartIdx + 7);
                      const newThoughtChunk = currentThought.slice(lastEmittedThoughtLength);
                      if (newThoughtChunk) {
                        lastEmittedThoughtLength = currentThought.length;
                        accumulatedThought += newThoughtChunk;
                        onThoughtChunk?.(newThoughtChunk);
                      }
                      return 'continue';
                    } else {
                      // Finished <think> block
                      if (insideThinkBlock || lastEmittedThoughtLength < (thinkEndIdx - thinkStartIdx - 7)) {
                        const fullThought = rawFullText.slice(thinkStartIdx + 7, thinkEndIdx);
                        const remainingThought = fullThought.slice(lastEmittedThoughtLength);
                        if (remainingThought) {
                          lastEmittedThoughtLength = fullThought.length;
                          accumulatedThought += remainingThought;
                          onThoughtChunk?.(remainingThought);
                        }
                        insideThinkBlock = false;
                        if (!thoughtDurationMs && thoughtStartTime) {
                          thoughtDurationMs = Date.now() - thoughtStartTime;
                        }
                      }

                      // Content after </think>
                      const contentAfterThink = rawFullText.slice(thinkEndIdx + 8);
                      const newContent = contentAfterThink.slice(lastEmittedContentLength);
                      if (newContent) {
                        lastEmittedContentLength = contentAfterThink.length;
                        onChunk(newContent);
                      }
                      return 'continue';
                    }
                  } else {
                    // Check if first chunk is a partial '<think>' prefix (e.g. '<th')
                    if (rawFullText.length < 7 && '<think>'.startsWith(rawFullText)) {
                      return 'continue';
                    }

                    // Standard content outside of think tags
                    const newContent = rawFullText.slice(lastEmittedContentLength);
                    if (newContent) {
                      lastEmittedContentLength = rawFullText.length;
                      onChunk(newContent);
                    }
                  }
                } else {
                  onChunk(delta);
                }
              }
            } catch (parseErr: any) {
              // Re-throw real errors, skip malformed chunks
              if (parseErr.message?.startsWith('NVIDIA API')) {
                throw parseErr;
              }
              // Ignore malformed/incomplete JSON chunks
            }
          }
          return 'continue';
        };

        const finalizeResult = (finishReason: string): StreamChatResult => {
          const finalText = isReasoningModel ? this.stripThinkTags(rawFullText).trim() : rawFullText.trim();
          if (!thoughtDurationMs && thoughtStartTime) {
            thoughtDurationMs = Date.now() - thoughtStartTime;
          }
          return {
            fullText: finalText,
            thought: accumulatedThought.trim() || undefined,
            thoughtDurationMs,
            finishReason,
          };
        };

        while (true) {
          if (signal?.aborted) {
            reader.cancel().catch(() => { });
            return finalizeResult('interrupted');
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const result = processSSELine(line);
            if (result === 'done') {
              return finalizeResult('stop');
            }
          }
        }

        // Process any remaining data in the buffer after stream ends
        if (buffer.trim()) {
          const result = processSSELine(buffer);
          if (result === 'done') {
            return finalizeResult('stop');
          }
        }

        return finalizeResult('stop');
      } catch (err: any) {
        if (
          err.name === 'AbortError' ||
          signal?.aborted ||
          err.message.includes('NVIDIA API Key Error') ||
          err.message.includes('401') ||
          err.message.includes('403') ||
          attempt >= maxAttempts
        ) {
          throw err;
        }
      }
    }
  }

  throw lastError || new Error('Failed to generate response from AI Service after retries');
}

  async listModels(): Promise<ModelInfo[]> {
    return CLEAN_MODELS;
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs, message: 'AI Gateway operational and healthy' };
      } else {
        return {
          success: false,
          latencyMs,
          message: `AI Gateway status (${res.status})`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err.message || 'Connection failed',
      };
    }
  }
}
