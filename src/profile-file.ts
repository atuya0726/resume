import { parseEncrypted } from './crypto.ts';
import { parseResumeContent } from './profile-storage.ts';

export const PROFILE_FILE_PATH = 'public/profile.enc.json';
export const CONTENT_FILE_PATH = 'public/resume-content.json';

export async function savePublicFile(name: 'profile.enc.json' | 'resume-content.json', contents: string, base = '/', request: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await request(`${base}__local-resume/save/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Resume': '1' },
      body: contents, mode: 'same-origin', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new Error('保存サーバーに接続できません。npm run dev で起動した画面から保存してください。'); }
  if (response.status !== 204) {
    if (response.status === 400 || response.status === 413) throw new Error('保存するデータの形式・サイズを確認してください。変更内容はまだ保存されていません。');
    if (response.status === 500) throw new Error('public/ に書き込めませんでした。フォルダの書き込み権限を確認してください。変更内容はまだ保存されていません。');
    throw new Error('保存用APIを利用できません。npm run dev でサーバーを起動し直してください。変更内容はまだ保存されていません。');
  }
}

async function loadFile(name: string, base: string, request: typeof fetch) {
  const response = await request(`${base}${name}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ファイルを取得できませんでした（HTTP ${response.status}）。`);
  const text = await response.text();
  // Vite may return the app's HTML for a missing file. Do not treat it as ciphertext.
  if (response.headers.get('content-type')?.includes('text/html') && /^\s*(?:<!doctype html|<html)/i.test(text)) return null;
  // Validate the contents; a valid JSON file may be served as text/plain.
  return text;
}

export async function loadEncryptedFile(base = '/', request: typeof fetch = fetch) {
  const text = await loadFile('profile.enc.json', base, request);
  return text === null ? null : parseEncrypted(text);
}

export async function loadResumeContent(base = '/', request: typeof fetch = fetch) {
  const text = await loadFile('resume-content.json', base, request);
  return text === null ? null : parseResumeContent(text);
}
