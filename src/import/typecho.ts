import { gunzipSync } from 'node:zlib';

// Parse a Typecho export. Supports:
//  - mysqldump .sql (CREATE TABLE + INSERT)
//  - Typecho backup .bin written as JSON (optionally gzip-compressed)
// The .bin format is what Typecho's admin backup produces: a JSON document
// (or gzip of one) holding contents / comments / metas / relationships.

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
  cid: number;
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

// Entry point: feed it raw file bytes or text; it sniffs the format.
export function parseTypechoFile(input: string | Uint8Array): ParseResult {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    const buf = Buffer.from(input);
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try {
        text = gunzipSync(buf).toString('utf8');
      } catch {
        text = buf.toString('utf8');
      }
    } else {
      text = buf.toString('utf8');
    }
  }
  text = text.replace(/^\uFEFF/, '');

  if (/CREATE\s+TABLE|INSERT\s+INTO/i.test(text)) {
    return parseTypechoDump(text);
  }

  const obj = tryParseJson(text);
  if (obj !== null) return parseTypechoJson(obj);

  throw new Error('Unrecognized Typecho export format');
}

// --- JSON (.bin) ----------------------------------------------------------

function tryParseJson(text: string): unknown | null {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const braceStart = t.indexOf('{');
  const braceEnd = t.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(t.slice(braceStart, braceEnd + 1));
    } catch {
      /* fall through */
    }
  }
  const arrStart = t.indexOf('[');
  const arrEnd = t.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return JSON.parse(t.slice(arrStart, arrEnd + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

function firstArray(obj: Record<string, unknown>, keys: string[]): Row[] | null {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v as Row[];
  }
  return null;
}

function parseTypechoJson(obj: unknown): ParseResult {
  if (Array.isArray(obj)) {
    const t = new Map<string, Table>();
    t.set('typecho_contents', { columns: [], rows: obj as Row[] });
    return mapTables(t);
  }
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Unrecognized JSON');
  }
  const root = obj as Record<string, unknown>;
  const t = new Map<string, Table>();
  const contents = firstArray(root, ['contents', 'posts', 'articles']);
  const comments = firstArray(root, ['comments']);
  const metas = firstArray(root, ['metas', 'categories', 'tags']);
  const rels = firstArray(root, ['relationships', 'relations', 'postMetas']);
  if (contents) t.set('typecho_contents', { columns: [], rows: contents });
  if (comments) t.set('typecho_comments', { columns: [], rows: comments });
  if (metas) t.set('typecho_metas', { columns: [], rows: metas });
  if (rels) t.set('typecho_relationships', { columns: [], rows: rels });
  return mapTables(t);
}

// --- SQL (mysqldump) ------------------------------------------------------

function parseTypechoDump(sql: string): ParseResult {
  return mapTables(parseDump(sql));
}

// --- mapping to this blog's model -----------------------------------------

function get(row: Row, names: string[]): unknown {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function createdAtOf(v: unknown): string {
  if (typeof v === 'number' && v > 0) return tsToDate(v);
  if (typeof v === 'string') {
    if (/^\d+$/.test(v.trim())) return tsToDate(Number(v));
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  }
  return tsToDate(NaN);
}

function mapTables(tables: Map<string, Table>): ParseResult {
  const contents = tables.get('typecho_contents')?.rows ?? [];
  const comments = tables.get('typecho_comments')?.rows ?? [];
  const metas = tables.get('typecho_metas')?.rows ?? [];
  const rels = tables.get('typecho_relationships')?.rows ?? [];

  const metaById = new Map<number, { name: string; type: string }>();
  for (const m of metas) {
    metaById.set(num(get(m, ['mid', 'id', 'metaId'])), {
      name: String(get(m, ['name', 'title', 'slug']) ?? ''),
      type: String(get(m, ['type', 'kind']) ?? ''),
    });
  }

  const postMetas = new Map<number, number[]>();
  for (const r of rels) {
    const cid = num(get(r, ['cid', 'postId', 'post_id']));
    const mid = num(get(r, ['mid', 'metaId', 'tagId', 'categoryId']));
    if (!postMetas.has(cid)) postMetas.set(cid, []);
    postMetas.get(cid)!.push(mid);
  }

  const posts: ImportedPost[] = [];
  const publishedCids = new Set<number>();
  for (const c of contents) {
    const type = String(get(c, ['type', 'postType']) ?? 'post');
    if (type && type !== 'post') continue;
    const status = String(get(c, ['status', 'state']) ?? 'publish');
    if (status && status !== 'publish') continue;

    const cid = num(get(c, ['cid', 'id', 'postId']));
    publishedCids.add(cid);

    let slug = String(get(c, ['slug', 'path', 'name']) ?? '').trim();
    if (!/^[a-z0-9-]+$/i.test(slug)) slug = 'post-' + cid;

    const content = String(get(c, ['text', 'content', 'body']) ?? '').replace(
      /^\s*<!--markdown-->\s*/,
      '',
    );

    const mids = postMetas.get(cid) ?? [];
    let category = '';
    const tags: string[] = [];
    for (const mid of mids) {
      const meta = metaById.get(mid);
      if (!meta) continue;
      if (meta.type === 'category' && !category) category = meta.name;
      else if (meta.type === 'tag') tags.push(meta.name);
    }

    // Some exports embed category/tags directly on the content row.
    if (!category) {
      const rc = get(c, ['category']);
      if (rc !== undefined) category = String(rc);
    }
    const rt = get(c, ['tags']);
    if (rt !== undefined) {
      if (Array.isArray(rt)) {
        for (const x of rt) tags.push(String(x));
      } else {
        tags.push(
          ...String(rt)
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
    }

    posts.push({
      cid,
      title: String(get(c, ['title', 'name']) ?? '').trim() || '(无标题)',
      slug,
      content,
      category,
      tags: Array.from(new Set(tags)).join(','),
      createdAt: createdAtOf(get(c, ['created', 'createdAt', 'date', 'time'])),
    });
  }

  const outComments: ImportedComment[] = [];
  for (const cm of comments) {
    const status = String(get(cm, ['status', 'state']) ?? 'approved');
    if (status !== 'approved') continue;
    const type = String(get(cm, ['type']) ?? 'comment');
    if (type !== 'comment') continue;
    const cid = num(get(cm, ['cid', 'postId', 'post_id']));
    if (publishedCids.size > 0 && !publishedCids.has(cid)) continue;
    outComments.push({
      cid,
      author: String(get(cm, ['author', 'name']) ?? '').trim() || '匿名',
      content: String(get(cm, ['text', 'content']) ?? ''),
      createdAt: createdAtOf(get(cm, ['created', 'createdAt', 'date', 'time'])),
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
