import { Conversation, Message, UserSettings } from '../../types/index.js';

export interface StorageInterface {
  init(): Promise<void>;
  getConversations(query?: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(conversation: Conversation): Promise<Conversation>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
  clearAllConversations(): Promise<void>;

  getMessages(conversationId: string): Promise<Message[]>;
  getMessage(id: string): Promise<Message | null>;
  addMessage(message: Message): Promise<Message>;
  updateMessage(id: string, updates: Partial<Message>): Promise<Message | null>;
  deleteMessage(id: string): Promise<boolean>;

  getSettings(): Promise<UserSettings>;
  saveSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
}
