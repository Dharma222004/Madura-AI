/**
 * Cross-Chat User Memory Module (localStorage-backed)
 *
 * Stores personal details shared by the user across conversations in localStorage
 * under "madura_user_memory" (JSON array) and "madura_memory_enabled" (boolean).
 */

export type MemoryCategory = 'identity' | 'preference' | 'project' | 'other';

export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  text: string;
  category: MemoryCategory;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

export interface ExtractedFact {
  key: string;
  value: string;
  text: string;
  category: MemoryCategory;
}

export const MEMORY_STORAGE_KEY = 'madura_user_memory';
export const MEMORY_ENABLED_KEY = 'madura_memory_enabled';
export const MAX_MEMORY_ITEMS = 100;
export const MAX_RELEVANT_ITEMS = 10;

// Fallback in-memory store for non-browser test environments when localStorage is unavailable
const fallbackStore: Record<string, string> = {};

function getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Access denied or unavailable
  }
  return {
    getItem: (k: string) => (k in fallbackStore ? fallbackStore[k] : null),
    setItem: (k: string, v: string) => {
      fallbackStore[k] = String(v);
    },
    removeItem: (k: string) => {
      delete fallbackStore[k];
    },
  };
}

/**
 * Notify same-tab listeners when memory state changes
 */
function emitMemoryChange(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('madura-memory-changed'));
    }
  } catch {
    // Ignore in headless/non-DOM environments
  }
}

/**
 * Checks whether cross-chat memory is enabled (defaults to true)
 */
export function isMemoryEnabled(): boolean {
  try {
    const raw = getStorage().getItem(MEMORY_ENABLED_KEY);
    if (raw === null) return true;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : raw !== 'false';
  } catch {
    return true;
  }
}

/**
 * Enables or disables cross-chat memory in localStorage
 */
export function setMemoryEnabled(enabled: boolean): void {
  try {
    getStorage().setItem(MEMORY_ENABLED_KEY, JSON.stringify(Boolean(enabled)));
    emitMemoryChange();
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Loads saved memory items from localStorage.
 * Resets corrupted JSON to [] safely.
 */
export function loadMemory(): MemoryItem[] {
  try {
    const raw = getStorage().getItem(MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      getStorage().setItem(MEMORY_STORAGE_KEY, JSON.stringify([]));
      return [];
    }
    return parsed.filter(
      (item): item is MemoryItem =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.key === 'string' &&
            typeof item.value === 'string' &&
            typeof item.text === 'string'
        )
    );
  } catch {
    try {
      getStorage().setItem(MEMORY_STORAGE_KEY, JSON.stringify([]));
    } catch {
      // Ignore write error
    }
    return [];
  }
}

/**
 * Saves memory items to localStorage, enforcing the ~100 item cap
 * by evicting the oldest least-used items first.
 */
export function saveMemory(items: MemoryItem[]): void {
  try {
    let list = Array.isArray(items) ? [...items] : [];
    if (list.length > MAX_MEMORY_ITEMS) {
      // Sort by lastUsedAt (fallback updatedAt, createdAt) ascending so oldest least-used are first
      list.sort((a, b) => {
        const aTime = a.lastUsedAt || a.updatedAt || a.createdAt || 0;
        const bTime = b.lastUsedAt || b.updatedAt || b.createdAt || 0;
        return aTime - bTime;
      });
      list = list.slice(list.length - MAX_MEMORY_ITEMS);
    }
    getStorage().setItem(MEMORY_STORAGE_KEY, JSON.stringify(list));
    emitMemoryChange();
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Detects passwords, API keys, credit card numbers, OTPs, SSNs, or secrets
 * that must never be stored in memory.
 */
export function containsSensitiveData(text: string): boolean {
  if (!text) return false;

  // Sensitive keywords (passwords, PINs, OTPs, CVVs, secret keys, seed phrases)
  if (
    /\b(password|passwd|pwd|passcode|pin\s*(?:code|number|is)|cvv|cvc|otp|one[- ]time\s*(?:password|code)|secret\s*key|private\s*key|recovery\s*phrase|seed\s*phrase|social\s*security\s*number|ssn)\b/i.test(
      text
    )
  ) {
    return true;
  }

  // Common API key / token prefixes & patterns
  if (
    /\b(sk-[a-zA-Z0-9_-]{12,}|nvapi-[a-zA-Z0-9_-]{12,}|gsk_[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|api[_ -]?key\s*(?:is|:|=)\s*\S+|bearer\s+[a-zA-Z0-9._-]{16,})\b/i.test(
      text
    )
  ) {
    return true;
  }

  // Credit/debit card numbers (13 to 19 digits, optionally separated by spaces or dashes)
  if (/\b(?:\d[ -]*?){13,19}\b/.test(text)) {
    return true;
  }

  // SSN format (XXX-XX-XXXX)
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Sanitizes memory text to prevent prompt injection before storing or inserting into prompts.
 * Strips newlines and instruction-like text.
 */
export function sanitizeMemoryText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|directions?|directives?)\b/gi,
      ''
    )
    .replace(/\b(?:system\s*prompt|new\s*instructions?|developer\s*mode|jailbreak)\s*:/gi, '')
    .replace(/\byou\s+are\s+now\s+(?:a|an)\b/gi, '')
    .replace(/\[(?:system|assistant|user)[^\]]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeSlotKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function cleanValue(raw: string): string {
  return sanitizeMemoryText(raw)
    .replace(/\s+(?:now|today|currently|right now|these days|anymore)$/i, '')
    .replace(/^[,"'\s]+|[,"'.!?;:\s]+$/g, '')
    .trim();
}

const NON_NAME_WORDS = new Set([
  'a', 'an', 'the', 'from', 'in', 'at', 'on', 'to', 'for', 'with', 'by', 'of',
  'living', 'moving', 'working', 'building', 'developing', 'creating', 'making',
  'using', 'learning', 'studying', 'looking', 'trying', 'going', 'doing', 'feeling',
  'asking', 'wondering', 'having', 'getting', 'writing', 'testing', 'running',
  'reading', 'planning', 'thinking', 'hoping', 'waiting', 'calling', 'texting',
  'here', 'there', 'ready', 'happy', 'sad', 'tired', 'good', 'great', 'fine',
  'well', 'okay', 'ok', 'sure', 'sorry', 'not', 'very', 'so', 'just', 'currently',
  'also', 'still', 'born', 'interested', 'passionate', 'excited', 'confused',
  'stuck', 'new', 'old', 'back', 'done', 'finished', 'afraid', 'worried', 'glad',
  'able', 'unable', 'available', 'busy', 'free', 'hungry', 'thirsty', 'sick',
  'married', 'single', 'vegan', 'vegetarian', 'allergic', 'located', 'based',
  'employed', 'self-employed', 'retired', 'graduated', 'speaking', 'fluent',
]);

/**
 * Extracts personal facts stated by the user in a message using regex/rule patterns.
 */
export function extractMemory(
  userMessage: string,
  _options?: { useLLM?: boolean }
): ExtractedFact[] {
  if (!userMessage || typeof userMessage !== 'string') return [];
  const trimmed = userMessage.trim();
  if (!trimmed || containsSensitiveData(trimmed)) return [];

  // Skip forget commands
  if (/^\s*(?:please\s+)?(?:forget|clear\s+(?:all\s+)?memor)/i.test(trimmed)) {
    return [];
  }

  const facts: ExtractedFact[] = [];
  const seenKeys = new Set<string>();

  const addFact = (fact: ExtractedFact) => {
    const sanitizedValue = cleanValue(fact.value);
    const sanitizedText = sanitizeMemoryText(fact.text);
    if (!sanitizedValue || !sanitizedText || containsSensitiveData(sanitizedValue)) return;
    seenKeys.add(fact.key);
    const existingIdx = facts.findIndex((f) => f.key === fact.key);
    const entry: ExtractedFact = {
      key: fact.key,
      value: sanitizedValue,
      text: sanitizedText,
      category: fact.category,
    };
    if (existingIdx >= 0) {
      facts[existingIdx] = entry;
    } else {
      facts.push(entry);
    }
  };

  // Split message into clauses for multi-fact statements
  const clauses = trimmed
    .split(/(?:[.!?;]+|\n+|,\s+and\s+|\s+and\s+(?=i\b|my\b|call\s+me\b))/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (let clause of clauses) {
    // Check if the clause starts with "remember that ..."
    let isExplicitRemember = false;
    const rememberMatch = /^(?:please\s+)?remember\s+(?:that\s+|this\s*:?\s*)(.+)$/i.exec(clause);
    if (rememberMatch) {
      isExplicitRemember = true;
      clause = rememberMatch[1].trim();
    }

    let matchedSpecificRule = false;

    // 1. Explicit Name patterns: "my name is X", "call me X", "you can call me X"
    const explicitNameMatch =
      /\b(?:my\s+name\s+is|call\s+me|you\s+can\s+call\s+me|i\s+go\s+by)\s+([A-Za-z][A-Za-z0-9\s.'-]{0,40})$/i.exec(
        clause
      );
    if (explicitNameMatch) {
      const nameVal = cleanValue(explicitNameMatch[1]);
      if (nameVal && nameVal.split(/\s+/).length <= 5) {
        addFact({
          key: 'name',
          value: nameVal,
          text: `User's name is ${nameVal}`,
          category: 'identity',
        });
        matchedSpecificRule = true;
      }
    }

    // 2. Location patterns: "I live in X", "I moved to X", "Actually I moved to X", "I'm from X", "I am based in X"
    const locationMatch =
      /\b(?:(?:actually|now|recently)\s*,?\s*)?(?:i\s+(?:currently\s+)?live\s+in|i'm\s+living\s+in|i\s+am\s+living\s+in|i\s+(?:just\s+|recently\s+)?moved\s+to|i\s+relocated\s+to|i'm\s+based\s+in|i\s+am\s+based\s+in|i'm\s+located\s+in|i\s+am\s+located\s+in|i'm\s+from|i\s+am\s+from|my\s+(?:current\s+)?(?:location|city|hometown|home\s+city)\s+is)\s+([A-Za-z][A-Za-z0-9\s,.'-]{1,50})$/i.exec(
        clause
      );
    if (locationMatch) {
      const locVal = cleanValue(locationMatch[1]);
      if (locVal) {
        addFact({
          key: 'location',
          value: locVal,
          text: `User lives in ${locVal}`,
          category: 'identity',
        });
        matchedSpecificRule = true;
      }
    }

    // 3. Project patterns: "I am developing X", "I'm building X", "I am working on X", "my project is X"
    const projectMatch =
      /\b(?:i\s+am\s+(?:currently\s+)?(?:working\s+on|building|developing|creating)|i'm\s+(?:currently\s+)?(?:working\s+on|building|developing|creating)|my\s+(?:current\s+)?project\s+is)\s+([A-Za-z0-9][A-Za-z0-9\s_"'.,-]{1,80})$/i.exec(
        clause
      );
    if (projectMatch) {
      const projVal = cleanValue(projectMatch[1]);
      if (projVal) {
        addFact({
          key: 'project',
          value: projVal,
          text: `User is working on ${projVal}`,
          category: 'project',
        });
        matchedSpecificRule = true;
      }
    }

    // 4. Job / Role patterns: "I work as X", "I'm a software engineer", "I am a X", "my job is X"
    const jobMatch =
      /\b(?:i\s+work\s+as\s+(?:a\s+|an\s+)?|i\s+am\s+working\s+as\s+(?:a\s+|an\s+)?|i'm\s+working\s+as\s+(?:a\s+|an\s+)?|my\s+(?:job|profession|occupation|role|career)\s+is\s+(?:a\s+|an\s+)?|(?:i\s+am|i'm)\s+(?:a|an)\s+)([A-Za-z][A-Za-z0-9\s/&.'-]{1,45})$/i.exec(
        clause
      );
    if (jobMatch && !matchedSpecificRule) {
      const jobVal = cleanValue(jobMatch[1]);
      const firstWord = jobVal.split(/\s+/)[0]?.toLowerCase() || '';
      if (
        jobVal &&
        !NON_NAME_WORDS.has(firstWord) &&
        !/^(fan|bit|little|lot|huge|big|member|person|human|user|beginner|newbie)\b/i.test(jobVal)
      ) {
        addFact({
          key: 'job',
          value: jobVal,
          text: `User works as ${jobVal}`,
          category: 'identity',
        });
        matchedSpecificRule = true;
      }
    }

    // 5. Workplace / School patterns: "I work at X", "I study at X"
    const workplaceMatch =
      /\b(?:i\s+work\s+(?:at|for)|i'm\s+employed\s+(?:at|by)|i\s+study\s+at|my\s+company\s+is)\s+([A-Za-z0-9][A-Za-z0-9\s&.'-]{1,50})$/i.exec(
        clause
      );
    if (workplaceMatch) {
      const workVal = cleanValue(workplaceMatch[1]);
      if (workVal) {
        addFact({
          key: 'workplace',
          value: workVal,
          text: `User works/studies at ${workVal}`,
          category: 'identity',
        });
        matchedSpecificRule = true;
      }
    }

    // 6. Age pattern: "I am 25 years old" or "my age is 25"
    const ageMatch =
      /\b(?:(?:i\s+am|i'm)\s+(\d{1,3})\s+years?\s+old|my\s+age\s+is\s+(\d{1,3}))\b/i.exec(clause);
    if (ageMatch) {
      const ageVal = ageMatch[1] || ageMatch[2];
      if (ageVal) {
        addFact({
          key: 'age',
          value: ageVal,
          text: `User is ${ageVal} years old`,
          category: 'identity',
        });
        matchedSpecificRule = true;
      }
    }

    // 7. Favorite pattern: "my favorite X is Y"
    const favMatch =
      /\bmy\s+favou?rite\s+([A-Za-z][A-Za-z0-9\s_-]{1,30}?)\s+(?:is|are)\s+([^.,!?;]{1,60})$/i.exec(
        clause
      );
    if (favMatch) {
      const rawTopic = cleanValue(favMatch[1]).toLowerCase();
      const favVal = cleanValue(favMatch[2]);
      if (rawTopic && favVal) {
        const slot =
          rawTopic === 'programming language' || rawTopic === 'coding language'
            ? 'favorite_language'
            : `favorite_${normalizeSlotKey(rawTopic)}`;
        addFact({
          key: slot,
          value: favVal,
          text: `User's favorite ${rawTopic} is ${favVal}`,
          category: 'preference',
        });
        matchedSpecificRule = true;
      }
    }

    // 8. Preference pattern: "I like/love/prefer X"
    const prefMatch =
      /\bi\s+(?:really\s+|always\s+)?(like|love|prefer|enjoy)\s+([A-Za-z0-9][A-Za-z0-9\s+#._/-]{1,60})$/i.exec(
        clause
      );
    if (prefMatch && !matchedSpecificRule) {
      const verb = prefMatch[1].toLowerCase();
      const prefVal = cleanValue(prefMatch[2]);
      if (
        prefVal &&
        !/^(it|that|this|them|you|to\s+know|to\s+ask|how\b|when\b|what\b)/i.test(prefVal)
      ) {
        const keyBase = normalizeSlotKey(prefVal.split(/\s+(?:over|instead\s+of|more\s+than)\s+/i)[0]);
        const key = verb === 'prefer' ? `preference_${keyBase}` : `likes_${keyBase}`;
        const readableVerb = verb === 'prefer' ? 'prefers' : `${verb}s`;
        addFact({
          key,
          value: prefVal,
          text: `User ${readableVerb} ${prefVal}`,
          category: 'preference',
        });
        matchedSpecificRule = true;
      }
    }

    // 9. Implicit Name pattern: "I am Dharmadurai" / "I'm Dharmadurai"
    if (!matchedSpecificRule && !seenKeys.has('name')) {
      const implicitNameMatch =
        /^(?:hi\s*,?\s*|hello\s*,?\s*|hey\s*,?\s*|actually\s*,?\s*)?(?:i\s+am|i'm|im)\s+([A-Za-z][A-Za-z\s.'-]{1,35})$/i.exec(
          clause
        );
      if (implicitNameMatch) {
        const candidate = cleanValue(implicitNameMatch[1]);
        const words = candidate.split(/\s+/).filter(Boolean);
        const firstLower = (words[0] || '').toLowerCase();
        const allValidWords =
          words.length >= 1 &&
          words.length <= 3 &&
          !NON_NAME_WORDS.has(firstLower) &&
          words.every((w) => !NON_NAME_WORDS.has(w.toLowerCase()));
        if (allValidWords) {
          addFact({
            key: 'name',
            value: candidate,
            text: `User's name is ${candidate}`,
            category: 'identity',
          });
          matchedSpecificRule = true;
        }
      }
    }

    // 10. Explicit "remember that ..." fallback if it didn't match a specific slot above
    if (isExplicitRemember && !matchedSpecificRule) {
      const cleanNote = cleanValue(clause);
      if (cleanNote && cleanNote.length >= 3) {
        const noteKey = `note_${normalizeSlotKey(cleanNote.slice(0, 32))}`;
        const formattedNote = /^user\b/i.test(cleanNote)
          ? cleanNote
          : `User noted: ${cleanNote}`;
        addFact({
          key: noteKey,
          value: cleanNote,
          text: formattedNote,
          category: 'other',
        });
      }
    }
  }

  return facts;
}

/**
 * Inserts a new memory fact or updates an existing item with the same key in place.
 */
export function upsertMemory(
  fact: ExtractedFact
): { item: MemoryItem; created: boolean; updated: boolean } | null {
  if (!fact || !fact.key || !fact.value) return null;
  if (containsSensitiveData(fact.value) || containsSensitiveData(fact.text)) {
    return null;
  }

  const sanitizedValue = cleanValue(fact.value);
  const sanitizedText = sanitizeMemoryText(fact.text);
  if (!sanitizedValue || !sanitizedText) return null;

  const normalizedKey = normalizeSlotKey(fact.key);
  const items = loadMemory();
  const now = Date.now();

  const existingIdx = items.findIndex((item) => item.key === normalizedKey);
  if (existingIdx >= 0) {
    const existing = items[existingIdx];
    const valueChanged =
      existing.value !== sanitizedValue || existing.text !== sanitizedText;
    const updatedItem: MemoryItem = {
      ...existing,
      value: sanitizedValue,
      text: sanitizedText,
      category: fact.category || existing.category,
      updatedAt: valueChanged ? now : existing.updatedAt,
      lastUsedAt: now,
    };
    items[existingIdx] = updatedItem;
    saveMemory(items);
    return { item: updatedItem, created: false, updated: valueChanged };
  }

  const newItem: MemoryItem = {
    id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
    key: normalizedKey,
    value: sanitizedValue,
    text: sanitizedText,
    category: fact.category || 'other',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };

  items.push(newItem);
  saveMemory(items);
  return { item: newItem, created: true, updated: false };
}

/**
 * Retrieves relevant memories for a query:
 * - Always includes "identity" category items.
 * - Includes other items whose keywords match the query (or recent items up to ~10).
 * - Updates lastUsedAt for the returned memories.
 */
export function getRelevantMemory(query: string): MemoryItem[] {
  if (!isMemoryEnabled()) return [];
  const items = loadMemory();
  if (items.length === 0) return [];

  const qLower = (query || '').toLowerCase();
  const queryWords = qLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const isBroadPersonalQuery =
    /\b(who am i|about me|know about me|remember about me|my details|my profile|my preferences|what do i like|what is my|what's my)\b/i.test(
      qLower
    );

  const identityItems = items.filter((item) => item.category === 'identity');
  const otherItems = items.filter((item) => item.category !== 'identity');

  const scoredOthers = otherItems.map((item) => {
    const haystack = `${item.key.replace(/_/g, ' ')} ${item.value} ${item.text} ${item.category}`.toLowerCase();
    let score = 0;
    if (isBroadPersonalQuery) {
      score += 2;
    }
    for (const word of queryWords) {
      if (haystack.includes(word)) {
        score += 3;
      }
    }
    return { item, score };
  });

  // Sort matching non-identity items by score desc, then updatedAt desc
  scoredOthers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.item.updatedAt || 0) - (a.item.updatedAt || 0);
  });

  const matchedOthers = scoredOthers
    .filter((entry) => entry.score > 0 || identityItems.length + otherItems.length <= MAX_RELEVANT_ITEMS)
    .map((entry) => entry.item);

  const combined = [...identityItems, ...matchedOthers].slice(0, MAX_RELEVANT_ITEMS);

  // Update lastUsedAt for memories that were retrieved/injected
  if (combined.length > 0) {
    const now = Date.now();
    const usedIds = new Set(combined.map((m) => m.id));
    const updatedAll = items.map((m) => (usedIds.has(m.id) ? { ...m, lastUsedAt: now } : m));
    saveMemory(updatedAll);
    return combined.map((m) => ({ ...m, lastUsedAt: now }));
  }

  return combined;
}

/**
 * Formats memory items into a system prompt block.
 */
export function buildMemoryPrompt(items: MemoryItem[]): string {
  if (!Array.isArray(items) || items.length === 0) return '';

  const lines = items
    .map((item) => sanitizeMemoryText(item.text))
    .filter(Boolean)
    .map((line) => `- ${line}`);

  if (lines.length === 0) return '';

  return [
    'Known facts about the user (from previous chats):',
    ...lines,
    'Use these facts naturally when relevant. Do not mention this list unless asked.',
  ].join('\n');
}

/**
 * Deletes a single memory item by ID and returns the remaining list.
 */
export function deleteMemory(id: string): MemoryItem[] {
  const items = loadMemory();
  const filtered = items.filter((item) => item.id !== id);
  saveMemory(filtered);
  return filtered;
}

/**
 * Clears all stored memory items.
 */
export function clearMemory(): void {
  saveMemory([]);
}

/**
 * Handles natural-language "forget" commands from the user:
 * e.g. "forget my name", "forget my location", "forget everything"
 */
export function handleForgetCommand(userMessage: string): {
  isForgetCommand: boolean;
  clearedAll: boolean;
  deletedItems: MemoryItem[];
} {
  if (!userMessage || typeof userMessage !== 'string') {
    return { isForgetCommand: false, clearedAll: false, deletedItems: [] };
  }

  const trimmed = userMessage.trim();

  // "forget everything" / "forget all memories" / "clear all memory"
  if (
    /^(?:please\s+)?(?:forget\s+(?:everything|all(?:\s+memories|\s+about\s+me|\s+facts)?)|clear\s+(?:all\s+)?memor(?:y|ies))[\s.!?;]*$/i.test(
      trimmed
    )
  ) {
    const current = loadMemory();
    clearMemory();
    return { isForgetCommand: true, clearedAll: true, deletedItems: current };
  }

  // "forget my name" / "forget my location" / "forget where I live" / "forget X"
  const forgetMatch =
    /^(?:please\s+)?forget\s+(?:about\s+)?(?:my\s+|that\s+i\s+|where\s+i\s+|what\s+my\s+)?(.+?)[\s.!?;]*$/i.exec(
      trimmed
    );
  if (!forgetMatch) {
    return { isForgetCommand: false, clearedAll: false, deletedItems: [] };
  }

  const target = forgetMatch[1].toLowerCase().trim();
  const items = loadMemory();
  const deletedItems: MemoryItem[] = [];

  const remaining = items.filter((item) => {
    const k = item.key.toLowerCase();
    const v = item.value.toLowerCase();
    const t = item.text.toLowerCase();

    const matchesName =
      /\b(name|who i am)\b/.test(target) && k === 'name';
    const matchesLocation =
      /\b(location|city|hometown|live|address|from)\b/.test(target) && k === 'location';
    const matchesJob =
      /\b(job|work|profession|occupation|role|career|company|workplace)\b/.test(target) &&
      (k === 'job' || k === 'workplace');
    const matchesProject =
      /\b(project|building|developing)\b/.test(target) &&
      (k === 'project' || item.category === 'project');
    const matchesDirect =
      k.includes(normalizeSlotKey(target)) ||
      v.includes(target) ||
      t.includes(target);

    if (matchesName || matchesLocation || matchesJob || matchesProject || matchesDirect) {
      deletedItems.push(item);
      return false;
    }
    return true;
  });

  if (deletedItems.length > 0) {
    saveMemory(remaining);
  }

  return {
    isForgetCommand: true,
    clearedAll: false,
    deletedItems,
  };
}
