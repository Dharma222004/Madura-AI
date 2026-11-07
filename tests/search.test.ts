import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from '../src/server/services/search.service.js';

describe('SearchService & Live Data Classifier', () => {
  const service = new SearchService('test-key');

  it('should identify queries that REQUIRE live data', () => {
    // Current/recent temporal queries
    expect(service.needsLiveSearch('What is the latest tech news today?')).toBe(true);
    expect(service.needsLiveSearch('What happened in the news recently?')).toBe(true);
    expect(service.needsLiveSearch('Latest developments in 2026')).toBe(true);

    // Live financial and volatile topics
    expect(service.needsLiveSearch('What is the current stock price of Nvidia?')).toBe(true);
    expect(service.needsLiveSearch('Bitcoin price right now')).toBe(true);

    // Live personnel and current state
    expect(service.needsLiveSearch('Who is the current prime minister of the UK?')).toBe(true);
    expect(service.needsLiveSearch('Who is the new CEO of Starbucks?')).toBe(true);
    expect(service.needsLiveSearch('Indian Prime Minister')).toBe(true);
    expect(service.needsLiveSearch('Prime Minister of India')).toBe(true);
    expect(service.needsLiveSearch('US President')).toBe(true);
    expect(service.needsLiveSearch('CEO of Google')).toBe(true);
    expect(service.needsLiveSearch('Who is the president of France?')).toBe(true);

    // Live scores / weather
    expect(service.needsLiveSearch('Weather in Tokyo')).toBe(true);
    expect(service.needsLiveSearch('Who won the match yesterday?')).toBe(true);

    // Explicit search requests
    expect(service.needsLiveSearch('Search web for best mechanical keyboards')).toBe(true);
    expect(service.needsLiveSearch('Browse the web for quantum computing breakthroughs')).toBe(true);
  });

  it('should identify queries that DO NOT require live data', () => {
    // Standard algorithms and coding questions
    expect(service.needsLiveSearch('Write a python function to reverse a linked list')).toBe(false);
    expect(service.needsLiveSearch('Write code for binary search in C++')).toBe(false);
    expect(service.needsLiveSearch('How to center a div with flexbox')).toBe(false);
    expect(service.needsLiveSearch('Explain bubble sort algorithm')).toBe(false);

    // Mathematics
    expect(service.needsLiveSearch('Solve 3x + 5 = 20')).toBe(false);
    expect(service.needsLiveSearch('What is the derivative of sin(x)?')).toBe(false);

    // General encyclopedic knowledge & creative prompts
    expect(service.needsLiveSearch('What is photosynthesis?')).toBe(false);
    expect(service.needsLiveSearch('Write a poem about the ocean')).toBe(false);
    expect(service.needsLiveSearch('Translate hello to Spanish')).toBe(false);

    // Identity, model & AI meta questions (NEVER SEARCH)
    expect(service.needsLiveSearch('who are you?')).toBe(false);
    expect(service.needsLiveSearch('who are you ?')).toBe(false);
    expect(service.needsLiveSearch('Who are you')).toBe(false);
    expect(service.needsLiveSearch('what model are you?')).toBe(false);
    expect(service.needsLiveSearch('what model is this')).toBe(false);
    expect(service.needsLiveSearch('what is ai')).toBe(false);
    expect(service.needsLiveSearch('what ai is')).toBe(false);
    expect(service.needsLiveSearch('tell me about yourself')).toBe(false);
    expect(service.needsLiveSearch('who made you')).toBe(false);
    expect(service.needsLiveSearch('what can you do')).toBe(false);
  });

  it('should honor explicitForce override', () => {
    expect(service.needsLiveSearch('What is photosynthesis?', true)).toBe(true);
  });

  // ── Search Query Extraction Tests ──

  it('should extract focused query from structured Indian market prompt', () => {
    const structuredPrompt = `Web search STEP 1 — Data Collection (Run First, Daily After Indian Market Close)
Fetch today's official Indian market closing data using trusted live sources.
Primary Sources
NSE India
BSE India
NSE Indices
Moneycontrol
TradingView
Investing.com
Yahoo Finance
Gold & Silver Prices
Fetch today's India bullion prices from Goodreturns:
24 Carat Gold Price (₹ per 10 grams)
22 Carat Gold Price (₹ per 10 grams)
Silver Price (₹ per kg)
Collect the following data:
Market Indices
NIFTY 50
Current Value
Point Change
Percentage Change
SENSEX
Current Value
Point Change
Percentage Change
BANK NIFTY
Current Value
Point Change
Percentage Change
INDIA VIX
Current Value
Point Change
Percentage Change
Top Gainers (NIFTY 50)
Collect:
Rank
Company Name
Last Traded Price (₹)
% Gain
Top 5 only.
Top Losers (NIFTY 50)
FII Net Buy/Sell (₹ Crore)
DII Net Buy/Sell (₹ Crore)
Precious Metals
24 Carat Gold Price
Silver Price
Market Sentiment
Bullish Bearish Neutral
today`;

    const result = service.extractCleanSearchQuery(structuredPrompt);

    // Should NOT be "Data Collection" or the full raw prompt
    expect(result).not.toContain('Data Collection');
    expect(result).not.toContain('STEP 1');
    expect(result).not.toContain('Primary Sources');
    expect(result).not.toContain('Collect');

    // Should contain actual financial domain keywords
    expect(result.toLowerCase()).toMatch(/nifty|sensex|market/i);
    // Should be reasonably short (fits in search pill UI)
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.length).toBeGreaterThan(10);
  });

  it('should handle short direct search queries unchanged', () => {
    expect(service.extractCleanSearchQuery('NIFTY 50 today')).toBe('NIFTY 50 today');
    expect(service.extractCleanSearchQuery('weather in Tokyo')).toBe('weather in Tokyo');
    expect(service.extractCleanSearchQuery('bitcoin price')).toBe('bitcoin price');
  });

  it('should clean conversational prefixes from short queries', () => {
    expect(service.extractCleanSearchQuery('search for best laptops 2026')).toBe('best laptops 2026');
    expect(service.extractCleanSearchQuery('please search the web for AI news')).toBe('AI news');
    expect(service.extractCleanSearchQuery('google latest iPhone release')).toBe('latest iPhone release');
  });

  it('should extract weather-related query from structured prompt', () => {
    const weatherPrompt = `STEP 1: Data Fetching
Fetch the following weather data:
Temperature in Delhi
Humidity levels
Rainfall prediction today
Wind speed and direction
AQI (Air Quality Index)
Weather warnings if any
Collect:
Max Temperature
Min Temperature
Feels Like
UV Index`;

    const result = service.extractCleanSearchQuery(weatherPrompt);
    expect(result.toLowerCase()).toMatch(/weather|temperature|delhi/i);
    expect(result).not.toContain('STEP 1');
    expect(result).not.toContain('Data Fetching');
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('should extract crypto-related query from structured prompt', () => {
    const cryptoPrompt = `Web search: Crypto Market Analysis
Fetch the following:
- Bitcoin (BTC) current price
- Ethereum (ETH) current price
- Market cap data
- Top gainers today
- Trading volume 24h
Collect live data from CoinGecko, CoinMarketCap`;

    const result = service.extractCleanSearchQuery(cryptoPrompt);
    expect(result.toLowerCase()).toMatch(/bitcoin|btc|ethereum|crypto/i);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('should return empty string for empty input', () => {
    expect(service.extractCleanSearchQuery('')).toBe('');
    expect(service.extractCleanSearchQuery('   ')).toBe('');
  });

  it('should execute search and format results properly', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        query: 'latest tech news',
        answer: 'Major developments in AI chips and smart home devices.',
        results: [
          {
            title: 'TechCrunch News',
            url: 'https://techcrunch.com/article1',
            content: 'Summary of the recent launch event.',
          },
        ],
      }),
    } as any);

    const response = await service.search('latest tech news');
    expect(response.query).toBe('latest tech news');
    expect(response.answer).toContain('Major developments');
    expect(response.results.length).toBe(1);
    expect(response.results[0].title).toBe('TechCrunch News');
    expect(response.results[0].url).toBe('https://techcrunch.com/article1');
  });

  it('should dynamically budget web search between 3 and 15 results based on query importance', () => {
    // 1. Quick factual/volatile check -> Low priority (3 - 5 results, basic depth)
    const quickStrategy = service.determineSearchStrategy('Weather in Tokyo');
    expect(quickStrategy.priority).toBe('low');
    expect(quickStrategy.searchDepth).toBe('basic');
    expect(quickStrategy.maxResults).toBeGreaterThanOrEqual(3);
    expect(quickStrategy.maxResults).toBeLessThanOrEqual(5);

    // 2. Medium current event / announcement -> Medium priority (6 - 9 results, advanced depth)
    const mediumStrategy = service.determineSearchStrategy('Latest AI announcements today');
    expect(mediumStrategy.priority).toBe('medium');
    expect(mediumStrategy.searchDepth).toBe('advanced');
    expect(mediumStrategy.maxResults).toBeGreaterThanOrEqual(6);
    expect(mediumStrategy.maxResults).toBeLessThanOrEqual(9);

    // 3. Deep comparative research / quantum resources -> High priority (10 - 15 results, advanced depth)
    const deepStrategy = service.determineSearchStrategy(
      'Comprehensive comparison and suggested resources for quantum computing frameworks in 2026'
    );
    expect(deepStrategy.priority).toBe('high');
    expect(deepStrategy.searchDepth).toBe('advanced');
    expect(deepStrategy.maxResults).toBeGreaterThanOrEqual(10);
    expect(deepStrategy.maxResults).toBeLessThanOrEqual(15);
  });
});
