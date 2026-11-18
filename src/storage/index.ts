import type { StorageConfig, UploadInput } from './types.js';
import { getStorageConfig, setStorageConfig } from './store.js';
import { localUpload } from './local.js';
import { onedriveTest, onedriveUpload } from './onedrive.js';
import { cloudreveTest, cloudreveUpload } from './cloudreve.js';

export { getStorageConfig, setStorageConfig } from './store.js';

export async function uploadFile(input: UploadInput): Promise<string> {
  const cfg = getStorageConfig();
  if (cfg.driver === 'local') return (await localUpload(input)).url;
  if (cfg.driver === 'onedrive') return (await onedriveUpload(cfg.onedrive, input)).url;
  if (cfg.driver === 'cloudreve') return (await cloudreveUpload(cfg.cloudreve, input)).url;
  throw new Error('未配置图片存储，请到后台「上传」设置');
}

export async function testStorage(cfg: StorageConfig): Promise<string> {
  if (cfg.driver === 'local') return '本地存储可用';
  if (cfg.driver === 'onedrive') return onedriveTest(cfg.onedrive);
  if (cfg.driver === 'cloudreve') return cloudreveTest(cfg.cloudreve);
  return '未选择存储';
}
