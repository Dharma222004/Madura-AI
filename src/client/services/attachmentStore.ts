/**
 * Session & History Attachment Store
 *
 * - Keeps full parsed file text & compressed images in memory (and IndexedDB when available)
 *   for follow-up questions within the same conversation session.
 * - Persists only lightweight metadata and small thumbnails (never huge base64 payloads)
 *   in localStorage so page refreshes preserve attachment chips and thumbnails in chat history
 *   without exceeding browser storage quotas.
 */

import { Attachment } from '../../types/index.js';

const HISTORY_PREVIEW_STORAGE_KEY = 'madura_attachment_previews';
const MAX_STORED_PREVIEWS = 60;

interface StoredAttachmentPreview {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind?: 'image' | 'text';
  thumbnailUrl?: string;
  updatedAt: number;
}

// In-memory session cache keyed by conversationId (and a global attachment ID map)
const sessionConversationAttachments = new Map<string, Attachment[]>();
const sessionAttachmentById = new Map<string, Attachment>();

/**
 * Registers processed attachments in the active session cache and saves lightweight
 * display metadata/thumbnails to localStorage for page refresh persistence.
 */
export function cacheAttachmentsForSession(
  attachments: Attachment[],
  conversationId?: string | null
): void {
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  for (const att of attachments) {
    if (att && att.id) {
      sessionAttachmentById.set(att.id, att);
    }
  }

  if (conversationId) {
    const existing = sessionConversationAttachments.get(conversationId) || [];
    const mergedMap = new Map<string, Attachment>();
    for (const item of existing) mergedMap.set(item.id, item);
    for (const item of attachments) mergedMap.set(item.id, item);
    sessionConversationAttachments.set(conversationId, Array.from(mergedMap.values()));
  }

  saveLightweightPreviewsToLocalStorage(attachments);
}

/**
 * Retrieves cached session attachments for a conversation so follow-up questions
 * in the same chat retain full parsed text and compressed images.
 */
export function getSessionAttachmentsForConversation(
  conversationId?: string | null
): Attachment[] {
  if (!conversationId) return [];
  return sessionConversationAttachments.get(conversationId) || [];
}

/**
 * Hydrates attachments loaded from conversation history with any cached thumbnail
 * or session data so refreshed chat history renders cleanly.
 */
export function hydrateMessageAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments || attachments.length === 0) return attachments;
  const storedPreviews = loadLightweightPreviewsFromLocalStorage();
  const previewMap = new Map<string, StoredAttachmentPreview>();
  for (const p of storedPreviews) {
    previewMap.set(p.id, p);
  }

  return attachments.map((att) => {
    const sessionAtt = sessionAttachmentById.get(att.id);
    if (sessionAtt) {
      return {
        ...att,
        previewUrl: att.previewUrl || sessionAtt.thumbnailUrl || sessionAtt.previewUrl,
        thumbnailUrl: att.thumbnailUrl || sessionAtt.thumbnailUrl,
        kind: att.kind || sessionAtt.kind,
      };
    }
    const stored = previewMap.get(att.id);
    if (stored) {
      return {
        ...att,
        previewUrl: att.previewUrl || stored.thumbnailUrl,
        thumbnailUrl: att.thumbnailUrl || stored.thumbnailUrl,
        kind: att.kind || stored.kind,
      };
    }
    return att;
  });
}

function loadLightweightPreviewsFromLocalStorage(): StoredAttachmentPreview[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(HISTORY_PREVIEW_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLightweightPreviewsToLocalStorage(attachments: Attachment[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const current = loadLightweightPreviewsFromLocalStorage();
    const map = new Map<string, StoredAttachmentPreview>();
    for (const item of current) {
      if (item && item.id) map.set(item.id, item);
    }

    const now = Date.now();
    for (const att of attachments) {
      if (!att || !att.id) continue;
      // Only store small thumbnail (< 45 KB), never large base64 strings
      const thumb =
        att.thumbnailUrl && att.thumbnailUrl.length < 45000
          ? att.thumbnailUrl
          : att.previewUrl && att.previewUrl.length < 45000
          ? att.previewUrl
          : undefined;
      map.set(att.id, {
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        kind: att.kind,
        thumbnailUrl: thumb,
        updatedAt: now,
      });
    }

    let list = Array.from(map.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    if (list.length > MAX_STORED_PREVIEWS) {
      list = list.slice(list.length - MAX_STORED_PREVIEWS);
    }

    try {
      localStorage.setItem(HISTORY_PREVIEW_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // QuotaExceededError fallback: strip thumbnails and keep only minimal metadata
      const minimal = list.slice(-25).map((item) => ({
        ...item,
        thumbnailUrl: undefined,
      }));
      try {
        localStorage.setItem(HISTORY_PREVIEW_STORAGE_KEY, JSON.stringify(minimal));
      } catch {
        // Ignore if storage is completely full
      }
    }
  } catch {
    // Ignore storage errors
  }
}
