import { useState, useEffect, useCallback, useMemo } from 'react';
import { Conversation } from '../../types/index.js';
import * as api from '../services/api.js';

export interface GroupedConversations {
  [groupTitle: string]: Conversation[];
}

export function useConversations(activeId: string | null, onSelect: (id: string | null) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async (query?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await api.fetchConversations(query);
      setConversations(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load conversations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations(searchQuery);
  }, [loadConversations, searchQuery]);

  const togglePin = async (id: string, currentPinned: boolean) => {
    try {
      const updated = await api.updateConversation(id, { pinned: !currentPinned });
      setConversations(prev =>
        prev.map(c => (c.id === id ? { ...c, pinned: updated.pinned } : c))
      );
    } catch (err: any) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const renameConversation = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      const updated = await api.updateConversation(id, { title: newTitle.trim() });
      setConversations(prev =>
        prev.map(c => (c.id === id ? { ...c, title: updated.title } : c))
      );
    } catch (err: any) {
      console.error('Failed to rename conversation:', err);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) {
        onSelect(null);
      }
    } catch (err: any) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const clearAll = async () => {
    try {
      await api.clearAllConversations();
      setConversations([]);
      onSelect(null);
    } catch (err: any) {
      console.error('Failed to clear conversations:', err);
    }
  };

  const updateLocalTitle = (id: string, title: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, title } : c))
    );
  };

  const addOrUpdateConversation = (conv: Conversation) => {
    setConversations(prev => {
      const exists = prev.some(c => c.id === conv.id);
      if (exists) {
        return prev.map(c => (c.id === conv.id ? conv : c));
      }
      return [conv, ...prev];
    });
  };

  // Group conversations by date and pin status
  const groupedConversations = useMemo<GroupedConversations>(() => {
    const groups: GroupedConversations = {};

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 6 * 86400000;
    const startOf30Days = startOfToday - 29 * 86400000;

    // Filter pinned
    const pinned = conversations.filter(c => c.pinned);
    if (pinned.length > 0) {
      groups['Pinned'] = pinned;
    }

    const unpinned = conversations.filter(c => !c.pinned);

    for (const conv of unpinned) {
      const time = conv.updatedAt || conv.createdAt;
      let groupName = 'Older';

      if (time >= startOfToday) {
        groupName = 'Recent';
      } else if (time >= startOfYesterday) {
        groupName = 'Yesterday';
      } else if (time >= startOf7Days) {
        groupName = 'Previous 7 Days';
      } else if (time >= startOf30Days) {
        groupName = 'Previous 30 Days';
      }

      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(conv);
    }

    return groups;
  }, [conversations]);

  return {
    conversations,
    groupedConversations,
    searchQuery,
    setSearchQuery,
    isLoading,
    error,
    refresh: loadConversations,
    togglePin,
    renameConversation,
    deleteConversation,
    clearAll,
    updateLocalTitle,
    addOrUpdateConversation,
  };
}
