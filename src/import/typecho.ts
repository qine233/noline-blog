// Parse a Typecho mysqldump export and map it to this blog's model.
// Only standard mysqldump output is supported (INSERT ... VALUES with the
// tables typecho_contents / typecho_comments / typecho_metas /
// typecho_relationships). No MySQL server required.

export interface ImportedPost {
  cid: number;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string;
  createdAt: string;
}

export interface ImportedComment {
  cid: number; // post cid this comment belongs to
  author: string;
  content: string;
  createdAt: string;
}

export interface ParseResult {
  posts: ImportedPost[];
  comments: ImportedComment[];
}

type Row = Record<string, unknown>;
interface Table {
  columns: string[];
  rows: Row[];
}

export function parseTypechoDump(sql: string): ParseResult {
  const tables = parseDump(sql);
  const contents = tables.get('typecho_contents')?.rows ?? [];
  const comments = tables.get('typecho_comments')?.rows ?? [];
  const metas = tables.get('typecho_metas')?.rows ?? [];
  const rels = tables.get('typecho_relationships')?.rows ?? [];

  const metaById = new Map<number, { name: string; type: string }>();
  for (const m of metas) {
    metaById.set(Number(m.mid), {
      name: String(m.name ?? ''),
      type: String(m.type ?? ''),
    });
  }

  const postMetas = new Map<number, number[]>();
  for (const r of rels) {
    const cid = Number(r.cid);
    const mid = Number(r.mid);
    if (!postMetas.has(cid)) postMetas.set(cid, []);
    postMetas.get(cid)!.push(mid);
  }

  const posts: ImportedPost[] = [];
  const publishedCids = new Set<number>();
  for (const c of contents) {
    if (String(c.type) !== 'post') continue;
    if (String(c.status) !== 'publish') continue;
    const cid = Number(c.cid);
    publishedCids.add(cid);
    let slug = String(c.slug ?? '').trim();
    if (!/^[a-z0-9-]+$/i.test(slug)) slug = 'post-' + cid;
    const content = String(c.text ?? '').replace(/^\s*<!--markdown-->\s*/, '');
    const mids = postMetas.get(cid) ?? [];
    let category = '';
    const tags: string[] = [];
    for (const mid of mids) {
      const meta = metaById.get(mid);
      if (!meta) continue;
      if (meta.type === 'category' && !category) category = meta.name;
      else if (meta.type === 'tag') tags.push(meta.name);
    }
    posts.push({
      cid,
      title: String(c.title ?? '').trim() || '(无标题)',
      slug,
      content,
      category,
      tags: tags.join(','),
      createdAt: tsToDate(Number(c.created)),
    });
  }

  const outComments: ImportedComment[] = [];
  for (const cm of comments) {
    if (String(cm.status) !== 'approved') continue;
    const type = String(cm.type ?? 'comment');
    if (type !== 'comment') continue;
    const cid = Number(cm.cid);
    if (!publishedCids.has(cid)) continue;
    outComments.push({
      cid,
      author: String(cm.author ?? '').trim() || '匿名',
      content: String(cm.text ?? ''),
      createdAt: tsToDate(Number(cm.created)),
    });
  }

  return { posts, comments: outComments };
}

function tsToDate(ts: number): string {
  const ms = Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now();
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// --- SQL dump parsing -----------------------------------------------------

function parseDump(sql: string): Map<string, Table> {
  const tables = new Map<string, Table>();

  const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql))) {
    const table = m[1];
    const open = createRe.lastIndex - 1;
    const close = matchParen(sql, open);
    if (close < 0) continue;
    const body = sql.slice(open + 1, close);
    const cols: string[] = [];
    for (const line of body.split(/\r?\n/)) {
      const cm = line.match(/^\s*`([^`]+)`\s+/);
      if (cm) cols.push(cm[1]);
    }
    tables.set(table, { columns: cols, rows: [] });
    createRe.lastIndex = close + 1;
  }

  let idx = 0;
  for (;;) {
    const pos = sql.indexOf('INSERT INTO', idx);
    if (pos < 0) break;
    const end = findStatementEnd(sql, pos);
    const stmt = sql.slice(pos, end);
    idx = end + 1;

    const im = stmt.match(
      /^INSERT INTO\s+`?([a-zA-Z0-9_]+)`?\s*(?:\(([^)]*)\))?\s*VALUES\s*/is,
    );
    if (!im) continue;
    const table = im[1];
    let cols = im[2]
      ? im[2].split(',').map((c) => c.trim().replace(/^`|`$/g, ''))
      : tables.get(table)?.columns ?? [];
    let t = tables.get(table);
    if (!t) {
      t = { columns: cols, rows: [] };
      tables.set(table, t);
    }
    if (!cols.length) cols = t.columns;

    const tuples = parseTuples(stmt.slice(im[0].length));
    for (const vals of tuples) {
      const row: Row = {};
      cols.forEach((c, i) => {
        row[c] = vals[i] ?? null;
      });
      t.rows.push(row);
    }
  }

  return tables;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findStatementEnd(s: string, start: number): number {
  let quote = '';
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === ';') return i;
  }
  return s.length;
}

function parseTuples(s: string): unknown[][] {
  const rows: unknown[][] = [];
  let i = 0;
  const len = s.length;
  const skipWs = () => {
    while (i < len && /\s/.test(s[i])) i++;
  };

  for (;;) {
    skipWs();
    if (s[i] !== '(') break;
    i++;
    const vals: unknown[] = [];
    for (;;) {
      skipWs();
      const ch = s[i];
      if (ch === "'" || ch === '"') {
        const quote = ch;
        i++;
        let str = '';
        while (i < len) {
          const c = s[i];
          if (c === '\\') {
            str += unescapeChar(s[i + 1]);
            i += 2;
            continue;
          }
          if (c === quote) {
            if (s[i + 1] === quote) {
              str += quote;
              i += 2;
              continue;
            }
            i++;
            break;
          }
          str += c;
          i++;
        }
        vals.push(str);
      } else {
        let tok = '';
        while (i < len && s[i] !== ',' && s[i] !== ')') {
          tok += s[i];
          i++;
        }
        tok = tok.trim();
        if (/^null$/i.test(tok)) vals.push(null);
        else if (tok === '') vals.push('');
        else if (/^-?\d+(\.\d+)?$/.test(tok)) vals.push(Number(tok));
        else if (/^0x[0-9a-f]+$/i.test(tok)) vals.push(tok);
        else vals.push(tok);
      }
      skipWs();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ')') {
        i++;
        break;
      }
      break;
    }
    rows.push(vals);
    skipWs();
    if (s[i] === ',') {
      i++;
      continue;
    }
    break;
  }
  return rows;
}

function unescapeChar(c: string | undefined): string {
  if (c === undefined) return '';
  switch (c) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case '0': return '\0';
    case 'b': return '\b';
    case 'Z': return '\x1a';
    case '\\': return '\\';
    case "'": return "'";
    case '"': return '"';
    default: return c;
  }
}
