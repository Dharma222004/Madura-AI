import fs from 'fs';
import path from 'path';
import { StorageInterface } from './storage.interface.js';
import { Conversation, Message, UserSettings } from '../../types/index.js';

interface DatabaseSchema {
  version: number;
  conversations: Record<string, Conversation>;
  messages: Record<string, Message>;
  settings: UserSettings;
}

const DEFAULT_SETTINGS: UserSettings = {
  userName: 'Madura User',
  theme: 'system',
  model: 'auto',
  temperature: 0.7,
  maxTokens: 8192,
  systemPrompt: 'You are Madura AI, an advanced large language model and intelligent conversational assistant. When asked who you are, what model you are, or who developed you, clearly identify yourself solely as Madura AI. Never mention NVIDIA, NVIDIA NIM, OpenAI, Groq, or any third-party APIs or infrastructure. Provide thorough, well-structured responses with markdown formatting. For complex topics, give detailed explanations with sections, examples, and code where appropriate. For simple questions, be direct and concise. Never fabricate facts.',
  enterToSend: true,
  useMockFallback: true,
};

export class FileStore implements StorageInterface {
  private filePath: string;
  private dataDir: string;
  private state: DatabaseSchema;
  private isLoaded: boolean = false;

  constructor(dataDir: string = './data') {
    this.dataDir = path.resolve(process.cwd(), dataDir);
    this.filePath = path.join(this.dataDir, 'madura.json');
    this.state = {
      version: 1,
      conversations: {},
      messages: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  async init(): Promise<void> {
    if (this.isLoaded) return;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.state = {
          version: parsed.version || 1,
          conversations: parsed.conversations || {},
          messages: parsed.messages || {},
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        };

        // Upgrade legacy default prompt containing NVIDIA or NIM references
        if (
          !this.state.settings.systemPrompt ||
          this.state.settings.systemPrompt.includes('NVIDIA') ||
          this.state.settings.systemPrompt.includes('NIM') ||
          this.state.settings.systemPrompt.startsWith('You are Madura AI, a state-of-the-art intelligent conversational assistant.')
        ) {
          this.state.settings.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
        }

        // Normalize legacy models and clean up old notice banners from stored data
        if (!this.state.settings.model || this.state.settings.model.includes('/') || this.state.settings.model.includes('nemotron')) {
          this.state.settings.model = 'madura-4.0';
        }
        for (const c of Object.values(this.state.conversations)) {
          if (c.model && (c.model.includes('/') || c.model.includes('nemotron'))) {
            c.model = 'madura-4.0';
          }
        }
        for (const m of Object.values(this.state.messages)) {
          if (m.content) {
            m.content = m.content
              .replace(/> \*\*Notice\*\*: The configured NVIDIA API key returned[^\n]+\n\n/g, '')
              .replace(/powered by NVIDIA NIM infrastructure\.?/gi, '')
              .replace(/powered by NVIDIA NIM\.?/gi, '')
              .replace(/NVIDIA NIM infrastructure\.?/gi, '')
              .replace(/NVIDIA NIM\.?/gi, '')
              .replace(/NVIDIA's advanced conversational assistant/gi, 'Madura AI')
              .replace(/\bNVIDIA\b/gi, 'Madura AI')
              .trim();
          }
          if (m.thought) {
            m.thought = m.thought
              .replace(/powered by NVIDIA NIM infrastructure\.?/gi, '')
              .replace(/powered by NVIDIA NIM\.?/gi, '')
              .replace(/NVIDIA NIM infrastructure/gi, 'Madura AI architecture')
              .replace(/NVIDIA NIM/gi, 'Madura AI')
              .replace(/\bNVIDIA\b/gi, 'Madura AI');
          }
        }
        this.persistSync();
      } catch (err) {
        console.error('[FileStore] Failed to read existing db file, initializing fresh store:', err);
        this.persistSync();
      }
    } else {
      this.persistSync();
    }

    this.isLoaded = true;
  }

  private persistSync(): void {
    try {
      const tempPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch {
        // Windows fallback if destination is momentarily locked by indexer / OneDrive
        fs.copyFileSync(tempPath, this.filePath);
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore temp cleanup error
        }
      }
    } catch (err) {
      console.error('[FileStore] Failed to persist database to disk:', err);
    }
  }

  async getConversations(query?: string): Promise<Conversation[]> {
    await this.init();
    let convs = Object.values(this.state.conversations);

    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      convs = convs.filter(c => {
        if (c.title.toLowerCase().includes(q)) return true;
        // Search conversation messages too
        const messages = Object.values(this.state.messages).filter(m => m.conversationId === c.id);
        return messages.some(m => m.content.toLowerCase().includes(q));
      });
    }

    // Sort: pinned first, then by updatedAt descending
    return convs.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.init();
    const conv = this.state.conversations[id];
    if (!conv) return null;

    const messages = await this.getMessages(id);
    return {
      ...conv,
      messages,
    };
  }

  async createConversation(conversation: Conversation): Promise<Conversation> {
    await this.init();
    this.state.conversations[conversation.id] = { ...conversation };
    this.persistSync();
    return conversation;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    await this.init();
    const existing = this.state.conversations[id];
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    this.state.conversations[id] = updated;
    this.persistSync();
    return updated;
  }

  async deleteConversation(id: string): Promise<boolean> {
    await this.init();
    if (!this.state.conversations[id]) return false;

    delete this.state.conversations[id];

    // Remove all associated messages
    for (const msgId of Object.keys(this.state.messages)) {
      if (this.state.messages[msgId].conversationId === id) {
        delete this.state.messages[msgId];
      }
    }

    this.persistSync();
    return true;
  }

  async clearAllConversations(): Promise<void> {
    await this.init();
    this.state.conversations = {};
    this.state.messages = {};
    this.persistSync();
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    await this.init();
    return Object.values(this.state.messages)
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getMessage(id: string): Promise<Message | null> {
    await this.init();
    return this.state.messages[id] || null;
  }

  async addMessage(message: Message): Promise<Message> {
    await this.init();
    this.state.messages[message.id] = { ...message };

    // Update conversation's updatedAt
    if (this.state.conversations[message.conversationId]) {
      this.state.conversations[message.conversationId].updatedAt = Date.now();
    }

    this.persistSync();
    return message;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | null> {
    await this.init();
    const existing = this.state.messages[id];
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
    };
    this.state.messages[id] = updated;

    if (this.state.conversations[existing.conversationId]) {
      this.state.conversations[existing.conversationId].updatedAt = Date.now();
    }

    this.persistSync();
    return updated;
  }

  async deleteMessage(id: string): Promise<boolean> {
    await this.init();
    if (!this.state.messages[id]) return false;
    delete this.state.messages[id];
    this.persistSync();
    return true;
  }

  async getSettings(): Promise<UserSettings> {
    await this.init();
    return { ...this.state.settings };
  }

  async saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    await this.init();
    this.state.settings = {
      ...this.state.settings,
      ...settings,
    };
    this.persistSync();
    return { ...this.state.settings };
  }
}
