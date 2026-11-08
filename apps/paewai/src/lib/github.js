// A tiny client for the GitHub contents API, enough to keep one data file and an inbox folder in
// the person's own private repository. Uses a fine-grained token with "Contents: read and write"
// on that one repository. The token never leaves this device except in requests to api.github.com.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Thai message for what went wrong, for the sync status line. */
export function explain(err) {
  if (!err) return '';
  if (err.status === 401) return 'โทเคนใช้ไม่ได้หรือหมดอายุ สร้างใหม่แล้วเชื่อมอีกครั้ง';
  if (err.status === 403) return 'โทเคนนี้ไม่มีสิทธิ์เขียน repo นี้ (ต้องเลือก Contents: Read and write)';
  if (err.status === 404) return 'ไม่เจอ repo นี้ หรือโทเคนไม่ได้เลือก repo นี้ไว้';
  if (err.status === 429) return 'GitHub ขอให้รอสักครู่ แล้วจะลองใหม่เอง';
  if (err.status >= 500) return 'GitHub มีปัญหาชั่วคราว จะลองใหม่เอง';
  if (err.name === 'TypeError' || err.status === 0) return 'ต่อเน็ตไม่ได้ จะซิงก์ให้เมื่อออนไลน์';
  return err.message || 'ซิงก์ไม่สำเร็จ';
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export class GitHubRepo {
  /** @param {{ repo: string, token: string, fetch?: typeof fetch }} opts */
  constructor({ repo, token, fetch: f = globalThis.fetch.bind(globalThis) }) {
    this.repo = repo;
    this.token = token;
    this.fetch = f;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await this.fetch(`${API}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new GitHubError(0, err?.message || 'network');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(res.status, data?.message || `HTTP ${res.status}`);
    return data;
  }

  /** { private, canWrite, defaultBranch } */
  async info() {
    const r = await this.request('GET', `/repos/${this.repo}`);
    return { private: !!r.private, canWrite: r.permissions ? !!r.permissions.push : true, defaultBranch: r.default_branch, fullName: r.full_name };
  }

  /** The file's text and sha, or null when it does not exist. */
  async read(path) {
    try {
      const r = await this.request('GET', `/repos/${this.repo}/contents/${encodePath(path)}`);
      if (Array.isArray(r) || r.type !== 'file') throw new GitHubError(422, `${path} is not a file`);
      if (r.content && r.encoding === 'base64') return { sha: r.sha, text: fromBase64(r.content) };
      // Files over 1 MB come without content: fetch the blob.
      const blob = await this.request('GET', `/repos/${this.repo}/git/blobs/${r.sha}`);
      return { sha: r.sha, text: fromBase64(blob.content) };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /** Creates or replaces a file. `sha` must be the current one (null for a new file); 409/422 = someone wrote first. */
  async write(path, text, sha, message) {
    const r = await this.request('PUT', `/repos/${this.repo}/contents/${encodePath(path)}`, {
      message,
      content: toBase64(text),
      ...(sha ? { sha } : {}),
    });
    return { sha: r.content.sha };
  }

  /** Files in a folder ([] when there is no such folder). */
  async list(dir) {
    try {
      const r = await this.request('GET', `/repos/${this.repo}/contents/${encodePath(dir)}`);
      return Array.isArray(r) ? r.filter((e) => e.type === 'file').map((e) => ({ name: e.name, path: e.path, sha: e.sha, size: e.size })) : [];
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  /** Deletes a file; false when it was already gone or changed (another device took it). */
  async remove(path, sha, message) {
    try {
      await this.request('DELETE', `/repos/${this.repo}/contents/${encodePath(path)}`, { message, sha });
      return true;
    } catch (err) {
      if ([404, 409, 422].includes(err.status)) return false;
      throw err;
    }
  }
}

export const isConflict = (err) => err?.status === 409 || err?.status === 422;
