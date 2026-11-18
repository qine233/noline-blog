import type { CloudreveConfig, UploadInput, UploadResult } from './types.js';

// Cloudreve upload. Supports v3 (cookie session + chunked session upload) and
// v4 (bearer token + multipart). Returns the file's direct URL — the storage
// policy must allow direct links for the image to render in the blog.

function base(cfg: CloudreveConfig): string {
  return cfg.baseUrl.replace(/\/+$/, '');
}

// --- v4 ---

async function v4Login(cfg: CloudreveConfig): Promise<string> {
  const res = await fetch(`${base(cfg)}/api/v4/session/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (j.code !== 0 || !j.data?.access_token) {
    throw new Error(`Cloudreve v4 登录失败：${j.msg ?? res.status}`);
  }
  return j.data.access_token;
}

async function v4Upload(cfg: CloudreveConfig, input: UploadInput): Promise<UploadResult> {
  const token = await v4Login(cfg);
  const fd = new FormData();
  fd.append('file', new Blob([input.data as any], { type: input.mime }), input.name);
  fd.append('path', cfg.dir || '/');
  const res = await fetch(`${base(cfg)}/api/v4/file/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const j: any = await res.json().catch(() => ({}));
  if (j.code !== 0) throw new Error(`Cloudreve v4 上传失败：${j.msg ?? res.status}`);

  const file = j.data?.file ?? j.data;
  const id = file?.id ?? file?.file_id;
  if (!id) throw new Error('Cloudreve v4 上传未返回文件 id');

  const urlRes = await fetch(`${base(cfg)}/api/v4/file/url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [{ id }] }),
  });
  const uj: any = await urlRes.json().catch(() => ({}));
  const url = uj.data?.urls?.[0]?.url;
  if (!url) throw new Error('Cloudreve 未返回直链（请确认存储策略允许直链）');
  return { url };
}

// --- v3 ---

async function v3Login(cfg: CloudreveConfig): Promise<string> {
  const res = await fetch(`${base(cfg)}/api/v3/user/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: cfg.email, Password: cfg.password, captchaCode: '' }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (j.code !== 0) throw new Error(`Cloudreve v3 登录失败：${j.msg ?? res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/cloudreve-session=([^;]+)/);
  if (!m) throw new Error('Cloudreve v3 登录未返回会话 Cookie');
  return `cloudreve-session=${m[1]}`;
}

async function v3Upload(cfg: CloudreveConfig, input: UploadInput): Promise<UploadResult> {
  const cookie = await v3Login(cfg);
  const b = base(cfg);
  const jsonAuth = { 'Content-Type': 'application/json', Cookie: cookie };

  let policyId = cfg.policyId;
  if (!policyId) {
    const dres = await fetch(
      `${b}/api/v3/directory?path=${encodeURIComponent(cfg.dir || '/')}`,
      { headers: { Cookie: cookie } },
    );
    const dj: any = await dres.json().catch(() => ({}));
    policyId = dj.data?.policy?.id ?? '';
  }
  if (!policyId) throw new Error('Cloudreve 存储策略 id 未知（请在设置里填 policyId）');

  const create = await fetch(`${b}/api/v3/file/upload`, {
    method: 'POST',
    headers: jsonAuth,
    body: JSON.stringify({
      path: cfg.dir || '/',
      size: input.data.length,
      name: input.name,
      policy_id: policyId,
      last_modified: Date.now(),
      mime_type: input.mime,
    }),
  });
  const cj: any = await create.json().catch(() => ({}));
  if (cj.code !== 0) throw new Error(`Cloudreve 创建上传会话失败：${cj.msg ?? create.status}`);
  const sessionID = cj.data?.sessionID ?? cj.data?.session_id;
  const chunkSize = Number(cj.data?.chunkSize ?? cj.data?.chunk_size ?? input.data.length) || input.data.length;
  if (!sessionID) throw new Error('Cloudreve 未返回上传会话');

  const total = Math.max(1, Math.ceil(input.data.length / chunkSize));
  for (let i = 0; i < total; i++) {
    const chunk = input.data.subarray(
      i * chunkSize,
      Math.min((i + 1) * chunkSize, input.data.length),
    );
    const put = await fetch(`${b}/api/v3/file/upload/${sessionID}/${i}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
      body: chunk as any,
    });
    if (!put.ok) throw new Error(`Cloudreve 分块上传失败 #${i}：${put.status}`);
  }

  const fin = await fetch(`${b}/api/v3/file/upload/${sessionID}`, {
    headers: { Cookie: cookie },
  });
  const fj: any = await fin.json().catch(() => ({}));
  if (fj.code !== 0) throw new Error(`Cloudreve 完成上传失败：${fj.msg ?? fin.status}`);
  const fileId = fj.data?.id ?? fj.data?.file?.id;
  if (!fileId) throw new Error('Cloudreve 未返回文件 id');

  const urlRes = await fetch(`${b}/api/v3/file/url`, {
    method: 'POST',
    headers: jsonAuth,
    body: JSON.stringify({ uris: [{ id: fileId }] }),
  });
  const uj: any = await urlRes.json().catch(() => ({}));
  const url = uj.data?.urls?.[0]?.url;
  if (!url) throw new Error('Cloudreve 未返回直链（请确认存储策略允许直链）');
  return { url };
}

// --- dispatch ---

export async function cloudreveTest(cfg: CloudreveConfig): Promise<string> {
  if (cfg.apiVersion === 'v3') {
    await v3Login(cfg);
    return 'Cloudreve v3 登录成功';
  }
  await v4Login(cfg);
  return 'Cloudreve v4 登录成功';
}

export async function cloudreveUpload(
  cfg: CloudreveConfig,
  input: UploadInput,
): Promise<UploadResult> {
  return cfg.apiVersion === 'v3' ? v3Upload(cfg, input) : v4Upload(cfg, input);
}
