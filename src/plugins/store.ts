import { getSetting, setSetting } from '../db.js';
import type { ConfigField } from './types.js';

// Enable flag + per-plugin settings live in the settings table, so they
// survive restarts and disabling a plugin keeps its saved config.

const enabledKey = (dir: string) => `plugin_enabled:${dir}`;
const configKey = (dir: string) => `plugin_config:${dir}`;

export function isPluginEnabled(dir: string): boolean {
  return getSetting(enabledKey(dir)) === '1';
}

export function setPluginEnabled(dir: string, on: boolean): void {
  setSetting(enabledKey(dir), on ? '1' : '0');
}

export function getPluginSettings(
  dir: string,
  fields: ConfigField[],
): Record<string, string> {
  let stored: Record<string, unknown> = {};
  try {
    const raw = getSetting(configKey(dir));
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }
  const result: Record<string, string> = {};
  for (const f of fields) {
    const v = stored[f.key];
    result[f.key] = v === undefined || v === null ? f.default : String(v);
  }
  return result;
}

export function setPluginSettings(
  dir: string,
  values: Record<string, string>,
): void {
  setSetting(configKey(dir), JSON.stringify(values));
}
