import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  createPost,
  createUser,
  deletePost,
  getPostById,
  getPostBySlug,
  getUserByUsername,
  importComment,
  importPost,
  listPosts,
  updatePost,
  userCount,
} from '../db.js';
import { parseTypechoDump } from '../import/typecho.js';
import type { Post } from '../db.js';
import {
  hashPassword,
  signSession,
  SESSION_COOKIE,
  verifyPassword,
  verifySession,
} from '../auth.js';
import { escapeHtml } from '../lib/escape.js';
import { layout } from '../render.js';
import {
  getActiveTheme,
  getThemeConfig,
  setActiveTheme,
  setThemeConfig,
} from '../theme/store.js';
import { getThemeMeta, listThemes } from '../theme/loader.js';
import type { ConfigField } from '../theme/loader.js';
import { getPlugin, listPlugins, reloadPlugins } from '../plugins/loader.js';
import {
  getPluginSettings,
  isPluginEnabled,
  setPluginEnabled,
  setPluginSettings,
} from '../plugins/store.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith('/admin')) return next();
  if (path === '/admin/login' || path === '/admin/setup' || path === '/admin/logout') {
    return next();
  }
  const token = getCookie(c, SESSION_COOKIE);
  const userId = token ? verifySession(token) : null;
  if (!userId) return c.redirect('/admin/login');
  c.set('userId', userId);
  await next();
});

function loginForm(error?: string): string {
  return `<h1>登录</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/login" class="auth-form">
  <label>用户名<input name="username" required autofocus></label>
  <label>密码<input name="password" type="password" required></label>
  <button type="submit">登录</button>
</form>`;
}

function setupForm(error?: string): string {
  return `<h1>初始化管理员</h1>
<p class="muted">这是第一次运行，先创建一个管理员账号。</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/admin/setup" class="auth-form">
  <label>用户名<input name="username" required autofocus></label>
  <label>密码<input name="password" type="password" required></label>
  <label>再输一次密码<input name="password2" type="password" required></label>
  <button type="submit">创建并登录</button>
</form>`;
}

interface PostDraft {
  title?: string;
  slug?: string;
  content?: string;
  category?: string;
  tags?: string;
  cover?: string;
}

function postForm(
  action: string,
  draft?: PostDraft,
  error?: string,
  isEdit = false,
): string {
  const title = draft?.title ?? '';
  const slug = draft?.slug ?? '';
  const content = draft?.content ?? '';
  const category = draft?.category ?? '';
  const tags = draft?.tags ?? '';
  const cover = draft?.cover ?? '';
  return `<h1>${isEdit ? '编辑文章' : '写文章'}</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${action}" class="editor-form">
  <label>标题<input name="title" required value="${escapeHtml(title)}"></label>
  <label>链接（英文，留空自动生成）<input name="slug" value="${escapeHtml(slug)}"></label>
  <label>分类<input name="category" value="${escapeHtml(category)}" placeholder="如：生活记录"></label>
  <label>标签（逗号分隔）<input name="tags" value="${escapeHtml(tags)}" placeholder="如：typecho, 主题"></label>
  <label>封面图地址（可选）<input name="cover" value="${escapeHtml(cover)}" placeholder="https://..."></label>
  <label>内容（Markdown）<textarea name="content" required rows="20">${escapeHtml(content)}</textarea></label>
  <button type="submit">保存</button>
</form>`;
}

function slugError(slug: string): string | null {
  if (!slug) return null;
  if (!/^[a-z0-9-]+$/.test(slug)) return '链接只能用小写字母、数字和横线';
  return null;
}

// --- login / logout ------------------------------------------------------

adminRoutes.get('/admin/login', (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && verifySession(token)) return c.redirect('/admin');
  return c.html(layout('登录', loginForm()));
});

adminRoutes.post('/admin/login', async (c) => {
  const form = await c.req.parseBody();
  const username = String(form.username ?? '').trim();
  const password = String(form.password ?? '');
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return c.html(layout('登录', loginForm('用户名或密码错误')), 401);
  }
  setCookie(c, SESSION_COOKIE, signSession(user.id), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return c.redirect('/admin');
});

adminRoutes.post('/admin/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/');
});

// --- first-run setup -----------------------------------------------------

adminRoutes.get('/admin/setup', (c) => {
  if (userCount() > 0) return c.redirect('/admin/login');
  return c.html(layout('初始化管理员', setupForm()));
});

adminRoutes.post('/admin/setup', async (c) => {
  if (userCount() > 0) return c.redirect('/admin/login');
  const form = await c.req.parseBody();
  const username = String(form.username ?? '').trim();
  const password = String(form.password ?? '');
  const password2 = String(form.password2 ?? '');
  if (!username || !password) {
    return c.html(layout('初始化管理员', setupForm('用户名和密码不能为空')), 400);
  }
  if (password !== password2) {
    return c.html(layout('初始化管理员', setupForm('两次密码不一致')), 400);
  }
  if (password.length < 6) {
    return c.html(layout('初始化管理员', setupForm('密码至少 6 位')), 400);
  }
  createUser(username, hashPassword(password));
  const user = getUserByUsername(username)!;
  setCookie(c, SESSION_COOKIE, signSession(user.id), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return c.redirect('/admin');
});

// --- dashboard -----------------------------------------------------------

adminRoutes.get('/admin', (c) => {
  const posts = listPosts();
  const rows = posts
    .map((p) => {
      const category = p.category
        ? escapeHtml(p.category)
        : '<span class="muted">—</span>';
      return `<tr>
  <td><a href="/post/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></td>
  <td>${category}</td>
  <td>${p.views}</td>
  <td>${escapeHtml(p.created_at)}</td>
  <td class="row-actions">
    <a href="/admin/post/${p.id}/edit">编辑</a>
    <form method="post" action="/admin/post/${p.id}/delete" class="inline">
      <button type="submit" class="danger" onclick="return confirm('确定删除这篇吗？评论也会一并删除。')">删除</button>
    </form>
  </td>
</tr>`;
    })
    .join('');
  const body = `<h1>文章管理</h1>
<a class="btn" href="/admin/post/new">＋ 写文章</a>
<table class="admin-table">
  <thead><tr><th>标题</th><th>分类</th><th>阅读</th><th>时间</th><th>操作</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty">还没有文章。</td></tr>'}</tbody>
</table>`;
  return c.html(layout('后台', body, { authed: true }));
});

// --- post CRUD -----------------------------------------------------------

adminRoutes.get('/admin/post/new', (c) =>
  c.html(layout('写文章', postForm('/admin/post/new'), { authed: true })),
);

adminRoutes.post('/admin/post/new', async (c) => {
  const form = await c.req.parseBody();
  const title = String(form.title ?? '').trim();
  const slugRaw = String(form.slug ?? '').trim().toLowerCase();
  const content = String(form.content ?? '');
  const category = String(form.category ?? '').trim();
  const tags = String(form.tags ?? '').trim();
  const cover = String(form.cover ?? '').trim();
  const draft: PostDraft = { title, slug: slugRaw, content, category, tags, cover };
  const slugErr = slugError(slugRaw);

  if (!title || !content.trim()) {
    return c.html(
      layout('写文章', postForm('/admin/post/new', draft, '标题和内容不能为空'), {
        authed: true,
      }),
      400,
    );
  }
  if (slugErr) {
    return c.html(
      layout('写文章', postForm('/admin/post/new', draft, slugErr), { authed: true }),
      400,
    );
  }
  const slug = slugRaw || 'post-' + Date.now().toString(36);
  if (getPostBySlug(slug)) {
    return c.html(
      layout('写文章', postForm('/admin/post/new', draft, '这个链接已存在'), {
        authed: true,
      }),
      400,
    );
  }
  createPost(title, slug, content, category, tags, cover);
  return c.redirect(`/post/${encodeURIComponent(slug)}`);
});

adminRoutes.get('/admin/post/:id/edit', (c) => {
  const id = Number(c.req.param('id'));
  const post = getPostById(id);
  if (!post) return c.redirect('/admin');
  return c.html(
    layout('编辑文章', postForm(`/admin/post/${id}/edit`, post, undefined, true), {
      authed: true,
    }),
  );
});

adminRoutes.post('/admin/post/:id/edit', async (c) => {
  const id = Number(c.req.param('id'));
  const post = getPostById(id);
  if (!post) return c.redirect('/admin');

  const form = await c.req.parseBody();
  const title = String(form.title ?? '').trim();
  const slugRaw = String(form.slug ?? '').trim().toLowerCase();
  const content = String(form.content ?? '');
  const category = String(form.category ?? '').trim();
  const tags = String(form.tags ?? '').trim();
  const cover = String(form.cover ?? '').trim();
  const draft: PostDraft = { title, slug: slugRaw, content, category, tags, cover };
  const slugErr = slugError(slugRaw);
  const renderError = (err: string) =>
    c.html(
      layout('编辑文章', postForm(`/admin/post/${id}/edit`, draft, err, true), {
        authed: true,
      }),
      400,
    );

  if (!title || !content.trim()) return renderError('标题和内容不能为空');
  if (slugErr) return renderError(slugErr);
  const slug = slugRaw || 'post-' + Date.now().toString(36);
  const existing = getPostBySlug(slug);
  if (existing && existing.id !== id) return renderError('这个链接已存在');

  updatePost(id, title, slug, content, category, tags, cover);
  return c.redirect(`/post/${encodeURIComponent(slug)}`);
});

adminRoutes.post('/admin/post/:id/delete', (c) => {
  const id = Number(c.req.param('id'));
  deletePost(id);
  return c.redirect('/admin');
});

// --- themes -------------------------------------------------------------

function renderField(f: ConfigField, value: string): string {
  const name = escapeHtml(f.key);
  const label = escapeHtml(f.label);
  const help = f.help
    ? `<small class="field-help">${escapeHtml(f.help)}</small>`
    : '';

  switch (f.type) {
    case 'textarea':
      return `<label>${label}<textarea name="${name}" rows="3">${escapeHtml(value)}</textarea></label>${help}`;
    case 'checkbox':
      return `<label class="check"><input type="checkbox" name="${name}"${value === 'true' ? ' checked' : ''}> ${label}</label>${help}`;
    case 'color':
      return `<label>${label}<input type="color" name="${name}" value="${escapeHtml(value || '#000000')}"></label>${help}`;
    case 'number':
      return `<label>${label}<input type="number" name="${name}" value="${escapeHtml(value)}"></label>${help}`;
    case 'select': {
      const opts = f.options
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
        )
        .join('');
      return `<label>${label}<select name="${name}">${opts}</select></label>${help}`;
    }
    default:
      return `<label>${label}<input type="text" name="${name}" value="${escapeHtml(value)}"></label>${help}`;
  }
}

adminRoutes.get('/admin/themes', (c) => {
  const themes = listThemes();
  const active = getActiveTheme();
  const activeMeta = getThemeMeta(active);
  const config = getThemeConfig(active);

  const cards =
    themes
      .map((t) => {
        const isActive = t.dir === active;
        const action = isActive
          ? '<span class="badge-active">使用中</span>'
          : `<form method="post" action="/admin/themes/${encodeURIComponent(t.dir)}/activate" class="inline"><button type="submit">启用</button></form>`;
        return `<div class="theme-card${isActive ? ' active' : ''}">
  <div class="theme-head"><h3>${escapeHtml(t.meta.name)}</h3>${action}</div>
  <p class="theme-meta">${escapeHtml(t.dir)} · v${escapeHtml(t.meta.version)} · ${escapeHtml(t.meta.author)}</p>
  <p class="theme-desc">${escapeHtml(t.meta.description)}</p>
</div>`;
      })
      .join('') || '<p class="empty">themes/ 目录下没有主题。</p>';

  const fields =
    (activeMeta?.config ?? [])
      .map((f) => renderField(f, config[f.key] ?? f.default))
      .join('') || '<p class="muted">这个主题没有可配置项。</p>';

  const body = `<h1>主题管理</h1>
<p class="muted">已安装 ${themes.length} 个主题，当前使用「${escapeHtml(activeMeta?.name ?? active)}」。</p>
<div class="theme-grid">${cards}</div>
<h2>主题设置 · ${escapeHtml(activeMeta?.name ?? active)}</h2>
<form method="post" action="/admin/themes/${encodeURIComponent(active)}/config" class="auth-form">
  ${fields}
  <button type="submit">保存设置</button>
</form>`;
  return c.html(layout('主题管理', body, { authed: true }));
});

adminRoutes.post('/admin/themes/:dir/activate', (c) => {
  setActiveTheme(c.req.param('dir'));
  return c.redirect('/admin/themes');
});

adminRoutes.post('/admin/themes/:dir/config', async (c) => {
  const dir = c.req.param('dir');
  const meta = getThemeMeta(dir);
  if (!meta) return c.redirect('/admin/themes');
  const form = await c.req.parseBody();
  const values: Record<string, string> = {};
  for (const f of meta.config) {
    if (f.type === 'checkbox') {
      values[f.key] = form[f.key] ? 'true' : 'false';
    } else {
      const v = form[f.key];
      values[f.key] = v === undefined || v === null ? '' : String(v);
    }
  }
  setThemeConfig(dir, values);
  return c.redirect('/admin/themes');
});

// --- plugins ------------------------------------------------------------

adminRoutes.get('/admin/plugins', (c) => {
  const plugins = listPlugins();
  const cards =
    plugins
      .map((p) => {
        const on = isPluginEnabled(p.dir);
        const config = getPluginSettings(p.dir, p.meta.settings);
        const action = on
          ? `<form method="post" action="/admin/plugins/${encodeURIComponent(p.dir)}/toggle" class="inline"><button type="submit" class="danger">停用</button></form>`
          : `<form method="post" action="/admin/plugins/${encodeURIComponent(p.dir)}/toggle" class="inline"><button type="submit">启用</button></form>`;
        const fields = on
          ? `<form method="post" action="/admin/plugins/${encodeURIComponent(p.dir)}/config" class="plugin-config">${
              p.meta.settings.map((f) => renderField(f, config[f.key] ?? f.default)).join('') ||
              '<p class="muted">无配置项</p>'
            }<button type="submit">保存设置</button></form>`
          : '';
        return `<div class="theme-card${on ? ' active' : ''}">
  <div class="theme-head"><h3>${escapeHtml(p.meta.name)}${on ? ' <span class="badge-active">运行中</span>' : ''}</h3>${action}</div>
  <p class="theme-meta">${escapeHtml(p.dir)} · v${escapeHtml(p.meta.version)} · ${escapeHtml(p.meta.author)}</p>
  <p class="theme-desc">${escapeHtml(p.meta.description)}</p>
  ${fields}
</div>`;
      })
      .join('') || '<p class="empty">plugins/ 目录下没有插件。</p>';

  const body = `<h1>插件管理</h1>
<p class="muted">已安装 ${plugins.length} 个插件。启用后钩子与事件立即生效；插件自定义路由需重启服务生效。</p>
<div class="theme-grid">${cards}</div>`;
  return c.html(layout('插件管理', body, { authed: true }));
});

adminRoutes.post('/admin/plugins/:dir/toggle', async (c) => {
  const dir = c.req.param('dir');
  const p = getPlugin(dir);
  if (!p) return c.redirect('/admin/plugins');
  setPluginEnabled(dir, !isPluginEnabled(dir));
  await reloadPlugins();
  return c.redirect('/admin/plugins');
});

adminRoutes.post('/admin/plugins/:dir/config', async (c) => {
  const dir = c.req.param('dir');
  const p = getPlugin(dir);
  if (!p) return c.redirect('/admin/plugins');
  const form = await c.req.parseBody();
  const values: Record<string, string> = {};
  for (const f of p.meta.settings) {
    if (f.type === 'checkbox') values[f.key] = form[f.key] ? 'true' : 'false';
    else {
      const v = form[f.key];
      values[f.key] = v === undefined || v === null ? '' : String(v);
    }
  }
  setPluginSettings(dir, values);
  await reloadPlugins();
  return c.redirect('/admin/plugins');
});

// --- import -------------------------------------------------------------

adminRoutes.get('/admin/import', (c) => {
  const body = `<h1>导入 Typecho 数据</h1>
<p class="muted">上传用 <code>mysqldump</code> 导出的 .sql 文件，需包含 typecho_contents / typecho_comments / typecho_metas / typecho_relationships 表。将导入已发布文章（Markdown 正文）、分类、标签与已审核评论。</p>
<form method="post" action="/admin/import" enctype="multipart/form-data" class="auth-form">
  <label>Typecho 数据库导出（.sql）<input type="file" name="file" accept=".sql,text/plain,application/sql" required></label>
  <button type="submit">开始导入</button>
</form>
<p class="muted">导出命令：<code>mysqldump -u root -p 数据库名 &gt; typecho.sql</code></p>`;
  return c.html(layout('导入 Typecho', body, { authed: true }));
});

adminRoutes.post('/admin/import', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === 'string') {
    return c.html(
      layout('导入 Typecho', '<p class="error">请选择 .sql 文件</p><p><a href="/admin/import">返回</a></p>', { authed: true }),
      400,
    );
  }
  if (file.size > 40 * 1024 * 1024) {
    return c.html(
      layout('导入 Typecho', '<p class="error">文件过大（上限 40MB）</p><p><a href="/admin/import">返回</a></p>', { authed: true }),
      400,
    );
  }

  let parsed;
  try {
    parsed = parseTypechoDump(await file.text());
  } catch (err) {
    console.error('[import] parse failed', err);
    return c.html(
      layout('导入 Typecho', '<p class="error">解析失败，请确认这是 mysqldump 导出的 Typecho 数据库</p><p><a href="/admin/import">返回</a></p>', { authed: true }),
      400,
    );
  }

  const idMap = new Map<number, number>();
  let postCount = 0;
  for (const p of parsed.posts) {
    const id = importPost({
      title: p.title,
      slug: p.slug,
      content: p.content,
      category: p.category,
      tags: p.tags,
      created_at: p.createdAt,
    });
    idMap.set(p.cid, id);
    postCount++;
  }
  let commentCount = 0;
  for (const cm of parsed.comments) {
    const pid = idMap.get(cm.cid);
    if (!pid) continue;
    importComment(pid, cm.author, cm.content, cm.createdAt);
    commentCount++;
  }

  const catCount = parsed.posts.filter((p) => p.category).length;
  const tagCount = parsed.posts.reduce(
    (n, p) => n + (p.tags ? p.tags.split(',').length : 0),
    0,
  );
  const body = `<h1>导入完成</h1>
<div class="card card-widget"><div class="site-stats" style="grid-template-columns:repeat(4,1fr)">
  <span class="site-stat">文章<b>${postCount}</b></span>
  <span class="site-stat">评论<b>${commentCount}</b></span>
  <span class="site-stat">带分类<b>${catCount}</b></span>
  <span class="site-stat">标签<b>${tagCount}</b></span>
</div></div>
<p style="margin-top:1rem"><a class="btn" href="/">回到首页</a></p>`;
  return c.html(layout('导入完成', body, { authed: true }));
});
