import { describe, it, expect } from 'vitest';
import { formatMarkdownContent } from '../src/client/utils/markdown.js';

describe('formatMarkdownContent - Currency dollar escaping for LaTeX preservation', () => {
  it('escapes multiple currency amounts in paragraphs so text between them is not parsed as math', () => {
    const input = '• In the $500 billion platform, Nvidia is **not lending its own money**; the capital comes from third-party asset managers, though Nvidia has said it retains an option to backstop up to **$125 billion** of potential deals.';
    const output = formatMarkdownContent(input);
    expect(output).toContain('\\$500 billion');
    expect(output).toContain('**\\$125 billion**');
    expect(output).toContain('**not lending its own money**');
  });

  it('escapes simple currency amounts', () => {
    expect(formatMarkdownContent('Price is $10 to $20.')).toBe('Price is \\$10 to \\$20.');
    expect(formatMarkdownContent('Valuation: $1,000,000 and revenue is $500k.')).toBe('Valuation: \\$1,000,000 and revenue is \\$500k.');
    expect(formatMarkdownContent('Cost: $ 500 million.')).toBe('Cost: \\$500 million.');
    expect(formatMarkdownContent('Negative: -$500 and ($125)')).toBe('Negative: -\\$500 and (\\$125)');
  });

  it('preserves genuine LaTeX math expressions', () => {
    expect(formatMarkdownContent('Display math: $$E = mc^2$$')).toBe('Display math: $$E = mc^2$$');
    expect(formatMarkdownContent('Inline math: $x + y = z$')).toBe('Inline math: $x + y = z$');
    expect(formatMarkdownContent('Formula: $\\frac{a}{b}$')).toBe('Formula: $\\frac{a}{b}$');
  });

  it('preserves code blocks and inline code containing dollar signs', () => {
    const code = '```javascript\nconst x = "$500";\nconst y = "$125";\n```';
    expect(formatMarkdownContent(code)).toBe(code);
    expect(formatMarkdownContent('Check `$500` inline code')).toBe('Check `$500` inline code');
  });
});
