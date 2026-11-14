import { SearchSource } from '../../types/index.js';

export interface SearchStrategy {
  priority: 'low' | 'medium' | 'high';
  maxResults: number; // dynamically budgeted between 3 (min) and 15 (max)
  searchDepth: 'basic' | 'advanced';
  reason: string;
}

export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchSource[];
  strategy?: SearchStrategy;
}

export class SearchService {
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private endpoint: string = 'https://api.tavily.com/search';

  constructor(apiKeyOrKeys: string | string[] = process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '') {
    const rawKeys: string[] = [];
    if (Array.isArray(apiKeyOrKeys)) {
      rawKeys.push(...apiKeyOrKeys);
    } else if (typeof apiKeyOrKeys === 'string') {
      rawKeys.push(...apiKeyOrKeys.split(','));
    }

    if (process.env.TAVILY_API_KEYS) {
      rawKeys.push(...process.env.TAVILY_API_KEYS.split(','));
    }
    if (process.env.TAVILY_API_KEY) {
      rawKeys.push(process.env.TAVILY_API_KEY);
    }
    for (let i = 1; i <= 10; i++) {
      const indexed = process.env[`TAVILY_API_KEY_${i}`];
      if (indexed) rawKeys.push(indexed);
    }

    const seen = new Set<string>();
    for (const k of rawKeys) {
      const clean = (k || '').trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        this.apiKeys.push(clean);
      }
    }
  }

  isConfigured(): boolean {
    return this.apiKeys.length > 0;
  }

  /**
   * Cleans and distills long or multi-line user prompts into a focused, high-relevance search query.
   * Handles structured/instructional prompts by scanning ALL content for domain keywords
   * and synthesizing a concise, relevant search query. Never returns meta-labels like
   * "Data Collection", "STEP 1", etc.
   *
   * Strategy:
   * 1. Short single-line prompts → strip conversational prefixes only.
   * 2. Structured / multi-line prompts → run domain keyword extraction across the ENTIRE text.
   *    Use fresh RegExp instances (not literals) to avoid shared `lastIndex` bugs.
   *    If domain keywords are found → synthesize a focused query from the top hits.
   *    If none → try line-scanner to find the most informative line.
   * 3. Fallback → first meaningful line after stripping instruction boilerplate.
   */
  extractCleanSearchQuery(prompt: string): string {
    if (!prompt) return '';
    const raw = prompt.trim();

    // ── 1. Short single-line: just strip conversational prefixes ──
    if (raw.length <= 120 && !raw.includes('\n')) {
      return raw
        .replace(/^(please\s+)?(can\s+you\s+)?(search(\s+the\s+web|\s+online)?\s+for|search\s+for|google|look\s+up|web\s+search)\s+/i, '')
        .trim();
    }

    // ── 2. Detect structured / instructional prompts ──
    const isStructured =
      raw.split('\n').length > 4 ||
      /\b(step\s*\d|collect[:\s]|fetch[:\s]|primary\s+sources|must\s+fetch|must\s+use)\b/i.test(raw) ||
      /^\s*[\-\*\u2022\u25AA]\s/m.test(raw) ||
      /^\s*\d+[.)]\s/m.test(raw);

    // ── Domain pattern definitions — always use `new RegExp` to avoid shared lastIndex ──
    type DomainEntry = { category: string; src: string; flags: string; priority: number };
    const DOMAIN_ENTRIES: DomainEntry[] = [
      // Indian market indices (highest priority)
      { category: 'market', src: '\\b(NIFTY\\s*50)\\b',           flags: 'gi', priority: 11 },
      { category: 'market', src: '\\b(SENSEX)\\b',                 flags: 'gi', priority: 11 },
      { category: 'market', src: '\\b(BANK\\s*NIFTY)\\b',          flags: 'gi', priority: 9 },
      { category: 'market', src: '\\b(INDIA\\s*VIX)\\b',           flags: 'gi', priority: 8 },
      { category: 'market', src: '\\b(NIFTY)\\b',                  flags: 'gi', priority: 7 },
      { category: 'market', src: '\\b(NSE|BSE)\\b',                flags: 'g',  priority: 6 },
      // Financial terms
      { category: 'finance', src: '\\b(market\\s*closing|closing\\s*data|stock\\s*market|share\\s*price)\\b', flags: 'gi', priority: 9 },
      { category: 'finance', src: '\\b(FII|DII|institutional\\s*activity)\\b', flags: 'gi', priority: 6 },
      { category: 'finance', src: '\\b(top\\s*gainers?|top\\s*losers?|market\\s*breadth)\\b', flags: 'gi', priority: 5 },
      { category: 'finance', src: '\\b(sector\\s*performance)\\b', flags: 'gi', priority: 4 },
      // Commodities
      { category: 'commodity', src: '\\b(gold\\s*price|silver\\s*price|bullion|precious\\s*metals?)\\b', flags: 'gi', priority: 7 },
      { category: 'commodity', src: '\\b(crude\\s*oil|brent|wti)\\b', flags: 'gi', priority: 7 },
      // Crypto
      { category: 'crypto', src: '\\b(bitcoin|btc|ethereum|eth|crypto(?:currency)?)\\b', flags: 'gi', priority: 8 },
      // Weather
      { category: 'weather', src: '\\b(weather|temperature|forecast|rainfall?|humidity|climate)\\b', flags: 'gi', priority: 8 },
      // Sports
      { category: 'sports', src: '\\b(match\\s*score|cricket|football|IPL|FIFA|tennis|world\\s*cup|championship)\\b', flags: 'gi', priority: 8 },
      // Politics
      { category: 'politics', src: '\\b(election|voting|poll\\s*results?|prime\\s*minister|president)\\b', flags: 'gi', priority: 8 },
      // Tech
      { category: 'tech', src: '\\b(latest\\s+release|new\\s+version|update|launch|announcement)\\b', flags: 'gi', priority: 6 },
      // Region
      { category: 'region', src: '\\b(India|Indian|US|USA|China|UK|Japan|Europe)\\b', flags: 'gi', priority: 3 },
      // Temporal
      { category: 'temporal', src: '\\b(today|yesterday|this\\s+week|this\\s+month|current|live|real[\\s\\-]?time|closing)\\b', flags: 'gi', priority: 2 },
    ];

    // ── Helper: run domain extraction on a given text ──
    const extractDomainHits = (text: string) => {
      const hits: { text: string; priority: number; category: string }[] = [];
      const seenLower = new Set<string>();
      for (const entry of DOMAIN_ENTRIES) {
        const re = new RegExp(entry.src, entry.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const word = m[0].trim();
          const key = word.toLowerCase().replace(/\s+/g, ' ');
          if (!seenLower.has(key)) {
            seenLower.add(key);
            hits.push({ text: word, priority: entry.priority, category: entry.category });
          }
        }
      }
      return hits;
    };

    // ── Helper: build query string from hits ──
    const buildQueryFromHits = (hits: { text: string; priority: number; category: string }[]): string => {
      hits.sort((a, b) => b.priority - a.priority);
      const regionHits  = hits.filter(h => h.category === 'region');
      const temporalHits = hits.filter(h => h.category === 'temporal');
      const topicHits   = hits.filter(h => h.category !== 'region' && h.category !== 'temporal');

      const parts: string[] = [];
      if (regionHits.length > 0) parts.push(regionHits[0].text);

      const usedTexts = new Set<string>();
      for (const h of topicHits) {
        if (usedTexts.size >= 6) break;
        const norm = h.text.toLowerCase().replace(/\s+/g, ' ');
        if (!usedTexts.has(norm)) { usedTexts.add(norm); parts.push(h.text); }
      }
      if (temporalHits.length > 0) parts.push(temporalHits[0].text);

      const q = parts.join(' ').replace(/\s+/g, ' ').trim();
      return q.length > 120 ? q.slice(0, 117).trim() + '...' : q;
    };

    if (isStructured) {
      // Run domain extraction across the ENTIRE prompt
      const hits = extractDomainHits(raw);
      if (hits.length > 0) {
        const q = buildQueryFromHits(hits);
        if (q) return q;
      }

      // If no domain keywords found, try to find the most informative non-boilerplate line
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Skip pure boilerplate headers
        if (/^(web\s+search|step\s*\d|data\s+collection|primary\s+sources?|collect:|fetch:|run\s+first|market\s+indices)/i.test(line)) continue;
        // Pick first line that has domain-ish nouns
        if (/\b(fetch|market|price|index|indices|nifty|sensex|stock|gold|silver|weather|score|news|latest|today|data)\b/i.test(line)) {
          let t = line
            .replace(/^(web\s+search\s*(step\s*\d+)?\s*[\u2014\-\u2013:]*\s*)/i, '')
            .replace(/^(data\s+collection\s*[\u2014\-\u2013:]*\s*)/i, '')
            .replace(/\((run\s+first|daily|after|before)[^)]*\)/gi, '')
            .replace(/^(please\s+)?(can\s+you\s+)?(search(\s+the\s+web|\s+online)?\s+for|fetch|find|get)\s+/i, '')
            .trim();
          if (t.length > 10) return t.length > 120 ? t.slice(0, 117) + '...' : t;
        }
      }
    }

    // ── 3. Fallback: line-scanner for shorter / non-structured prompts ──
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let target = lines[0] || '';

    for (const line of lines) {
      if (/\b(fetch|search|closing\s+data|price|market|news|latest|today|indices|nifty|sensex|stock|weather|score)\b/i.test(line)) {
        target = line;
        break;
      }
    }

    target = target
      .replace(/^(web\s+search\s*(step\s*\d+)?\s*[\u2014\-\u2013:]*\s*)/i, '')
      .replace(/^(data\s+collection\s*[\u2014\-\u2013:]*\s*)/i, '')
      .replace(/\((run\s+first|daily|after|before)[^)]*\)/gi, '')
      .replace(/^(please\s+)?(can\s+you\s+)?(search(\s+the\s+web|\s+online)?\s+for|search\s+for|fetch|find|look\s+up|get)\s+/i, '')
      .trim();

    const sentenceMatch = target.match(/^([^.?!]+)/);
    const sentenceText = sentenceMatch?.[1]?.trim();
    if (sentenceText && sentenceText.length > 10) target = sentenceText;

    return (target.length > 120 ? target.slice(0, 117).trim() + '...' : target) || raw.slice(0, 90).trim();
  }

  /**
   * Intelligently classifies whether a user prompt truly requires real-time/live web search.
   * Only returns true when the query seeks live, up-to-date, or time-sensitive data.
   */
  needsLiveSearch(prompt: string, explicitForce?: boolean): boolean {
    if (!this.isConfigured()) return false;
    if (explicitForce === true) return true;

    // Normalize prompt: remove punctuation and collapse whitespace
    const clean = prompt
      .toLowerCase()
      .replace(/[?!.,;:~`'"“”()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. Definite Non-Search: Identity, Model, Self-awareness & AI Meta questions (NEVER SEARCH)
    const isIdentityOrSelf =
      /\b(who|what) are you\b/i.test(clean) ||
      /\b(who|what) is madura\b/i.test(clean) ||
      /\b(what|which) model\b/i.test(clean) ||
      /\bwhat is ai\b/i.test(clean) ||
      /\bwhat ai is\b/i.test(clean) ||
      /\bwhat is (artificial intelligence|a large language model|an llm)\b/i.test(clean) ||
      /\byour (model|name|architecture|creator|developer|system prompt|training|purpose|capabilities|version)\b/i.test(clean) ||
      /\b(who|what) (made|built|created|developed|trained) you\b/i.test(clean) ||
      /\b(tell me about yourself|introduce yourself|what can you do|how can you help( me)?)\b/i.test(clean) ||
      /\b(are you (an? )?(ai|artificial intelligence|bot|chatbot|robot|human|chatgpt|gpt|real))\b/i.test(clean) ||
      /\bexplain (what you are|your model|ai|artificial intelligence)\b/i.test(clean);

    if (isIdentityOrSelf) {
      return false;
    }

    // 2. Greetings, casual conversational pleasantries & compliments (NEVER SEARCH)
    const isGreetingOrCasual =
      /^(hi|hello|hey|howdy|hola|greetings|good\s*(morning|afternoon|evening|night|day))\b/i.test(clean) ||
      /^(how are you|how is it going|how are things|how do you do|sup|what's up|whats up)\b/i.test(clean) ||
      /^(thank you|thanks|thx|much appreciated|appreciate it)\b/i.test(clean) ||
      /^(ok|okay|got it|cool|nice|awesome|great|understood|sure|yes|no|yep|nope)\b/i.test(clean) ||
      /^(bye|goodbye|see you|take care|farewell)\b/i.test(clean) ||
      /^(tell me a joke|make me laugh|entertain me)\b/i.test(clean);

    if (isGreetingOrCasual) {
      return false;
    }

    // 3. Creative writing, coding, math, timeless science & history (NEVER SEARCH unless explicitly live)
    const isCreative =
      clean.startsWith('write a poem') ||
      clean.startsWith('write a story') ||
      clean.startsWith('write an essay') ||
      clean.startsWith('write a letter') ||
      clean.startsWith('write an email') ||
      clean.startsWith('draft an email');

    const isCode =
      (clean.startsWith('write a function') ||
        clean.startsWith('write code') ||
        clean.startsWith('how to implement') ||
        clean.startsWith('how to write') ||
        clean.includes('algorithm for') ||
        clean.includes('leetcode') ||
        clean.includes('fizzbuzz') ||
        clean.includes('regex for') ||
        clean.includes('debug this') ||
        clean.includes('fix this code') ||
        clean.includes('sql query')) &&
      !/\b(latest|2025|2026|new in|breaking changes)\b/i.test(clean);

    const isMath =
      (clean.startsWith('solve ') ||
        clean.startsWith('calculate ') ||
        clean.includes('integral of') ||
        clean.includes('derivative of') ||
        clean.includes('matrix multiplication') ||
        clean.includes('factorial of')) &&
      !/\b(price|stock|market|rate)\b/i.test(clean);

    const isTimelessKnowledge =
      clean.includes('why is the sky blue') ||
      clean.includes('how do airplanes fly') ||
      clean.includes('speed of light') ||
      clean.includes('what is photosynthesis') ||
      clean.includes('what is recursion') ||
      clean.includes('who was albert einstein') ||
      clean.includes('who was shakespeare') ||
      clean.includes('who was isaac newton') ||
      clean.includes('who wrote hamlet') ||
      clean.startsWith('capital of');

    if (isCreative || isCode || isMath || isTimelessKnowledge) {
      return false;
    }

    // 4. Explicit Search Directives (ALWAYS SEARCH)
    const searchVerbs = [
      'search for',
      'search web',
      'search online',
      'browse the web',
      'browse online',
      'google ',
      'look up online',
      'find online',
      'find news',
      'check online',
      'web search',
    ];
    if (searchVerbs.some((v) => clean.includes(v))) {
      return true;
    }

    // 5. Explicit Current Political/Executive Leadership Office queries (e.g. "who is current prime minister of...")
    const leadershipKeywords = [
      'prime minister',
      'president of',
      'us president',
      'french president',
      'russian president',
      'chief minister',
      'chancellor of',
      'german chancellor',
      'governor of',
      'secretary of state',
      'finance minister',
      'foreign minister',
      'defense minister',
      'vice president',
      'head of state',
      'ceo of',
      'new ceo',
      'founder of',
      'who is the ceo',
      'who is the current',
      'who runs',
      'who leads',
    ];
    if (leadershipKeywords.some((k) => clean.includes(k))) {
      return true;
    }

    // 6. Temporal indicators for current / recent real-time events
    const temporalKeywords = [
      'today',
      'yesterday',
      'this week',
      'this month',
      'this year',
      'breaking news',
      'live update',
      'newest release',
      'right now',
      '2025',
      '2026',
    ];
    const hasTemporal = temporalKeywords.some((w) => {
      const regex = new RegExp(`\\b${w}\\b`, 'i');
      return regex.test(clean);
    });

    // 7. Volatile live-information topics (weather, stocks, sports, upcoming releases)
    const liveTopicKeywords = [
      'weather',
      'temperature today',
      'forecast',
      'stock price',
      'stocks today',
      'share price',
      'crypto price',
      'bitcoin price',
      'btc price',
      'eth price',
      'cryptocurrency',
      'market trends',
      'exchange rate',
      'inflation rate',
      'interest rates',
      'match score',
      'who won',
      'championship',
      'election',
      'release date of',
      'when is coming out',
      'what happened in',
    ];
    const hasLiveTopic = liveTopicKeywords.some((topic) => clean.includes(topic));

    return hasTemporal || hasLiveTopic;
  }

  /**
   * Automatically assesses query importance and determines search depth & result budget.
   * Enforces a dynamic budget between minimum 3 and maximum 15 results.
   */
  determineSearchStrategy(query: string, explicitForce?: boolean): SearchStrategy {
    const clean = query
      .toLowerCase()
      .replace(/[?!.,;:~`'"“”()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = clean.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // 1. HIGH PRIORITY (10–15 results, advanced depth): Deep research, comparative analysis, multi-topic exploration
    const deepResearchKeywords = [
      'compare',
      'comparison',
      'versus',
      'vs',
      'differences between',
      'comprehensive',
      'detailed',
      'in-depth',
      'exhaustive',
      'full analysis',
      'breakdown',
      'overview of all',
      'all sources',
      'resources for',
      'suggested resources',
      'roadmap',
      'curriculum',
      'benchmark',
      'benchmarks',
      'timeline of',
      'deep dive',
      'state of the art',
      'pros and cons',
      'evaluation',
      'quantum computing',
      'quantum mechanics',
    ];

    const isHighResearch =
      deepResearchKeywords.some((k) => clean.includes(k)) ||
      wordCount >= 14 ||
      (clean.includes(' and ') && (clean.includes('latest') || clean.includes('2026')));

    if (isHighResearch) {
      // Calculate dynamic budget between 10 and 15 depending on query length & keywords
      const rawCount = 10 + Math.min(5, Math.floor(wordCount / 3));
      const budgeted = Math.max(3, Math.min(15, rawCount));
      return {
        priority: 'high',
        maxResults: budgeted,
        searchDepth: 'advanced',
        reason: 'Complex multi-topic research or comparative analysis requiring deep web coverage (10-15 sources)',
      };
    }

    // 2. MEDIUM PRIORITY (6–9 results, advanced depth): Current events, recent tech announcements, leadership
    const mediumKeywords = [
      'latest',
      'news',
      'today',
      'yesterday',
      'this week',
      'this month',
      'breaking',
      'announced',
      'release',
      'release date',
      'elections',
      'prime minister',
      'president',
      'ceo',
      'chancellor',
      'governor',
      'policy',
      'market trends',
      'new version',
      'what happened',
    ];

    const isMedium =
      mediumKeywords.some((k) => clean.includes(k)) ||
      wordCount >= 7 ||
      explicitForce === true;

    if (isMedium) {
      const rawCount = 6 + Math.min(3, Math.floor(wordCount / 4));
      const budgeted = Math.max(3, Math.min(15, rawCount));
      return {
        priority: 'medium',
        maxResults: budgeted,
        searchDepth: 'advanced',
        reason: 'Time-sensitive current event or recent announcement (6-9 sources)',
      };
    }

    // 3. LOW PRIORITY (3–5 results, basic depth): Quick fact, score, price, weather
    const budgeted = Math.max(3, Math.min(15, 3 + Math.min(2, Math.floor(wordCount / 5))));
    return {
      priority: 'low',
      maxResults: budgeted,
      searchDepth: 'basic',
      reason: 'Direct factual or quick volatile query (3-5 sources)',
    };
  }

  /**
   * Executes Tavily web search with dynamic priority budgeting (min 3, max 15)
   */
  async search(
    query: string,
    options?: number | { maxResults?: number; searchDepth?: 'basic' | 'advanced' }
  ): Promise<SearchResponse> {
    if (this.apiKeys.length === 0) {
      return { query, results: [] };
    }

    // Determine strategy automatically or honor explicit overrides (clamped to [3, 15])
    let strategy = this.determineSearchStrategy(query);

    if (typeof options === 'number') {
      const clamped = Math.max(3, Math.min(15, options));
      strategy = {
        ...strategy,
        maxResults: clamped,
      };
    } else if (options && typeof options === 'object') {
      if (options.maxResults !== undefined) {
        strategy.maxResults = Math.max(3, Math.min(15, options.maxResults));
      }
      if (options.searchDepth) {
        strategy.searchDepth = options.searchDepth;
      }
    }

    console.log(
      `[SearchService] Executing Tavily search for "${query.slice(0, 60)}..." -> Priority: ${strategy.priority}, Results: ${strategy.maxResults}, Depth: ${strategy.searchDepth}`
    );

    const totalKeys = this.apiKeys.length;
    let lastErr = '';

    for (let i = 0; i < totalKeys; i++) {
      const keyIndex = (this.currentKeyIndex + i) % totalKeys;
      const key = this.apiKeys[keyIndex];

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: key,
            query: query.trim(),
            search_depth: strategy.searchDepth,
            include_answer: true,
            max_results: strategy.maxResults,
          }),
        });

        if (response.ok) {
          if (this.currentKeyIndex !== keyIndex) {
            console.log(`[SearchService] Switched to working Tavily key #${keyIndex + 1}`);
            this.currentKeyIndex = keyIndex;
          }
          const data = (await response.json()) as any;
          const results: SearchSource[] = Array.isArray(data.results)
            ? data.results.map((r: any) => ({
                title: r.title || 'Source',
                url: r.url || '',
                snippet: r.content || '',
              }))
            : [];

          return {
            query,
            answer: data.answer || undefined,
            results,
            strategy,
          };
        }

        const errText = await response.text().catch(() => '');
        lastErr = `HTTP ${response.status}: ${errText}`;
        console.warn(`[SearchService] Tavily key #${keyIndex + 1} failed (${response.status}): ${errText.slice(0, 100)}. Falling back to next key...`);
      } catch (err: any) {
        lastErr = err.message;
        console.warn(`[SearchService] Tavily key #${keyIndex + 1} network error: ${err.message}. Falling back to next key...`);
      }
    }

    console.error(`[SearchService] All ${totalKeys} Tavily keys exhausted or failed: ${lastErr}`);
    return { query, results: [], strategy };
  }
}
