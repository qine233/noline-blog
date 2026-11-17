// Demo plugin: adds a /sitemap.xml route (routes extension).
// Route extensions are mounted at startup, so enable it and restart to apply.
export default {
  routes(app, ctx) {
    app.get('/sitemap.xml', (c) => {
      const origin = new URL(c.req.url).origin;
      const posts = ctx.api.listPosts({ limit: 1000 });
      const urls = posts
        .map(
          (p) =>
            `  <url><loc>${origin}/post/${encodeURIComponent(p.slug)}</loc></url>`,
        )
        .join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc></url>
${urls}
</urlset>`;
      return c.body(xml, 200, {
        'Content-Type': 'application/xml; charset=utf-8',
      });
    });
  },
};
