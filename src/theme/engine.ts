import { escapeHtml } from '../lib/escape.js';

// A small Handlebars-like template engine, written by hand so every step is
// visible. Supported syntax:
//   {{name}}            -> interpolate (HTML-escaped)
//   {{{name}}}          -> interpolate raw HTML
//   {{a.b.c}}           -> dotted paths, resolved against the current item
//                          then outward through parent contexts
//   {{#if x}} ... {{else}} ... {{/if}}
//   {{#each xs}} ... {{else}} ... {{/each}}
// Inside `each`, the item is the current context; {{this.x}} and {{x}} both work.
// {{> partial}} includes are expanded before compilation (see loader.ts).

type Chain = Array<unknown>;

type Section = {
  type: 'section';
  kind: 'if' | 'each';
  path: string;
  children: Node[];
  elseChildren: Node[];
};

type Node =
  | { type: 'text'; value: string }
  | { type: 'var'; path: string; raw: boolean }
  | Section;

export type TemplateFn = (data: Record<string, unknown>) => string;

const TOKEN = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;

export function compile(src: string): TemplateFn {
  const root: Node[] = [];
  const stack: Array<{ nodes: Node[]; section?: Section }> = [{ nodes: root }];
  const push = (n: Node) => stack[stack.length - 1].nodes.push(n);

  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;

  while ((m = TOKEN.exec(src))) {
    if (m.index > last) push({ type: 'text', value: src.slice(last, m.index) });
    last = TOKEN.lastIndex;

    // Triple-brace raw interpolation.
    if (m[1] !== undefined) {
      push({ type: 'var', path: m[1].trim(), raw: true });
      continue;
    }

    const inner = (m[2] ?? '').trim();
    if (inner.startsWith('#each ')) {
      const sec: Section = {
        type: 'section',
        kind: 'each',
        path: inner.slice(6).trim(),
        children: [],
        elseChildren: [],
      };
      push(sec);
      stack.push({ nodes: sec.children, section: sec });
    } else if (inner.startsWith('#if ')) {
      const sec: Section = {
        type: 'section',
        kind: 'if',
        path: inner.slice(4).trim(),
        children: [],
        elseChildren: [],
      };
      push(sec);
      stack.push({ nodes: sec.children, section: sec });
    } else if (inner === 'else') {
      const frame = stack[stack.length - 1];
      if (frame.section) frame.nodes = frame.section.elseChildren;
    } else if (inner === '/each' || inner === '/if') {
      if (stack.length > 1) stack.pop();
    } else {
      push({ type: 'var', path: inner, raw: false });
    }
  }

  if (last < src.length) push({ type: 'text', value: src.slice(last) });

  return (data) => renderNodes(root, [data]);
}

function renderNodes(nodes: Node[], chain: Chain): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') {
      out += n.value;
    } else if (n.type === 'var') {
      const v = resolve(n.path, chain);
      const s = v == null ? '' : String(v);
      out += n.raw ? s : escapeHtml(s);
    } else if (n.kind === 'if') {
      out += truthy(resolve(n.path, chain))
        ? renderNodes(n.children, chain)
        : renderNodes(n.elseChildren, chain);
    } else {
      const v = resolve(n.path, chain);
      if (Array.isArray(v) && v.length) {
        for (const item of v) out += renderNodes(n.children, [item, ...chain]);
      } else {
        out += renderNodes(n.elseChildren, chain);
      }
    }
  }
  return out;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  // Theme config values arrive as strings; treat "false" as falsy so
  // checkbox fields work naturally in templates.
  if (v === 'false') return false;
  return Boolean(v);
}

function resolve(pathStr: string, chain: Chain): unknown {
  let segs = pathStr.split('.').map((s) => s.trim()).filter(Boolean);
  if (segs[0] === 'this') segs = segs.slice(1);
  if (segs.length === 0) return chain[0];

  for (const ctx of chain) {
    if (
      ctx !== null &&
      typeof ctx === 'object' &&
      Object.prototype.hasOwnProperty.call(ctx, segs[0])
    ) {
      let v: any = ctx;
      for (const s of segs) {
        if (v == null) return undefined;
        v = v[s];
      }
      return v;
    }
  }
  return undefined;
}
