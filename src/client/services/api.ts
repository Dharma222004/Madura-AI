import { Conversation, Message, UserSettings, ModelInfo, Attachment, SearchSource, UserMemory } from '../../types/index.js';
import { getCurrentToken, getCurrentUserId } from './supabase.js';

const API_BASE = '/api';

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

export async function fetchMemories(): Promise<UserMemory[]> {
  const res = await fetch(`${API_BASE}/memory`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch memories');
  const data = await res.json();
  return data.memories || [];
}

export async function updateMemory(id: string, content: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/memory/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to update memory');
  const data = await res.json();
  return data.success;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/memory/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete memory');
  const data = await res.json();
  return data.success;
}

export async function clearMemories(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/memory`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to clear memories');
  const data = await res.json();
  return data.success;
}

export async function fetchConversations(query?: string): Promise<Conversation[]> {
  const url = query ? `${API_BASE}/conversations?q=${encodeURIComponent(query)}` : `${API_BASE}/conversations`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  const data = await res.json();
  return data.conversations || [];
}

export async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversation');
  const data = await res.json();
  return data.conversation;
}

export async function createConversation(title?: string, model?: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, model }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = await res.json();
  return data.conversation;
}

export async function updateConversation(
  id: string,
  updates: Partial<Conversation>
): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update conversation');
  const data = await res.json();
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

export async function clearAllConversations(): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to clear conversations');
}

export async function uploadFile(file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Failed to upload and parse file');
  }

  const data = await res.json();
  return data.attachment;
}

export async function transcribeAudio(
  audioBlob: Blob,
  fileName: string = 'recording.webm',
  language?: string
): Promise<{ text: string; model: string; language?: string; duration?: number }> {
  const formData = new FormData();
  formData.append('file', audioBlob, fileName);
  if (language && language !== 'auto') {
    formData.append('language', language);
  }

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Transcription request failed' }));
    throw new Error(err.error || `Voice transcription failed (${res.status})`);
  }

  return res.json();
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error('Failed to fetch models');
  const data = await res.json();
  return data.models || [];
}

export async function fetchSettings(): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  const data = await res.json();
  return data.settings;
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  const data = await res.json();
  return data.settings;
}

export async function testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const res = await fetch(`${API_BASE}/settings/test-connection`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Connection test failed');
  return res.json();
}

export async function abortActiveChat(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/chat/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  }).catch(() => {});
}

export function streamChat(params: {
  conversationId?: string;
  message: string;
  model?: string;
  attachments?: Attachment[];
  enableSearch?: boolean;
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
      const response = await fetch(`${API_BASE}/chat`, {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const data = JSON.parse(dataStr);
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
                params.onDone(data);
              } else if (currentEvent === 'error') {
                params.onError(data.error || 'Chat stream failed');
              }
            } catch {
              // Ignore partial chunk
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        // User cancelled, not an error
      } else {
        params.onError(err.message || 'Network stream disconnected');
      }
    }
  })();

  return controller;
}
