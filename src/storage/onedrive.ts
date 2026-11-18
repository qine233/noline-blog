import type { OneDriveConfig, UploadInput, UploadResult } from './types.js';

// Uploads to OneDrive via Microsoft Graph. Uses the refresh-token flow, so
// you register an app (Azure AD), authorize it once with Files.ReadWrite
// offline_access, and paste the refresh token here. Personal / consumer /
// org accounts all work — set `tenant` accordingly.

function safeName(name: string): string {
  return (
    name
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'image'
  );
}

async function getAccessToken(cfg: OneDriveConfig): Promise<string> {
  const tenant = cfg.tenant || 'common';
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    scope: 'Files.ReadWrite offline_access',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  if (!res.ok) {
    throw new Error(`OneDrive 令牌获取失败（${res.status}）：${(await res.text()).slice(0, 300)}`);
  }
  const j: any = await res.json();
  if (!j.access_token) {
    throw new Error('OneDrive 刷新令牌无效：' + JSON.stringify(j).slice(0, 300));
  }
  return j.access_token;
}

export async function onedriveTest(cfg: OneDriveConfig): Promise<string> {
  await getAccessToken(cfg);
  return 'OneDrive 令牌有效';
}

export async function onedriveUpload(
  cfg: OneDriveConfig,
  input: UploadInput,
): Promise<UploadResult> {
  const token = await getAccessToken(cfg);
  const folder = (cfg.folder || 'Blog').replace(/^\/+|\/+$/g, '');
  const name = safeName(input.name);
  const putUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(
    folder,
  )}/${encodeURIComponent(name)}:/content`;

  const put = await fetch(putUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': input.mime },
    body: input.data as any,
  });
  if (!put.ok) {
    throw new Error(`OneDrive 上传失败（${put.status}）：${(await put.text()).slice(0, 300)}`);
  }
  const item: any = await put.json();

  // Anonymous view link. OneDrive returns a sharing URL; it renders for
  // images in most browsers but is not a raw CDN link.
  const link = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/createLink`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
    },
  );
  if (!link.ok) {
    throw new Error(`OneDrive 创建分享链接失败（${link.status}）`);
  }
  const lj: any = await link.json();
  const url = lj.link?.webUrl ?? '';
  if (!url) throw new Error('OneDrive 未返回分享链接');
  return { url };
}
