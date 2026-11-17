import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { listPosts } from '../db.js';
import { getPluginSettings, isPluginEnabled } from './store.js';
import type { ConfigField, FieldType, PluginMeta, PluginModule } from './types.js';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

export interface PluginInfo {
  dir: string;
  meta: PluginMeta;
  entry: string;
}

interface ActivePlugin {
  dir: string;
  meta: PluginMeta;
  module: PluginModule;
}

let active: ActivePlugin[] = [];

function isValidDir(dir: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(dir);
}

export function listPlugins(): PluginInfo[] {
  if (!existsSync(PLUGINS_DIR)) return [];
  const out: PluginInfo[] = [];
  for (const dir of readdirSync(PLUGINS_DIR)) {
    if (!isValidDir(dir)) continue;
    const full = path.join(PLUGINS_DIR, dir);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const metaPath = path.join(full, 'plugin.json');
    if (!existsSync(metaPath)) continue;
    const entry = ['index.mjs', 'index.js']
      .map((f) => path.join(full, f))
      .find((p) => existsSync(p));
    if (!entry) continue;
    out.push({ dir, meta: loadMeta(metaPath, dir), entry });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function getPlugin(dir: string): PluginInfo | undefined {
  return listPlugins().find((p) => p.dir === dir);
}

function loadMeta(metaPath: string, dir: string): PluginMeta {
  let raw: any = {};
  try {
    raw = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    raw = {};
  }
  const settings: ConfigField[] = Array.isArray(raw.settings)
    ? raw.settings
        .filter((f: any) => f && typeof f.key === 'string')
        .map((f: any) => normalizeField(f))
    : [];
  return {
    name: str(raw.name, dir),
    version: str(raw.version, '0.0.0'),
    author: str(raw.author, '未知'),
    description: str(raw.description, ''),
    settings,
  };
}

function normalizeField(f: any): ConfigField {
  const allowed: FieldType[] = [
    'text',
    'textarea',
    'color',
    'number',
    'checkbox',
    'select',
  ];
  return {
    key: String(f.key),
    label: str(f.label, String(f.key)),
    type: allowed.includes(f.type) ? (f.type as FieldType) : 'text',
    default: f.default === undefined ? '' : String(f.default),
    options: Array.isArray(f.options)
      ? f.options.map((o: any) => ({
          value: String(o.value ?? o),
          label: String(o.label ?? o.value ?? o),
        }))
      : [],
    help: str(f.help, ''),
  };
}

function str(v: unknown, fallback: string): string {
  return v === undefined || v === null ? fallback : String(v);
}

export function getActivePlugins(): { dir: string; meta: PluginMeta }[] {
  return active.map((p) => ({ dir: p.dir, meta: p.meta }));
}

// Load enabled plugins. Pass `app` at startup to mount their routes;
// leave it out on later reloads so routes are not mounted twice.
export async function reloadPlugins(app?: Hono<any>): Promise<void> {
  const loaded: ActivePlugin[] = [];
  for (const info of listPlugins()) {
    if (!isPluginEnabled(info.dir)) continue;
    try {
      const url = pathToFileURL(info.entry).href + '?v=' + Date.now();
      const mod: any = await import(url);
      const plugin: PluginModule = mod.default ?? mod;
      loaded.push({ dir: info.dir, meta: info.meta, module: plugin });
      if (app && typeof plugin.routes === 'function') {
        const sub = new Hono();
        plugin.routes(sub, { api: { listPosts } });
        app.route('/', sub);
      }
    } catch (err) {
      console.error('[plugin] failed to load', info.dir, err);
    }
  }
  active = loaded;
}

export function runHook(
  name: string,
  base: Record<string, unknown>,
): string {
  let out = '';
  for (const p of active) {
    const hook = p.module.hooks?.[name];
    if (typeof hook !== 'function') continue;
    try {
      const r = hook({
        ...base,
        plugin: { name: p.dir },
        config: getPluginSettings(p.dir, p.meta.settings),
      });
      if (typeof r === 'string') out += r;
    } catch (err) {
      console.error('[plugin hook]', p.dir, name, err);
    }
  }
  return out;
}

export function emitEvent(name: string, data: Record<string, unknown>): void {
  for (const p of active) {
    const fn = p.module.events?.[name];
    if (typeof fn !== 'function') continue;
    try {
      fn(data);
    } catch (err) {
      console.error('[plugin event]', p.dir, name, err);
    }
  }
}
