import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from './types.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { userCount } from './db.js';
import { layout } from './render.js';
import { getActiveTheme } from './theme/store.js';
import { reloadPlugins } from './plugins/loader.js';

const app = new Hono<AppEnv>();

app.route('/', publicRoutes);
app.route('/', adminRoutes);

// Load enabled plugins before serving; this also mounts their routes.
await reloadPlugins(app);

// Admin stylesheet is read once at startup; theme CSS is read per request so
// switching themes, or editing a theme, takes effect immediately.
const adminCss = readFileSync(
  path.join(process.cwd(), 'public', 'style.css'),
  'utf8',
);
app.get('/style.css', (c) =>
  c.text(adminCss, 200, { 'Content-Type': 'text/css; charset=utf-8' }),
);

app.get('/theme.css', (c) => {
  const dir = getActiveTheme();
  const file = path.join(process.cwd(), 'themes', dir, 'style.css');
  const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return c.text(body, 200, { 'Content-Type': 'text/css; charset=utf-8' });
});

app.get('/healthz', (c) => c.text('ok'));

app.notFound((c) =>
  c.html(layout('未找到', '<p class="empty">页面不存在。</p>'), 404),
);

// Turn a Node IncomingMessage into a standard Web Request so Hono's router
// can handle it. This is the only place where Node's http and the Web
// platform meet — everything else is plain Hono handlers.
function toRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  const method = req.method ?? 'GET';
  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = Readable.toWeb(req) as unknown as BodyInit;
  }
  return new Request(url, {
    method,
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const request = toRequest(req);
    const response = await app.fetch(request);

    res.statusCode = response.status;
    const cookies: string[] = [];
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'set-cookie') {
        cookies.push(value);
        return;
      }
      if (
        lower === 'content-length' ||
        lower === 'transfer-encoding' ||
        lower === 'connection'
      ) {
        return;
      }
      res.setHeader(key, value);
    });
    if (cookies.length) res.setHeader('set-cookie', cookies);

    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`Blog running at http://localhost:${PORT}`);
  if (userCount() === 0) {
    console.log('No admin user yet — open /admin/setup to create one.');
  }
});
