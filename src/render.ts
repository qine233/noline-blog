import { escapeHtml } from './lib/escape.js';

export const BLOG_TITLE = '我的博客';

// Shared page chrome. Every route calls this with its own body HTML, so all
// pages get the same header/footer and stylesheet for free.
export function layout(
  title: string,
  bodyHtml: string,
  opts?: { authed?: boolean },
): string {
  const nav = opts?.authed
    ? `<a href="/">首页</a><a href="/admin">文章</a><a href="/admin/themes">主题</a><a href="/admin/plugins">插件</a><a href="/admin/import">导入</a><form method="post" action="/admin/logout" class="inline"><button type="submit">退出</button></form>`
    : `<a href="/">首页</a>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <div class="inner-wrap">
    <a class="brand" href="/">${escapeHtml(BLOG_TITLE)}</a>
    <nav>${nav}</nav>
  </div>
</header>
<main class="container">
${bodyHtml}
</main>
<footer class="site-footer">手写轮子的博客引擎 · Node + Hono + SQLite</footer>
</body>
</html>`;
}
