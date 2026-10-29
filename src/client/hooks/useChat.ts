import { useState, useEffect, useRef, useCallback } from 'react';
import { Conversation, Message, Attachment } from '../../types/index.js';
import * as api from '../services/api.js';

export function useChat(
  activeConversationId: string | null,
  activeModel: string,
  onConversationCreated?: (conv: Conversation) => void,
  onTitleUpdated?: (id: string, title: string) => void
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingHistory(true);
    setError(null);

    api.fetchConversation(activeConversationId)
      .then(conv => {
        if (isMounted) {
          setMessages(conv.messages || []);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err.message || 'Failed to load conversation history');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      });

    return () => {
      isMounted = false;
      // Abort active stream if user switches chat
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [activeConversationId]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeConversationId) {
      api.abortActiveChat(activeConversationId);
    }
    setIsStreaming(false);

    // Mark current assistant message as interrupted
    if (currentAssistantIdRef.current) {
      setMessages(prev =>
        prev.map(m =>
          m.id === currentAssistantIdRef.current
            ? { ...m, status: 'interrupted' }
            : m
        )
      );
    }
  }, [activeConversationId]);

  const [isSearching, setIsSearching] = useState(false);

  const sendMessage = useCallback(
    async (content: string, overrideAttachments?: Attachment[], enableSearch?: boolean) => {
      if (!content.trim() && (!overrideAttachments || overrideAttachments.length === 0)) {
        return;
      }

      setError(null);
      setIsSearching(false);
      const activeAttachments = overrideAttachments || attachments;
      setAttachments([]); // Clear composer attachments

      // Generate optimistic IDs
      const tempUserMsgId = `user-${Date.now()}`;
      const tempAssistantMsgId = `asst-${Date.now()}`;
      currentAssistantIdRef.current = tempAssistantMsgId;

      const optimisticUserMsg: Message = {
        id: tempUserMsgId,
        conversationId: activeConversationId || '',
        role: 'user',
        content,
        status: 'completed',
        createdAt: Date.now(),
        attachments: activeAttachments.length > 0 ? activeAttachments : undefined,
      };

      const optimisticAssistantMsg: Message = {
        id: tempAssistantMsgId,
        conversationId: activeConversationId || '',
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: Date.now(),
      };

      setMessages(prev => [...prev, optimisticUserMsg, optimisticAssistantMsg]);
      setIsStreaming(true);

      const controller = api.streamChat({
        conversationId: activeConversationId || undefined,
        message: content,
        model: activeModel,
        attachments: activeAttachments,
        enableSearch,
        onSearchStart: (searchQuery) => {
          setIsSearching(true);
          setMessages(prev =>
            prev.map(m =>
              m.id === tempAssistantMsgId
                ? { ...m, searchQuery }
                : m
            )
          );
        },
        onSearchDone: (searchSources) => {
          setIsSearching(false);
          setMessages(prev =>
            prev.map(m =>
              m.id === tempAssistantMsgId
                ? { ...m, searchSources }
                : m
            )
          );
        },
        onThoughtToken: (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === tempAssistantMsgId
                ? { ...m, thought: (m.thought || '') + token }
                : m
            )
          );
        },
        onToken: (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === tempAssistantMsgId
                ? { ...m, content: m.content + token }
                : m
            )
          );
        },
        onTitle: (generatedTitle: string, titleConvId: string) => {
          // Use the conversationId from the event (works for both new & existing convs)
          const effectiveId = titleConvId || activeConversationId || '';
          if (effectiveId && onTitleUpdated) {
            onTitleUpdated(effectiveId, generatedTitle);
          }
        },
        onDone: (data) => {
          setIsStreaming(false);
          setIsSearching(false);
          abortControllerRef.current = null;

          // If this was a new conversation, notify parent
          if (!activeConversationId && onConversationCreated) {
            onConversationCreated(data.conversation);
          }

          // Replace optimistic messages with saved messages
          setMessages(prev => {
            const filtered = prev.filter(
              m => m.id !== tempUserMsgId && m.id !== tempAssistantMsgId
            );
            return [
              ...filtered,
              { ...optimisticUserMsg, conversationId: data.conversation.id },
              data.assistantMessage,
            ];
          });
        },
        onError: (streamError) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          setError(streamError);
          setMessages(prev =>
            prev.map(m =>
              m.id === tempAssistantMsgId
                ? { ...m, status: 'failed', errorMessage: streamError }
                : m
            )
          );
        },
      });

      abortControllerRef.current = controller;
    },
    [activeConversationId, activeModel, attachments, onConversationCreated, onTitleUpdated]
  );

  const regenerateResponse = useCallback(
    async (assistantMessageId: string) => {
      const idx = messages.findIndex(m => m.id === assistantMessageId);
      if (idx <= 0) return;

      const previousUserMsg = messages[idx - 1];
      if (previousUserMsg.role !== 'user') return;

      // Remove the assistant message and resend
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId));
      await sendMessage(previousUserMsg.content, previousUserMsg.attachments);
    },
    [messages, sendMessage]
  );

  const editAndResubmit = useCallback(
    async (userMessageId: string, newContent: string) => {
      const idx = messages.findIndex(m => m.id === userMessageId);
      if (idx < 0) return;

      const userMsg = messages[idx];
      // Truncate all subsequent messages after this user message
      setMessages(prev => prev.slice(0, idx));
      await sendMessage(newContent, userMsg.attachments);
    },
    [messages, sendMessage]
  );

  const addAttachment = (att: Attachment) => {
    setAttachments(prev => [...prev, att]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  return {
    messages,
    isLoadingHistory,
    isStreaming,
    isSearching,
    attachments,
    error,
    sendMessage,
    stopGeneration,
    regenerateResponse,
    editAndResubmit,
    addAttachment,
    removeAttachment,
    clearError: () => setError(null),
  };
}
