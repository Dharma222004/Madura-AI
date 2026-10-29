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
