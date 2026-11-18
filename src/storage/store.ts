import { getSetting, setSetting } from '../db.js';
import type { StorageConfig } from './types.js';

const KEY = 'storage_config';

export function defaultStorageConfig(): StorageConfig {
  return {
    driver: 'none',
    onedrive: {
      tenant: 'common',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
      folder: 'Blog',
    },
    cloudreve: {
      apiVersion: 'v4',
      baseUrl: '',
      email: '',
      password: '',
      dir: '/',
      policyId: '',
    },
  };
}

export function getStorageConfig(): StorageConfig {
  let stored: any = {};
  try {
    const raw = getSetting(KEY);
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }
  const d = defaultStorageConfig();
  return {
    driver: stored.driver ?? d.driver,
    onedrive: { ...d.onedrive, ...(stored.onedrive ?? {}) },
    cloudreve: { ...d.cloudreve, ...(stored.cloudreve ?? {}) },
  };
}

export function setStorageConfig(cfg: StorageConfig): void {
  setSetting(KEY, JSON.stringify(cfg));
}
