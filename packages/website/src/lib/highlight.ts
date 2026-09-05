/**
 * Orthogonal intents (maintained 2026-09-06; original user request: 新增
 * ./opentray 官网站点):
 * 1. Tiny deterministic tokenizer for the site's readonly code surfaces —
 *    deliberately NOT shiki: the site ships short samples and the jixoai
 *    visual law only needs comment/string/keyword/number tints that follow
 *    the theme tokens.
 * 2. Output is stable across server prerender and client hydration, so
 *    `{@html}` never mismatches (unipty www precedent, 2026-08-20).
 */

const KEYWORDS: Record<string, string> = {
  ts: 'import|from|export|const|let|var|await|async|for|of|in|if|else|break|continue|new|return|function|type|interface|true|false|null|undefined|void',
  js: 'import|from|export|const|let|var|await|async|function|return|true|false|null|undefined',
  json: 'true|false|null',
  sh: '',
};

const escapeCode = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code: string, lang: string): string {
  const escaped = escapeCode(code);
  const keywords = KEYWORDS[lang] ?? KEYWORDS.ts;
  const parts = [
    '(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1: comments
    '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)', // 2: strings
  ];
  if (keywords) parts.push(`\\b(${keywords})\\b`); // 3: keywords
  parts.push('\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b'); // 4: numbers
  const re = new RegExp(parts.join('|'), 'g');
  return escaped.replace(re, (match, comment, str, kw, num) => {
    if (comment !== undefined) return `<span class="tok-comment">${match}</span>`;
    if (str !== undefined) return `<span class="tok-string">${match}</span>`;
    if (kw !== undefined) return `<span class="tok-keyword">${match}</span>`;
    if (num !== undefined) return `<span class="tok-number">${match}</span>`;
    return match;
  });
}
