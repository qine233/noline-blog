import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  adjacentPosts,
  countPosts,
  createComment,
  getPostBySlug,
  incrementViews,
  listComments,
  listPosts,
  relatedPosts,
} from '../db.js';
import type { Post } from '../db.js';
import type { AppEnv } from '../types.js';
import { SESSION_COOKIE, verifySession } from '../auth.js';
import { markdownToHtml } from '../lib/markdown.js';
import { getActiveTheme, getThemeConfig } from '../theme/store.js';
import { renderIndex, renderMessage, renderPost } from '../theme/render.js';
import type { RenderedComment, RenderedPost } from '../theme/render.js';

export const publicRoutes = new Hono<AppEnv>();
const PAGE_SIZE = 10;

function isAuthed(c: Context): boolean {
  const token = getCookie(c, SESSION_COOKIE);
  return Boolean(token && verifySession(token));
}

// SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" (UTC); show the date part.
function formatDate(s: string): string {
  return s.slice(0, 10);
}

function excerpt(md: string, len = 140): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? text.slice(0, len) + '…' : text;
}

function readMinutes(md: string): number {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, '')
    .replace(/[#>*_~`[\]()!-]/g, '')
    .replace(/\s+/g, '');
  return Math.max(1, Math.ceil(text.length / 350));
}

function splitTags(tags: string): string[] {
  return tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function postUrl(slug: string): string {
  return `/post/${encodeURIComponent(slug)}`;
}

function toCard(p: Post): RenderedPost {
  return {
    title: p.title,
    slug: p.slug,
    url: postUrl(p.slug),
    date: formatDate(p.created_at),
    excerpt: excerpt(p.content),
    content: '',
    commentCount: p.comment_count ?? 0,
    readMinutes: readMinutes(p.content),
    category: p.category || '',
    cover: p.cover || '',
    views: p.views,
    tags: splitTags(p.tags),
  };
}

publicRoutes.get('/', (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const q = (c.req.query('s') ?? '').trim();
  const category = (c.req.query('cat') ?? '').trim();
  const total = countPosts({ q, category });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const posts = listPosts({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    q,
    category,
  }).map(toCard);
  return c.html(
    renderIndex({ posts, authed: isAuthed(c), page, totalPages, q, category }),
  );
});

publicRoutes.get('/post/:slug', (c) => {
  const slug = c.req.param('slug');
  const post = getPostBySlug(slug);
  if (!post) {
    return c.html(renderMessage('未找到', '这篇文章不存在。'), 404);
  }
  incrementViews(post.id);

  const comments: RenderedComment[] = listComments(post.id).map((cm) => ({
    author: cm.author,
    content: cm.content,
    date: formatDate(cm.created_at),
  }));

  const adj = adjacentPosts(post);
  const rel = relatedPosts(post, 3);

  const rendered: RenderedPost = {
    title: post.title,
    slug: post.slug,
    url: postUrl(post.slug),
    date: formatDate(post.created_at),
    excerpt: '',
    content: markdownToHtml(post.content),
    commentCount: comments.length,
    readMinutes: readMinutes(post.content),
    category: post.category || '',
    cover: post.cover || '',
    views: post.views + 1,
    tags: splitTags(post.tags),
  };

  const prev = adj.prev
    ? { title: adj.prev.title, url: postUrl(adj.prev.slug) }
    : undefined;
  const next = adj.next
    ? { title: adj.next.title, url: postUrl(adj.next.slug) }
    : undefined;
  const related = rel.map((p) => ({
    title: p.title,
    url: postUrl(p.slug),
    date: formatDate(p.created_at),
    cover: p.cover || '',
  }));

  return c.html(
    renderPost({ post: rendered, comments, authed: isAuthed(c), prev, next, related }),
  );
});

publicRoutes.post('/post/:slug/comment', async (c) => {
  const slug = c.req.param('slug');
  const post = getPostBySlug(slug);
  if (!post) return c.redirect('/');
  const form = await c.req.parseBody();
  const author = String(form.author ?? '').trim().slice(0, 40);
  const content = String(form.content ?? '').trim().slice(0, 2000);
  if (!author || !content) {
    return c.redirect(`${postUrl(slug)}#comments`);
  }
  createComment(post.id, author, content);
  return c.redirect(`${postUrl(slug)}#comments`);
});

// --- RSS -----------------------------------------------------------------

function xmlEscape(s: string): string {
  return s.replace(/[&<>'"]/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case "'": return '&apos;';
      default: return '&quot;';
    }
  });
}

publicRoutes.get('/feed.xml', (c) => {
  const origin = new URL(c.req.url).origin;
  const posts = listPosts({ limit: 20 });
  const config = getThemeConfig(getActiveTheme());
  const title = config.site_title || '我的博客';

  const items = posts
    .map((p) => {
      const link = `${origin}${postUrl(p.slug)}`;
      const date = new Date(p.created_at.replace(' ', 'T') + 'Z').toUTCString();
      return `  <item>
    <title>${xmlEscape(p.title)}</title>
    <link>${xmlEscape(link)}</link>
    <guid>${xmlEscape(link)}</guid>
    <pubDate>${date}</pubDate>
    <description>${xmlEscape(excerpt(p.content, 200))}</description>
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${xmlEscape(title)}</title>
  <link>${origin}/</link>
  <description>${xmlEscape(config.tagline || title)}</description>
${items}
</channel>
</rss>`;

  return c.body(xml, 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
  });
});
