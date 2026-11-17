import { escapeHtml } from './escape.js';

// A tiny Markdown renderer, written by hand so the rendering pipeline is
// fully visible. Supports: headings, paragraphs, fenced code blocks,
// unordered/ordered lists, blockquotes, horizontal rules, and inline
// `code`, **bold**, *italic* and [links](https://...).
// All output is HTML-escaped first; only the constructs listed above are
// converted back into tags, so raw HTML in input is never emitted.

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out.push(
        `<${tag}>${list.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    // Fenced code block: ```lang ... ```
    const fence = raw.match(/^```(.*)$/);
    if (fence) {
      if (!inCode) {
        flushPara();
        flushList();
        inCode = true;
        codeLang = fence[1].trim();
        codeLines = [];
      } else {
        const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLang = '';
      }
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    // Headings
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }

    // Blockquote
    const q = raw.match(/^>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(q[1])}</blockquote>`);
      continue;
    }

    // Lists
    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      const text = (ul || ol)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(text);
      continue;
    }
    flushList();

    // Blank line ends a paragraph
    if (raw.trim() === '') {
      flushPara();
      continue;
    }

    para.push(raw.trim());
  }

  flushList();
  flushPara();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
}

function inline(s: string): string {
  // Pull inline code out first so it survives escaping untouched.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  // Links — http(s) only, so javascript: etc. can never become a link.
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Restore inline code.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => codes[Number(n)]);
  return s;
}
