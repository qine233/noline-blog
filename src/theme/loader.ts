import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { compile, type TemplateFn } from './engine.js';

const THEMES_DIR = path.join(process.cwd(), 'themes');

export type FieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'number'
  | 'checkbox'
  | 'select';

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  default: string;
  options: { value: string; label: string }[];
  help: string;
}

export interface ThemeMeta {
  name: string;
  version: string;
  author: string;
  description: string;
  config: ConfigField[];
}

export interface ThemeInfo {
  dir: string;
  meta: ThemeMeta;
}

// A theme dir is a bare folder name — never a path. This guards against
// path traversal coming in from route params.
export function isValidThemeDir(dir: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(dir);
}

export function listThemes(): ThemeInfo[] {
  if (!existsSync(THEMES_DIR)) return [];
  const out: ThemeInfo[] = [];
  for (const dir of readdirSync(THEMES_DIR)) {
    if (!isValidThemeDir(dir)) continue;
    const full = path.join(THEMES_DIR, dir);
    if (!statSync(full).isDirectory()) continue;
    if (!existsSync(path.join(full, 'theme.json'))) continue;
    out.push({ dir, meta: loadMeta(dir) });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function getThemeMeta(dir: string): ThemeMeta | null {
  if (!isValidThemeDir(dir)) return null;
  const full = path.join(THEMES_DIR, dir);
  if (!existsSync(path.join(full, 'theme.json'))) return null;
  return loadMeta(dir);
}

function loadMeta(dir: string): ThemeMeta {
  const full = path.join(THEMES_DIR, dir, 'theme.json');
  let raw: any = {};
  try {
    raw = JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    raw = {};
  }
  const config: ConfigField[] = Array.isArray(raw.config)
    ? raw.config
        .filter((f: any) => f && typeof f.key === 'string')
        .map((f: any) => normalizeField(f))
    : [];
  return {
    name: str(raw.name, dir),
    version: str(raw.version, '0.0.0'),
    author: str(raw.author, '未知'),
    description: str(raw.description, ''),
    config,
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
  const type = allowed.includes(f.type) ? (f.type as FieldType) : 'text';
  return {
    key: String(f.key),
    label: str(f.label, String(f.key)),
    type,
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

// Templates are read and compiled on each request (they are tiny), so editing
// a theme file or an included partial is reflected immediately in dev.
export function getTemplate(dir: string, name: string): TemplateFn | null {
  if (!isValidThemeDir(dir)) return null;
  const full = path.join(THEMES_DIR, dir, `${name}.html`);
  if (!existsSync(full)) return null;
  let src = readFileSync(full, 'utf8');
  src = expandIncludes(src, path.join(THEMES_DIR, dir), new Set([name]));
  return compile(src);
}

function expandIncludes(src: string, dirPath: string, seen: Set<string>): string {
  return src.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_m, name: string) => {
    if (seen.has(name)) return '';
    seen.add(name);
    const p = path.join(dirPath, `${name}.html`);
    if (!existsSync(p)) return '';
    return expandIncludes(readFileSync(p, 'utf8'), dirPath, seen);
  });
}
