import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// A single SQLite file holds all data. No DB server, no ORM — plain SQL below.
const DATA_DIR = path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'blog.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Lightweight migration: add columns that an older DB predates.
function ensurePostColumns(): void {
  const cols = (
    db.prepare('PRAGMA table_info(posts)').all() as { name: string }[]
  ).map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${ddl}`);
  };
  add('category', "TEXT NOT NULL DEFAULT ''");
  add('tags', "TEXT NOT NULL DEFAULT ''");
  add('cover', "TEXT NOT NULL DEFAULT ''");
  add('views', 'INTEGER NOT NULL DEFAULT 0');
}
ensurePostColumns();

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string;
  cover: string;
  views: number;
  created_at: string;
  updated_at: string;
  comment_count?: number;
}

export interface Comment {
  id: number;
  post_id: number;
  author: string;
  content: string;
  created_at: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
}

export interface RecentComment {
  author: string;
  content: string;
  created_at: string;
  post_slug: string;
  post_title: string;
}

export interface ListPostsOptions {
  limit?: number;
  offset?: number;
  q?: string;
  category?: string;
}

function buildWhere(opts: { q?: string; category?: string }): {
  sql: string;
  params: (string | number)[];
} {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like);
  }
  if (opts.category) {
    where.push('p.category = ?');
    params.push(opts.category);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Lists include per-post comment count; supports paging / search / category.
export function listPosts(opts: ListPostsOptions = {}): Post[] {
  const { sql: whereSql, params } = buildWhere(opts);
  const limit = opts.limit ?? 1000;
  const offset = opts.offset ?? 0;
  const sql = `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
     FROM posts p ${whereSql}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, limit, offset) as unknown as Post[];
}

export function countPosts(opts: { q?: string; category?: string } = {}): number {
  const { sql: whereSql, params } = buildWhere(opts);
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM posts p ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;
}

export function listCategories(): { name: string; count: number }[] {
  return db
    .prepare(
      "SELECT category AS name, COUNT(*) AS count FROM posts WHERE category <> '' GROUP BY category ORDER BY count DESC, name",
    )
    .all() as unknown as { name: string; count: number }[];
}

export function listTags(limit = 30): { name: string; count: number }[] {
  const rows = db
    .prepare("SELECT tags FROM posts WHERE tags <> ''")
    .all() as { tags: string }[];
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tags.split(/[,，]/)) {
      const k = t.trim();
      if (k) map.set(k, (map.get(k) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function incrementViews(id: number): void {
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id);
}

export function getPostBySlug(slug: string): Post | undefined {
  return db.prepare('SELECT * FROM posts WHERE slug = ?').get(slug) as
    | Post
    | undefined;
}

export function getPostById(id: number): Post | undefined {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as
    | Post
    | undefined;
}

// prev = earlier post, next = later post (by created_at then id).
export function adjacentPosts(post: {
  id: number;
  created_at: string;
}): { prev?: Post; next?: Post } {
  const prev = db
    .prepare(
      `SELECT * FROM posts
       WHERE (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(post.created_at, post.created_at, post.id) as Post | undefined;
  const next = db
    .prepare(
      `SELECT * FROM posts
       WHERE (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
    .get(post.created_at, post.created_at, post.id) as Post | undefined;
  return { prev, next };
}

// Same category first; falls back to most recent when the post has no category.
export function relatedPosts(
  post: { id: number; category: string },
  limit = 3,
): Post[] {
  if (post.category) {
    return db
      .prepare(
        `SELECT * FROM posts WHERE id <> ? AND category = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(post.id, post.category, limit) as unknown as Post[];
  }
  return db
    .prepare(
      `SELECT * FROM posts WHERE id <> ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(post.id, limit) as unknown as Post[];
}

export function createPost(
  title: string,
  slug: string,
  content: string,
  category = '',
  tags = '',
  cover = '',
): number {
  const r = db
    .prepare(
      'INSERT INTO posts (title, slug, content, category, tags, cover) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(title, slug, content, category, tags, cover);
  return Number(r.lastInsertRowid);
}

export function updatePost(
  id: number,
  title: string,
  slug: string,
  content: string,
  category = '',
  tags = '',
  cover = '',
): void {
  db.prepare(
    "UPDATE posts SET title = ?, slug = ?, content = ?, category = ?, tags = ?, cover = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(title, slug, content, category, tags, cover, id);
}

export function deletePost(id: number): void {
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

export function listComments(postId: number): Comment[] {
  return db
    .prepare(
      'SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC, id ASC',
    )
    .all(postId) as unknown as Comment[];
}

export function createComment(
  postId: number,
  author: string,
  content: string,
): void {
  db.prepare('INSERT INTO comments (post_id, author, content) VALUES (?, ?, ?)').run(
    postId,
    author,
    content,
  );
}

export function listRecentComments(limit = 5): RecentComment[] {
  return db
    .prepare(
      `SELECT c.author, c.content, c.created_at, p.slug AS post_slug, p.title AS post_title
       FROM comments c JOIN posts p ON p.id = c.post_id
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as RecentComment[];
}

export function getUserByUsername(username: string): User | undefined {
  return db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as User | undefined;
}

export function createUser(username: string, passwordHash: string): void {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    username,
    passwordHash,
  );
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function countComments(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM comments').get() as { c: number })
    .c;
}

export function earliestPostCreated(): string | undefined {
  const row = db.prepare('SELECT MIN(created_at) AS m FROM posts').get() as {
    m: string | null;
  };
  return row?.m ?? undefined;
}

// Insertion helpers for the Typecho importer: allow an explicit created_at
// and de-duplicate the slug so re-imports never collide.
export function importPost(p: {
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string;
  created_at: string;
}): number {
  let slug = p.slug;
  if (getPostBySlug(slug)) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
  const r = db
    .prepare(
      'INSERT INTO posts (title, slug, content, category, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(p.title, slug, p.content, p.category, p.tags, p.created_at, p.created_at);
  return Number(r.lastInsertRowid);
}

export function importComment(
  postId: number,
  author: string,
  content: string,
  createdAt: string,
): void {
  db.prepare(
    'INSERT INTO comments (post_id, author, content, created_at) VALUES (?, ?, ?, ?)',
  ).run(postId, author, content, createdAt);
}
