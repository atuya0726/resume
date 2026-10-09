import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parseEncrypted } from '../src/crypto.ts';
import { parseResumeContent, profileWithContent, resumeContentFrom } from '../src/profile-storage.ts';
import { validateProfile } from '../src/validation.ts';

const prefix = '/__local-resume/save/';
const files = new Set(['profile.enc.json', 'resume-content.json']);
const readableFiles = files;
const maxBytes = 2_000_000;
class SaveError extends Error {
  status: number;
  constructor(status: number) { super('保存リクエストを処理できませんでした。'); this.status = status; }
}

function localRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return false;
  if (request.headers.origin !== `http://${host}`) return false;
  const site = request.headers['sec-fetch-site'];
  return (!site || site === 'same-origin') && request.headers['x-local-resume'] === '1';
}

async function readBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length']) > maxBytes) { request.resume(); throw new SaveError(413); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) { request.resume(); throw new SaveError(413); }
    chunks.push(buffer);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function checkedContents(name: string, body: string): string {
  if (name === 'profile.enc.json') return JSON.stringify(parseEncrypted(body), null, 2) + '\n';
  const content = parseResumeContent(body);
  const data = JSON.parse(body) as Record<string, unknown>;
  // Never persist identity fields, passwords or photos in the public content file.
  if (Object.keys(data ?? {}).some((key) => !Object.hasOwn(content, key)) || content.career.some((job) => job.company) || validateProfile(profileWithContent(content), 'content').length) throw new SaveError(400);
  return JSON.stringify(resumeContentFrom(profileWithContent(content)), null, 2) + '\n';
}

async function replaceFile(directory: string, name: string, contents: string) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.local-resume-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, name));
  } finally { await rm(temporary, { force: true }); }
}

export function localSaveMiddleware(publicDirectory: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = request.url ?? '';
    if (!url.startsWith(prefix)) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    const name = url.slice(prefix.length);
    const fail = (status: number) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: '保存できませんでした。入力内容とローカルサーバーを確認してください。' }));
    };
    if (!files.has(name)) { fail(404); return; }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); fail(405); return; }
    if (!localRequest(request)) { fail(403); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) { fail(415); return; }
    void (async () => {
      let contents: string;
      try { contents = checkedContents(name, await readBody(request)); }
      catch (cause) { fail(cause instanceof SaveError ? cause.status : 400); return; }
      try {
        await replaceFile(publicDirectory, name, contents);
        response.statusCode = 204; response.end();
      } catch { fail(500); }
    })();
  };
}

export function localSavePlugin(): Plugin {
  let publicDirectory = '';
  return {
    name: 'local-resume-save',
    configResolved(config) { publicDirectory = config.publicDir; },
    configureServer(server) { server.middlewares.use(localSaveMiddleware(publicDirectory)); },
    configurePreviewServer(server) {
      server.middlewares.use(localSaveMiddleware(publicDirectory));
      // Preview must load freshly saved public files rather than an older dist copy.
      server.middlewares.use(publicProfileMiddleware(publicDirectory));
    },
  };
}

export function publicProfileMiddleware(publicDirectory: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const name = (request.url ?? '').split('?')[0].slice(1);
    if (request.method !== 'GET' || !readableFiles.has(name)) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    void readFile(join(publicDirectory, name)).then((contents) => response.end(contents)).catch((cause: unknown) => {
      response.statusCode = typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT' ? 404 : 500;
      response.end();
    });
  };
}
