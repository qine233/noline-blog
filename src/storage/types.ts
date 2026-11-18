export interface UploadInput {
  name: string;
  data: Buffer;
  mime: string;
}

export interface UploadResult {
  url: string;
}

export interface OneDriveConfig {
  tenant: string; // 'common' | 'consumers' | 'organizations' | a tenant id
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folder: string;
}

export interface CloudreveConfig {
  apiVersion: 'v3' | 'v4';
  baseUrl: string;
  email: string;
  password: string;
  dir: string;
  policyId: string; // v3 only; optional (queried from the dir if empty)
}

export type StorageDriverName = 'none' | 'local' | 'onedrive' | 'cloudreve';

export interface StorageConfig {
  driver: StorageDriverName;
  onedrive: OneDriveConfig;
  cloudreve: CloudreveConfig;
}
