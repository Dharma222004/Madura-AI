import { SearchSource } from '../../types/index.js';

export interface SearchStrategy {
  priority: 'low' | 'medium' | 'high';
  maxResults: number;
  searchDepth: 'basic' | 'advanced';
  reason: string;
  topic: 'general' | 'news' | 'finance';
}

export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchSource[];
  strategy?: SearchStrategy;
  followUpQuestions?: string[];
}

// ── Trusted domain lists by category ──────────────────────────────────────────
const TRUSTED_DOMAINS = {
  // High-quality authoritative news & general sources
  news: [
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'theguardian.com',
    'nytimes.com',
    'bloomberg.com',
    'wsj.com',
    'ft.com',
    'economist.com',
    'time.com',
    'forbes.com',
    'businessinsider.com',
    'cnbc.com',
    'cnn.com',
    'techcrunch.com',
    'theverge.com',
    'wired.com',
    'arstechnica.com',
    'engadget.com',
    'venturebeat.com',
  ],
  // Finance & market data
  finance: [
    'bloomberg.com',
    'reuters.com',
    'wsj.com',
    'ft.com',
    'cnbc.com',
    'marketwatch.com',
    'investing.com',
    'finance.yahoo.com',
    'moneycontrol.com',
    'economictimes.indiatimes.com',
    'livemint.com',
    'business-standard.com',
    'businesstoday.in',
    'ndtv.com',
    'nseindia.com',
    'bseindia.com',
    'gold.org',
    'coinmarketcap.com',
    'coingecko.com',
  ],
  // Science, medicine & academia
  science: [
    'nature.com',
    'science.org',
    'sciencedaily.com',
    'pubmed.ncbi.nlm.nih.gov',
    'who.int',
    'cdc.gov',
    'nih.gov',
    'nasa.gov',
    'esa.int',
    'newscientist.com',
    'scientificamerican.com',
    'pnas.org',
  ],
  // Official & government
  official: [
    'gov.in',
    'india.gov.in',
    'rbi.org.in',
    'sebi.gov.in',
    'gov.uk',
    'whitehouse.gov',
    'europa.eu',
    'un.org',
    'worldbank.org',
    'imf.org',
    'wto.org',
    'oecd.org',
    'wikipedia.org',
  ],
  // Tech documentation
  tech: [
    'developer.mozilla.org',
    'docs.python.org',
    'nodejs.org',
    'react.dev',
    'stackoverflow.com',
    'github.com',
    'npmjs.com',
    'pypi.org',
    'cloud.google.com',
    'aws.amazon.com',
    'docs.microsoft.com',
    'learn.microsoft.com',
  ],
};

export class SearchService {
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private readonly endpoint = 'https://api.tavily.com/search';

  constructor(apiKeyOrKeys: string | string[] = '') {
    const rawKeys: string[] = [];

    // Accept constructor arg
    if (Array.isArray(apiKeyOrKeys)) rawKeys.push(...apiKeyOrKeys);
    else if (typeof apiKeyOrKeys === 'string') rawKeys.push(...apiKeyOrKeys.split(','));

    // Also read from env (all variations)
    for (const envVar of [
      'TAVILY_API_KEY',
      'TAVILY_API_KEYS',
      ...Array.from({ length: 10 }, (_, i) => `TAVILY_API_KEY_${i + 1}`),
    ]) {
      const val = process.env[envVar];
      if (val) rawKeys.push(...val.split(','));
    }

    const seen = new Set<string>();
    for (const k of rawKeys) {
      const clean = (k || '').trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        this.apiKeys.push(clean);
      }
    }

    if (this.apiKeys.length > 0) {
      console.log(`[SearchService] Initialized with ${this.apiKeys.length} Tavily key(s)`);
    } else {
      console.warn('[SearchService] No Tavily API key found — web search disabled');
    }
  }

  isConfigured(): boolean {
    return this.apiKeys.length > 0;
  }

  /**
   * Detects which topic category the query belongs to
   * to select the best domain list and Tavily topic param
   */
  private detectTopic(query: string): 'general' | 'news' | 'finance' {
    const q = query.toLowerCase();

    if (
      /\b(stock|share|nifty|sensex|bse|nse|market|crypto|bitcoin|ethereum|btc|eth|gold price|silver|crude oil|forex|exchange rate|inflation|gdp|interest rate|mutual fund|ipo|fii|dii)\b/i.test(q)
    ) return 'finance';

    if (
      /\b(news|breaking|latest|today|yesterday|this week|election|announced|policy|government|law|bill|treaty|conflict|war|protest|disaster|earthquake|flood|hurricane|pandemic)\b/i.test(q)
    ) return 'news';

    return 'general';
  }

  /**
   * Selects the best trusted domain list for a query
   */
  private getIncludeDomains(query: string): string[] {
    const topic = this.detectTopic(query);
    const q = query.toLowerCase();

    if (topic === 'finance') return TRUSTED_DOMAINS.finance;
    if (topic === 'news') return [...TRUSTED_DOMAINS.news, ...TRUSTED_DOMAINS.official];

    // General: blend based on keywords
    if (/\b(science|research|study|medical|health|disease|drug|vaccine|nasa|space)\b/i.test(q)) {
      return [...TRUSTED_DOMAINS.science, ...TRUSTED_DOMAINS.news];
    }
    if (/\b(code|programming|developer|api|documentation|library|framework|javascript|python|react|node)\b/i.test(q)) {
      return [...TRUSTED_DOMAINS.tech, ...TRUSTED_DOMAINS.news];
    }
    if (/\b(government|law|policy|regulation|official|ministry|act|bill|parliament|congress|senate)\b/i.test(q)) {
      return [...TRUSTED_DOMAINS.official, ...TRUSTED_DOMAINS.news];
    }

    // Default: authoritative general blend
    return [...TRUSTED_DOMAINS.news, ...TRUSTED_DOMAINS.official];
  }

  /**
   * Cleans and distills a user prompt into a focused search query
   */
  extractCleanSearchQuery(prompt: string): string {
    if (!prompt) return '';
    const raw = prompt.trim();

    // Short single-line: strip conversational filler
    if (raw.length <= 120 && !raw.includes('\n')) {
      return raw
        .replace(/^(please\s+)?(can\s+you\s+)?(search(\s+the\s+web|\s+online)?\s+for|search\s+for|google|look\s+up|web\s+search)\s+/i, '')
        .trim();
    }

    // For long/structured prompts: extract the most informative line
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    // Find the first line with strong domain/topic keywords
    for (const line of lines) {
      if (/^(web\s+search|step\s*\d|data\s+collection|primary\s+sources?|collect:|fetch:|run\s+first)/i.test(line)) continue;
      if (/\b(fetch|market|price|index|nifty|sensex|stock|gold|silver|weather|score|news|latest|today|data|search|find)\b/i.test(line)) {
        const cleaned = line
          .replace(/^(web\s+search\s*(step\s*\d+)?\s*[\u2014\-\u2013:]*\s*)/i, '')
          .replace(/^(please\s+)?(can\s+you\s+)?(search(\s+the\s+web|\s+online)?\s+for|fetch|find|look\s+up|get)\s+/i, '')
          .trim();
        if (cleaned.length > 10) return cleaned.slice(0, 120);
      }
    }

    // Fallback: use first meaningful line
    const firstLine = (lines[0] || raw.slice(0, 90)).trim();
    return firstLine.slice(0, 120);
  }

  /**
   * Decides if a prompt needs live web search
   */
  needsLiveSearch(prompt: string, explicitForce?: boolean): boolean {
    if (!this.isConfigured()) return false;
    if (explicitForce === true) return true;

    const clean = prompt.toLowerCase().replace(/[?!.,;:~`'"""()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

    // Never search for identity / AI self-awareness
    if (
      /\b(who|what) are you\b/.test(clean) ||
      /\b(who|what) is madura\b/.test(clean) ||
      /\b(what|which) model\b/.test(clean) ||
      /\b(who made|who built|who created|who developed|who trained) you\b/.test(clean) ||
      /\b(tell me about yourself|what can you do|how can you help)\b/.test(clean) ||
      /\b(are you an? (ai|bot|chatbot|human|chatgpt|gpt|real))\b/.test(clean)
    ) return false;

    // Never search for greetings / casual
    if (
      /^(hi|hello|hey|howdy|hola|greetings|good\s*(morning|afternoon|evening|night|day))\b/.test(clean) ||
      /^(how are you|thank you|thanks|ok|okay|got it|cool|nice|awesome|great|bye|goodbye)\b/.test(clean)
    ) return false;

    // Never search for creative/code/math/timeless
    if (
      clean.startsWith('write a poem') || clean.startsWith('write a story') ||
      clean.startsWith('write an essay') || clean.startsWith('write an email') ||
      (clean.startsWith('write a function') || clean.startsWith('write code') || clean.includes('leetcode') || clean.includes('debug this')) && !/\b(latest|2025|2026|new in)\b/.test(clean) ||
      (clean.startsWith('solve ') || clean.startsWith('calculate ') || clean.includes('integral of') || clean.includes('derivative of')) && !/\b(price|stock|market|rate)\b/.test(clean) ||
      clean.includes('capital of') || clean.includes('why is the sky blue') || clean.includes('speed of light') || clean.includes('what is photosynthesis')
    ) return false;

    // Always search for explicit search requests
    if (['search for', 'search web', 'search online', 'browse the web', 'google ', 'look up online', 'find news', 'check online', 'web search', 'find online', 'browse online'].some(v => clean.includes(v))) {
      return true;
    }

    // Always search for leadership/current-event queries
    if ([
      'prime minister', 'president of', 'chief minister', 'chancellor of', 'finance minister',
      'foreign minister', 'ceo of', 'who is the ceo', 'who is the current', 'who runs', 'who leads',
      'secretary of state', 'governor of', 'vice president', 'head of state',
    ].some(k => clean.includes(k))) return true;

    // Temporal / live-data topics
    const temporalMatch = /\b(today|yesterday|this week|this month|this year|breaking news|live update|right now|2025|2026)\b/.test(clean);
    const liveTopicMatch = [
      'weather', 'temperature today', 'forecast', 'stock price', 'stocks today', 'share price',
      'crypto price', 'bitcoin price', 'btc price', 'eth price', 'cryptocurrency', 'market trends',
      'exchange rate', 'inflation rate', 'interest rates', 'match score', 'who won', 'championship',
      'election', 'release date of', 'when is coming out', 'what happened in',
      'nifty', 'sensex', 'gold price', 'silver price', 'crude oil',
    ].some(t => clean.includes(t));

    return temporalMatch || liveTopicMatch;
  }

  /**
   * Determines search depth & result count based on query complexity
   */
  determineSearchStrategy(query: string, explicitForce?: boolean): SearchStrategy {
    const clean = query.toLowerCase().replace(/[?!.,;:~`'"""()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    const topic = this.detectTopic(query);

    // High priority: comparative/research queries
    const isHighResearch =
      /\b(compare|comparison|versus|vs|differences between|comprehensive|detailed|in-depth|full analysis|breakdown|roadmap|benchmark|state of the art|pros and cons|evaluation|deep dive)\b/.test(clean) ||
      wordCount >= 14 ||
      (clean.includes(' and ') && (clean.includes('latest') || clean.includes('2026')));

    if (isHighResearch) {
      const budgeted = Math.max(5, Math.min(15, 10 + Math.floor(wordCount / 3)));
      return { priority: 'high', maxResults: budgeted, searchDepth: 'advanced', reason: 'Deep research or comparative analysis', topic };
    }

    // Medium priority: current events, news, announcements
    const isMedium =
      /\b(latest|news|today|yesterday|this week|this month|breaking|announced|release|elections|prime minister|president|ceo|policy|market trends|new version|what happened)\b/.test(clean) ||
      wordCount >= 7 || explicitForce === true;

    if (isMedium) {
      const budgeted = Math.max(5, Math.min(10, 7 + Math.floor(wordCount / 4)));
      return { priority: 'medium', maxResults: budgeted, searchDepth: 'advanced', reason: 'Time-sensitive current event or announcement', topic };
    }

    // Low priority: quick fact / price / weather
    const budgeted = Math.max(3, Math.min(7, 4 + Math.floor(wordCount / 5)));
    return { priority: 'low', maxResults: budgeted, searchDepth: 'basic', reason: 'Direct factual or quick volatile query', topic };
  }

  /**
   * Execute Tavily web search with smart domain filtering and rich result extraction.
   * Returns clean, source-cited results ready for AI consumption.
   */
  async search(
    query: string,
    options?: number | { maxResults?: number; searchDepth?: 'basic' | 'advanced' }
  ): Promise<SearchResponse> {
    if (this.apiKeys.length === 0) {
      console.warn('[SearchService] Search called but no API key configured');
      return { query, results: [] };
    }

    let strategy = this.determineSearchStrategy(query);

    // Honor explicit overrides
    if (typeof options === 'number') {
      strategy.maxResults = Math.max(3, Math.min(15, options));
    } else if (options && typeof options === 'object') {
      if (options.maxResults !== undefined) strategy.maxResults = Math.max(3, Math.min(15, options.maxResults));
      if (options.searchDepth) strategy.searchDepth = options.searchDepth;
    }

    const includeDomains = this.getIncludeDomains(query);

    console.log(
      `[SearchService] Tavily search: "${query.slice(0, 60)}" | depth=${strategy.searchDepth} | results=${strategy.maxResults} | topic=${strategy.topic} | domains=${includeDomains.slice(0, 3).join(',')}...`
    );

    const totalKeys = this.apiKeys.length;
    let lastErr = '';

    for (let i = 0; i < totalKeys; i++) {
      const keyIndex = (this.currentKeyIndex + i) % totalKeys;
      const key = this.apiKeys[keyIndex];

      try {
        const body: Record<string, any> = {
          api_key: key,
          query: query.trim(),
          search_depth: strategy.searchDepth,
          topic: strategy.topic,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
          max_results: strategy.maxResults,
          include_domains: includeDomains,
        };

        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          if (this.currentKeyIndex !== keyIndex) {
            console.log(`[SearchService] Switched to working Tavily key #${keyIndex + 1}`);
            this.currentKeyIndex = keyIndex;
          }

          const data = (await response.json()) as any;

          // Map results with rich metadata
          const results: SearchSource[] = Array.isArray(data.results)
            ? data.results
                .filter((r: any) => r.url && r.content)
                .map((r: any) => ({
                  title: r.title || 'Source',
                  url: r.url || '',
                  snippet: this.cleanSnippet(r.content || ''),
                  score: r.score,
                  publishedDate: r.published_date || undefined,
                }))
            : [];

          if (results.length === 0) {
            console.warn(`[SearchService] Tavily returned 0 results for "${query.slice(0, 60)}"`);
          } else {
            console.log(`[SearchService] Returned ${results.length} results for "${query.slice(0, 60)}"`);
          }

          return {
            query,
            answer: data.answer ? this.cleanSnippet(data.answer) : undefined,
            results,
            strategy,
            followUpQuestions: Array.isArray(data.follow_up_questions) ? data.follow_up_questions.slice(0, 3) : undefined,
          };
        }

        // Handle API error responses
        const errText = await response.text().catch(() => '');
        lastErr = `HTTP ${response.status}: ${errText.slice(0, 200)}`;
        console.warn(`[SearchService] Tavily key #${keyIndex + 1} failed (${response.status}). Trying next key...`);

        // 401/403/432: invalid key or auth/quota failure — rotate immediately
        if (response.status === 401 || response.status === 403 || response.status === 432) {
          console.warn(`[SearchService] Key #${keyIndex + 1} rejected (${response.status} auth/quota). Rotating to next key...`);
          this.currentKeyIndex = (keyIndex + 1) % totalKeys;
          continue;
        }

        // 429: rate limited — wait a moment then retry without domain filter
        if (response.status === 429) {
          console.warn('[SearchService] 429 rate limited — retrying without domain filter after 1s...');
          await new Promise(r => setTimeout(r, 1000));
          const retryBody = { ...body };
          delete retryBody.include_domains;
          delete retryBody.days;
          const retryResp = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryBody),
          });
          if (retryResp.ok) {
            const retryData = (await retryResp.json()) as any;
            const results: SearchSource[] = Array.isArray(retryData.results)
              ? retryData.results
                  .filter((r: any) => r.url && r.content)
                  .map((r: any) => ({
                    title: r.title || 'Source',
                    url: r.url || '',
                    snippet: this.cleanSnippet(r.content || ''),
                    score: r.score,
                  }))
              : [];
            console.log(`[SearchService] Rate-limit retry returned ${results.length} results`);
            return { query, answer: retryData.answer ? this.cleanSnippet(retryData.answer) : undefined, results, strategy };
          }
        }

        // 422: domain filter too restrictive — retry without domain filter
        if (response.status === 422) {
          console.warn('[SearchService] 422 error — retrying without domain filter...');
          const retryBody = { ...body };
          delete retryBody.include_domains;
          const retryResp = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryBody),
          });
          if (retryResp.ok) {
            const retryData = (await retryResp.json()) as any;
            const results: SearchSource[] = Array.isArray(retryData.results)
              ? retryData.results
                  .filter((r: any) => r.url && r.content)
                  .map((r: any) => ({
                    title: r.title || 'Source',
                    url: r.url || '',
                    snippet: this.cleanSnippet(r.content || ''),
                    score: r.score,
                  }))
              : [];
            console.log(`[SearchService] Retry (no domain filter) returned ${results.length} results`);
            return { query, answer: retryData.answer ? this.cleanSnippet(retryData.answer) : undefined, results, strategy };
          }
        }
      } catch (err: any) {
        lastErr = err.message;
        console.warn(`[SearchService] Network error on key #${keyIndex + 1}: ${err.message}`);
      }
    }

    console.error(`[SearchService] All ${totalKeys} Tavily key(s) failed: ${lastErr}`);
    return { query, results: [], strategy };
  }

  /**
   * Cleans a Tavily content snippet: removes excess whitespace, HTML tags, etc.
   */
  private cleanSnippet(text: string): string {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, '')         // Strip any HTML tags
      .replace(/\s{3,}/g, ' ')         // Collapse excess whitespace
      .replace(/\n{3,}/g, '\n\n')      // Collapse excess newlines
      .trim()
      .slice(0, 1500);                  // Cap snippet length
  }
}
