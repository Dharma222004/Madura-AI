/**
 * Preprocesses markdown text before passing to ReactMarkdown:
 * 1. Protects currency amounts ($500, $125 billion, $10.50, $1,000, etc.) from being
 *    falsely parsed as LaTeX inline math delimiters by remark-math.
 * 2. Leaves double dollars ($$ ... $$) for display math untouched.
 * 3. Leaves genuine inline math ($x = 5$, $\alpha$, $\frac{1}{2}$) untouched.
 * 4. Preserves code blocks (```...```) and inline code (`...`) completely untouched.
 */
export function formatMarkdownContent(text: string): string {
  if (!text) return text;

  // Split by code blocks (fenced ```...``` and inline `...`)
  const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/g);

  return parts
    .map((part, index) => {
      // Odd indices are code fences or inline code - preserve verbatim
      if (index % 2 === 1) return part;

      // Escape currency dollar signs: a single '$' followed by digits (e.g. $500, $125, $10.99, $1,000, $50B, $20M)
      // We check that it is NOT preceded by another '$' (so $$ display math is safe)
      return part.replace(
        /(^|[^\$])\$\s*(\d+(?:[.,]\d+)*(?:\s*(?:billion|million|trillion|thousand|k|m|b|t|bn|[kmbt]))?)\b/gi,
        '$1\\$$$2'
      );
    })
    .join('');
}

