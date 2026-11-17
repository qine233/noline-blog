import { escapeHtml } from '../lib/escape.js';
import {
  countComments,
  countPosts,
  earliestPostCreated,
  listCategories,
  listRecentComments,
  listTags,
} from '../db.js';
import { getTemplate } from './loader.js';
import { getActiveTheme, getThemeConfig } from './store.js';

export interface RenderedPost {
  title: string;
  slug: string;
  url: string;
  date: string;
  excerpt: string;
  content: string; // already-rendered HTML
  commentCount?: number;
  readMinutes?: number;
  category?: string;
  cover?: string;
  views?: number;
  tags?: string[];
}

export interface RenderedComment {
  author: string;
  content: string;
  date: string;
}

export interface RelatedItem {
  title: string;
  url: string;
  date: string;
  cover: string;
}

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '66, 90, 239';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function runningDays(): number {
  const earliest = earliestPostCreated();
  if (!earliest) return 0;
  const t = Date.parse(earliest.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function commonData(): Record<string, unknown> {
  const dir = getActiveTheme();
  const config = getThemeConfig(dir);

  const recentComments = listRecentComments(5).map((c) => ({
    author: c.author,
    excerpt: c.content.length > 46 ? c.content.slice(0, 46) + '…' : c.content,
    url: `/post/${encodeURIComponent(c.post_slug)}#comments`,
    postTitle: c.post_title,
    date: c.created_at.slice(0, 10),
  }));

  const categories = listCategories();

  return {
    site: {
      title: config.site_title || '我的博客',
      tagline: config.tagline || '',
    },
    config,
    accentRgb: hexToRgb(config.accent || '#425aef'),
    categories,
    tags: listTags(30),
    stats: {
      postCount: countPosts(),
      commentCount: countComments(),
      categoryCount: categories.length,
      days: runningDays(),
    },
    recentComments,
    year: new Date().getFullYear(),
    authed: false,
  };
}

export function renderTemplate(
  name: string,
  input: Record<string, unknown> = {},
): string {
  const dir = getActiveTheme();
  const tpl = getTemplate(dir, name);
  if (!tpl) {
    return renderMessage('模板缺失', `主题「${dir}」缺少 ${name}.html`);
  }
  return tpl({ ...commonData(), ...input });
}

export function renderIndex(input: {
  posts: RenderedPost[];
  authed: boolean;
  page: number;
  totalPages: number;
  q: string;
  category: string;
}): string {
  const { page, totalPages, q, category } = input;
  const listUrl = (opts: { page?: number; category?: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('s', q);
    if (opts.category) params.set('cat', opts.category);
    if (opts.page && opts.page > 1) params.set('page', String(opts.page));
    const s = params.toString();
    return s ? `/?${s}` : '/';
  };
  const pages = Array.from({ length: totalPages }, (_, i) => ({
    n: i + 1,
    current: i + 1 === page,
    url: listUrl({ page: i + 1 }),
  }));
  const catNav = listCategories().map((c) => ({
    name: c.name,
    count: c.count,
    active: c.name === category,
    url: listUrl({ category: c.name }),
  }));
  const archiveTitle = q
    ? `搜索「${q}」`
    : category
      ? `分类「${category}」`
      : '';
  return renderTemplate('index', {
    ...input,
    pages,
    catNav,
    archiveTitle,
    showPager: totalPages > 1,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevUrl: listUrl({ page: page - 1 }),
    nextUrl: listUrl({ page: page + 1 }),
  });
}

export function renderPost(input: {
  post: RenderedPost;
  comments: RenderedComment[];
  authed: boolean;
  prev?: { title: string; url: string };
  next?: { title: string; url: string };
  related: RelatedItem[];
}): string {
  return renderTemplate('post', input);
}

export function renderMessage(title: string, message: string): string {
  const dir = getActiveTheme();
  const config = getThemeConfig(dir);
  const siteTitle = config.site_title || '我的博客';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/theme.css">
<style>:root{--accent:${escapeHtml(config.accent || '#425aef')};}</style>
</head>
<body>
<main class="wrap" style="padding:80px 24px;text-align:center">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="/">← 返回 ${escapeHtml(siteTitle)}</a></p>
</main>
</body>
</html>`;
}
