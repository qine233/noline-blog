// Demo plugin: injects an HTML line into every page (body hook) and
// listens for new comments (event). Disable it in /admin/plugins.
export default {
  hooks: {
    body(ctx) {
      const text = (ctx.config && ctx.config.text) || 'Hello from a plugin!';
      const esc = ctx.escape || ((s) => String(s));
      return `<div class="plugin-hello" style="text-align:center;padding:14px;color:rgba(54,54,54,.5);font-size:.85rem">${esc(text)}</div>`;
    },
  },
  events: {
    'comment:created'(data) {
      console.log(`[hello] new comment by ${data.author} on post #${data.postId}`);
    },
  },
};
