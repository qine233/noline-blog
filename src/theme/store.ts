import { getSetting, setSetting } from '../db.js';
import { getThemeMeta, isValidThemeDir, listThemes } from './loader.js';

// Active theme + per-theme config live in the settings table, so they survive
// restarts and switching themes never loses the other theme's saved values.

const ACTIVE_KEY = 'active_theme';
const configKey = (dir: string) => `theme_config:${dir}`;

export function getActiveTheme(): string {
  const saved = getSetting(ACTIVE_KEY);
  if (saved && isValidThemeDir(saved) && getThemeMeta(saved)) return saved;
  return listThemes()[0]?.dir ?? 'default';
}

export function setActiveTheme(dir: string): boolean {
  if (!getThemeMeta(dir)) return false;
  setSetting(ACTIVE_KEY, dir);
  return true;
}

export function getThemeConfig(dir: string): Record<string, string> {
  const meta = getThemeMeta(dir);
  let stored: Record<string, unknown> = {};
  try {
    const raw = getSetting(configKey(dir));
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }

  const result: Record<string, string> = {};
  for (const f of meta?.config ?? []) {
    const v = stored[f.key];
    result[f.key] = v === undefined || v === null ? f.default : String(v);
  }
  // Keep any extra keys that are no longer in the schema.
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in result)) result[k] = String(v);
  }
  return result;
}

export function setThemeConfig(dir: string, values: Record<string, string>): void {
  setSetting(configKey(dir), JSON.stringify(values));
}
