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
