import { Conversation, Message, UserSettings, ModelInfo, Attachment, SearchSource, UserMemory } from '../../types/index.js';
import { getCurrentToken, getCurrentUserId } from './supabase.js';

// Default built-in models so UI always has models available, even offline
export const DEFAULT_OFFLINE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast multimodal model with image OCR & vision support',
    contextWindow: 1000000,
    supportsVision: true,
    isDefault: true,
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS-120B',
    description: 'High-speed 120B reasoning model with deep analysis',
    contextWindow: 128000,
    supportsVision: false,
  },
  {
    id: 'qwen-3.8',
    name: 'Qwen 3.8',
    description: 'High performance balanced open model',
    contextWindow: 128000,
    supportsVision: false,
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    name: 'NVIDIA Nemotron 3 Ultra',
    description: 'State-of-the-art enterprise conversational reasoning',
    contextWindow: 128000,
    supportsVision: false,
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    description: 'General-purpose intelligent assistant via Groq',
    contextWindow: 128000,
    supportsVision: false,
  },
];

/**
 * Resolves the active API base URL.
 * Order of precedence:
 * 1. User-configured custom URL in Settings (saved in localStorage).
 * 2. Injected window.__API_BASE__ (if provided).
 * 3. Capacitor Android runtime -> default to local WiFi server http://10.62.19.85:3001/api.
 * 4. Web browser runtime -> relative '/api'.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '/api';

  // 1. User manual override from Settings
  const customUrl = localStorage.getItem('madura_api_url');
  if (customUrl && customUrl.trim()) {
    let clean = customUrl.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api')) clean = `${clean}/api`;
    return clean;
  }

  // 2. Injected window global
  if ((window as any).__API_BASE__) {
    return (window as any).__API_BASE__;
  }

  // 3. Android Capacitor detection
  const ua = navigator.userAgent || '';
  const isAndroid = /android/i.test(ua);
  const isCapacitor =
    window.location.protocol === 'capacitor:' ||
    (window.location.hostname === 'localhost' && isAndroid);

  if (isCapacitor || isAndroid) {
    // Default LAN IP of development PC
    return 'http://10.62.19.85:3001/api';
  }

  // 4. Default web
  return '/api';
}

/**
 * Update the user-configured API URL in localStorage.
 */
export function setApiBaseUrl(url: string | null): void {
  if (typeof window === 'undefined') return;
  if (!url || !url.trim()) {
    localStorage.removeItem('madura_api_url');
  } else {
    let clean = url.trim().replace(/\/+$/, '');
    localStorage.setItem('madura_api_url', clean);
  }
}

/**
 * Fetch wrapper with timeout protection to prevent hanging requests.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // If caller provided a signal, combine them
  if (init?.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': getCurrentUserId(),
  };
  const token = getCurrentToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function testConnection(targetUrl?: string): Promise<{
  ok: boolean;
  status?: string;
  latencyMs?: number;
  error?: string;
}> {
  const base = targetUrl ? targetUrl.replace(/\/+$/, '') : getApiBaseUrl();
  const healthUrl = base.endsWith('/api') ? `${base}/health` : `${base}/api/health`;
  const start = performance.now();

  try {
    const res = await fetchWithTimeout(healthUrl, { method: 'GET' }, 5000);
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json().catch(() => ({ status: 'ok' }));
      return { ok: true, status: data.status || 'healthy', latencyMs };
    }
    return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, error: err.name === 'AbortError' ? 'Connection timed out (5s)' : (err.message || 'Cannot reach server'), latencyMs };
  }
}

export async function fetchMemories(): Promise<UserMemory[]> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/memory`, {
      headers: getAuthHeaders(),
    }, 6000);
    if (!res.ok) return [];
    const data = await res.json();
    return data.memories || [];
  } catch (err) {
    console.warn('[API] Failed to fetch memories (offline?):', err);
    return [];
  }
}

export async function updateMemory(id: string, content: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/memory/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ content }),
  }, 6000);
  if (!res.ok) throw new Error('Failed to update memory');
  const data = await res.json();
  return data.success;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/memory/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  }, 6000);
  if (!res.ok) throw new Error('Failed to delete memory');
  const data = await res.json();
  return data.success;
}

export async function clearMemories(): Promise<boolean> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/memory`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  }, 6000);
  if (!res.ok) throw new Error('Failed to clear memories');
  const data = await res.json();
  return data.success;
}

export async function fetchConversations(query?: string): Promise<Conversation[]> {
  const base = getApiBaseUrl();
  const url = query ? `${base}/conversations?q=${encodeURIComponent(query)}` : `${base}/conversations`;

  try {
    const res = await fetchWithTimeout(url, { headers: getAuthHeaders() }, 8000);
    if (!res.ok) throw new Error(`Failed to fetch conversations (HTTP ${res.status})`);
    const data = await res.json();
    const list = data.conversations || [];
    // Cache in localStorage for offline fallback
    try {
      localStorage.setItem('madura_cached_conversations', JSON.stringify(list));
    } catch {}
    return list;
  } catch (err: any) {
    console.warn('[API] Failed to fetch conversations, checking offline cache:', err);
    try {
      const cached = localStorage.getItem('madura_cached_conversations');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  }
}

export async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/conversations/${id}`, {
    headers: getAuthHeaders(),
  }, 8000);
  if (!res.ok) throw new Error('Failed to fetch conversation');
  const data = await res.json();
  return data.conversation;
}

export async function createConversation(model: string, initialMessage?: string): Promise<Conversation> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ model, initialMessage }),
  }, 8000);
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = await res.json();
  return data.conversation;
}

export async function updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/conversations/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(updates),
  }, 8000);
  if (!res.ok) throw new Error('Failed to update conversation');
  const data = await res.json();
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/conversations/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  }, 8000);
  if (!res.ok) throw new Error('Failed to delete conversation');
  const data = await res.json();
  return data.success;
}

export async function clearAllConversations(): Promise<boolean> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/conversations`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  }, 8000);
  if (!res.ok) throw new Error('Failed to clear conversations');
  const data = await res.json();
  return data.success;
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ attachment: Attachment }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetchWithTimeout(`${getApiBaseUrl()}/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  }, 30000);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(errorData.error || 'Failed to upload file');
  }

  const data = await res.json();
  return { attachment: data.attachment };
}

export async function transcribeAudio(
  audioBlob: Blob,
  fileName: string = 'recording.webm'
): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, fileName);

  const res = await fetchWithTimeout(`${getApiBaseUrl()}/transcribe`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  }, 30000);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Audio transcription failed' }));
    throw new Error(err.error || 'Transcription failed');
  }

  return res.json();
}

/**
 * Fetch models from backend. If offline or unreachable, returns DEFAULT_OFFLINE_MODELS.
 */
export async function fetchModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/models`, {
      headers: getAuthHeaders(),
    }, 6000);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        try {
          localStorage.setItem('madura_cached_models', JSON.stringify(data.models));
        } catch {}
        return data.models;
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch live models, using offline defaults:', err);
  }

  // Check cached models from previous session
  try {
    const cached = localStorage.getItem('madura_cached_models');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // Fallback to built-in default models
  return DEFAULT_OFFLINE_MODELS;
}

export async function fetchSettings(): Promise<UserSettings> {
  const defaultSettings: UserSettings = {
    userName: 'Madura User',
    theme: 'dark',
    model: DEFAULT_OFFLINE_MODELS[0].id,
    temperature: 0.7,
    maxTokens: 8192,
    systemPrompt: '',
    enterToSend: true,
    useMockFallback: true,
    enableMemory: true,
  };

  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/settings`, {
      headers: getAuthHeaders(),
    }, 5000);

    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        try {
          localStorage.setItem('madura_cached_settings', JSON.stringify(data.settings));
        } catch {}
        return data.settings;
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch settings, checking local cache:', err);
  }

  try {
    const cached = localStorage.getItem('madura_cached_settings');
    if (cached) return JSON.parse(cached);
  } catch {}

  return defaultSettings;
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ settings }),
    }, 6000);

    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        try {
          localStorage.setItem('madura_cached_settings', JSON.stringify(data.settings));
        } catch {}
        return data.settings;
      }
    }
  } catch (err) {
    console.warn('[API] Could not save settings to server, saving locally:', err);
  }

  // Save locally in all cases
  const current = await fetchSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem('madura_cached_settings', JSON.stringify(updated));
  } catch {}
  return updated;
}

export async function abortActiveChat(conversationId: string): Promise<void> {
  try {
    await fetchWithTimeout(`${getApiBaseUrl()}/chat/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    }, 3000);
  } catch {}
}

export function streamChat(params: {
  conversationId?: string;
  message: string;
  model?: string;
  attachments?: Attachment[];
  enableSearch?: boolean;
  memoryPrompt?: string;
  memoryEnabled?: boolean;
  onToken: (token: string) => void;
  onThoughtToken?: (token: string) => void;
  onTitle?: (title: string, conversationId: string) => void;
  onSearchStart?: (query: string) => void;
  onSearchDone?: (sources: SearchSource[]) => void;
  onDone: (data: { conversation: Conversation; assistantMessage: Message }) => void;
  onError: (error: string) => void;
}): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          conversationId: params.conversationId,
          message: params.message,
          model: params.model,
          attachments: params.attachments,
          enableSearch: params.enableSearch,
          memoryPrompt: params.memoryPrompt,
          memoryEnabled: params.memoryEnabled,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({ error: response.statusText }));
        params.onError(errObj.error || `HTTP error ${response.status}`);
        return;
      }

      if (!response.body) {
        params.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';
      let currentData = '';
      let doneReceived = false;

      const dispatchEvent = () => {
        if (!currentData) return;
        try {
          const data = JSON.parse(currentData);
          if (currentEvent === 'token' && data.token) {
            params.onToken(data.token);
          } else if (currentEvent === 'thought_token' && data.token && params.onThoughtToken) {
            params.onThoughtToken(data.token);
          } else if (currentEvent === 'title' && data.title && params.onTitle) {
            params.onTitle(data.title, data.conversationId || '');
          } else if (currentEvent === 'search_start' && params.onSearchStart) {
            params.onSearchStart(data.query);
          } else if (currentEvent === 'search_done' && params.onSearchDone) {
            params.onSearchDone(data.sources || []);
          } else if (currentEvent === 'done') {
            doneReceived = true;
            params.onDone(data);
          } else if (currentEvent === 'error') {
            params.onError(data.error || 'Chat stream failed');
          }
        } catch {
          // Ignore partial chunk
        }
        currentData = '';
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            dispatchEvent();
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            const chunk = trimmed.slice(6);
            currentData = currentData ? `${currentData}\n${chunk}` : chunk;
          }
        }
      }

      // Flush remaining line in buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          const chunk = trimmed.slice(6);
          currentData = currentData ? `${currentData}\n${chunk}` : chunk;
        }
      }
      dispatchEvent();

      if (!doneReceived && !controller.signal.aborted) {
        params.onDone({
          conversation: {
            id: params.conversationId || '',
            title: 'Conversation',
            model: params.model || 'auto',
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          assistantMessage: {
            id: `asst-${Date.now()}`,
            conversationId: params.conversationId || '',
            role: 'assistant',
            content: '',
            status: 'completed',
            createdAt: Date.now(),
          },
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        // User cancelled, not an error
      } else {
        params.onError(err.message || 'Network stream disconnected. Check your server connection.');
      }
    }
  })();

  return controller;
}
