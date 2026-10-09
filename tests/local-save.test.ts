import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { localSaveMiddleware, publicProfileMiddleware } from '../server/local-save.ts';
import { encryptProfile } from '../src/crypto.ts';
import { emptyProfile, parseProfile } from '../src/profile.ts';
import { encryptedBasicInfo, resumeContentFrom } from '../src/profile-storage.ts';

const content = resumeContentFrom(emptyProfile());
const encrypted = await encryptProfile(encryptedBasicInfo(emptyProfile()), 'dummy');
const headers = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json', 'x-local-resume': '1', 'sec-fetch-site': 'same-origin' };

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp('/private/tmp/resume-save-test-');
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function request(directory: string, body: string, options: { name?: string; method?: string; headers?: Record<string, string | undefined>; address?: string; chunks?: string[] } = {}): Promise<{ status: number; body: string; next?: boolean }> {
  return new Promise((resolve) => {
    const incoming = Object.assign(Readable.from(options.chunks ?? [body]), {
      url: `/__local-resume/save/${options.name ?? 'resume-content.json'}`, method: options.method ?? 'POST',
      headers: { ...headers, ...options.headers }, socket: { remoteAddress: options.address ?? '127.0.0.1' },
    }) as unknown as IncomingMessage;
    const response = {
      statusCode: 200,
      setHeader() {},
      end(value = '') { resolve({ status: response.statusCode, body: String(value) }); },
    };
    localSaveMiddleware(directory)(incoming, response as unknown as ServerResponse, () => resolve({ status: 0, body: '', next: true }));
  });
}

test('local saves create and replace exactly the two files, retaining the storage boundary', async () => {
  await fixture(async (root) => {
    const directory = join(root, 'public');
    assert.equal((await request(directory, JSON.stringify(content))).status, 204);
    const next = { ...content, notes: '架空の本人希望\n検証用の追記' };
    assert.equal((await request(directory, JSON.stringify(next))).status, 204);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8')), next);
    assert.equal((await request(directory, JSON.stringify(encrypted), { name: 'profile.enc.json' })).status, 204);
    const ciphertext = await readFile(join(directory, 'profile.enc.json'), 'utf8');
    assert.deepEqual(JSON.parse(ciphertext), encrypted);
    assert.equal(ciphertext.includes('basicInfo'), false);
    assert.deepEqual((await readdir(directory)).sort(), ['profile.enc.json', 'resume-content.json']);
  });
});

test('company and project content saves through the API and invalid project edits leave it intact', async () => {
  const sample = parseProfile(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
  const detailedContent = resumeContentFrom(sample);
  await fixture(async (directory) => {
    assert.equal((await request(directory, JSON.stringify(detailedContent))).status, 204);
    const saved = JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8'));
    assert.deepEqual(saved, detailedContent);
    assert.equal('name' in saved, false);
    const invalid = structuredClone(detailedContent);
    invalid.sharedProjects![0].period = '2025年3月〜2024年4月';
    assert.equal((await request(directory, JSON.stringify(invalid))).status, 400);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8')), detailedContent);
  });
});

test('invalid data and identity fields never replace existing document content', async () => {
  await fixture(async (directory) => {
    await request(directory, JSON.stringify(content));
    for (const body of ['{PRIVATE_DUMMY_MARKER', JSON.stringify({ ...content, name: 'PRIVATE_DUMMY_MARKER' }),
      JSON.stringify({ ...content, photo: 'PRIVATE_DUMMY_MARKER' }), JSON.stringify({ ...content, password: 'PRIVATE_DUMMY_MARKER' }),
      JSON.stringify({ ...content, education: [{ period: '2020年13月', description: '架空校 卒業' }] })]) {
      const result = await request(directory, body);
      assert.equal(result.status, 400);
      assert.equal(result.body.includes('PRIVATE_DUMMY_MARKER'), false);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8')), content);
    }
    assert.equal((await request(directory, JSON.stringify(emptyProfile()), { name: 'profile.enc.json' })).status, 400);
    assert.deepEqual(await readdir(directory), ['resume-content.json']);
  });
});

test('nullable fields and incomplete careers save without requiring names or dates', async () => {
  await fixture(async (directory) => {
    const nullable = { education: [{ period: null, description: '架空の学校' }], career: [{ id: 'dummy-job', company: null, period: null, role: null, description: '架空の業務', projects: [{ name: null, period: null, overview: '架空の概要' }] }], qualifications: null, skills: [null], summary: null, motivation: null, notes: null };
    assert.equal((await request(directory, JSON.stringify(nullable))).status, 204);
    const saved = JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8'));
    assert.equal('company' in saved.career[0], false);
    assert.equal(saved.career[0].description, '架空の業務');
    assert.equal(saved.sharedProjects[0].overview, '架空の概要');
    assert.equal(saved.education[0].period, '');
    assert.deepEqual(saved.skills, []);
    assert.equal((await request(directory, '{}')).status, 204);
    assert.equal((await request(directory, 'null')).status, 204);
  });
});

test('the public save API rejects a plaintext company name and leaves prior content intact', async () => {
  await fixture(async (directory) => {
    await request(directory, JSON.stringify(content));
    const body = { ...content, career: [{ id: 'dummy-job', company: 'PRIVATE_DUMMY_COMPANY', description: '架空の業務' }] };
    const result = await request(directory, JSON.stringify(body));
    assert.equal(result.status, 400);
    assert.equal(result.body.includes('PRIVATE_DUMMY_COMPANY'), false);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8')), content);
  });
});

test('shared projects with approximate years, improvement writing and activities persist locally', async () => {
  await fixture(async (directory) => {
    const next = { ...content, careerOverview: '架空の所属変更と継続案件', improvements: '架空の改善内容', activities: '架空の技術活動', sharedProjects: [{ name: '架空の案件', period: '2023年頃〜現在', tasks: '架空の担当業務', database: null }] };
    assert.equal((await request(directory, JSON.stringify(next))).status, 204);
    const saved = JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8'));
    assert.equal(saved.sharedProjects[0].period, '2023年頃〜現在');
    assert.equal(saved.sharedProjects[0].database, '');
    assert.equal(saved.improvements, next.improvements);
    assert.equal(saved.activities, next.activities);
    const invalid = { ...next, sharedProjects: [{ name: '架空の案件', period: '2024年頃〜2023年頃' }] };
    assert.equal((await request(directory, JSON.stringify(invalid))).status, 400);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'resume-content.json'), 'utf8')), saved);
    assert.equal((await request(directory, '{}', { name: 'unapproved.json' })).status, 404);
  });
});

test('only same-origin JSON POSTs from loopback can write the fixed filenames', async () => {
  await fixture(async (directory) => {
    for (const options of [
      { headers: { origin: 'https://example.invalid' } }, { headers: { origin: undefined } },
      { headers: { host: 'example.invalid', origin: 'http://example.invalid' } },
      { headers: { 'x-local-resume': undefined } }, { headers: { 'sec-fetch-site': 'cross-site' } },
      { address: '192.0.2.1' },
    ]) assert.equal((await request(directory, JSON.stringify(content), options)).status, 403);
    assert.equal((await request(directory, '{}', { method: 'GET' })).status, 405);
    assert.equal((await request(directory, '{}', { headers: { 'content-type': 'text/plain' } })).status, 415);
    for (const name of ['../outside.json', '%2e%2e%2foutside.json', 'extra.json', 'resume-content.json?path=../outside.json']) {
      assert.equal((await request(directory, '{}', { name })).status, 404);
    }
    assert.deepEqual(await readdir(directory), []);
  });
});

test('UTF-8 byte limits and declared oversized requests leave files untouched', async () => {
  await fixture(async (directory) => {
    assert.equal((await request(directory, '', { headers: { 'content-length': '2000001' } })).status, 413);
    assert.equal((await request(directory, '', { chunks: ['あ'.repeat(400_000), 'あ'.repeat(300_000)] })).status, 413);
    assert.deepEqual(await readdir(directory), []);
  });
});

test('filesystem errors return a safe failure without damaging existing data', async () => {
  await fixture(async (root) => {
    const invalidDirectory = join(root, 'public');
    await writeFile(invalidDirectory, 'FICTIONAL_EXISTING_FILE');
    const result = await request(invalidDirectory, JSON.stringify(content));
    assert.equal(result.status, 500);
    assert.equal(result.body.includes(root), false);
    assert.equal(await readFile(invalidDirectory, 'utf8'), 'FICTIONAL_EXISTING_FILE');
  });
});

test('preview serves the newly saved public file without caching a stale build copy', async () => {
  await fixture(async (directory) => {
    const get = (name: string) => new Promise<{ status: number; body: string }>((resolve) => {
      const incoming = { method: 'GET', url: `/${name}` } as IncomingMessage;
      const response = {
        statusCode: 200,
        setHeader(key: string, value: string) { if (key === 'Cache-Control') assert.equal(value, 'no-store'); },
        end(value = '') { resolve({ status: response.statusCode, body: String(value) }); },
      };
      publicProfileMiddleware(directory)(incoming, response as unknown as ServerResponse, () => resolve({ status: 0, body: '' }));
    });
    assert.equal((await get('profile.enc.json')).status, 404);
    await request(directory, JSON.stringify(content));
    assert.deepEqual(JSON.parse((await get('resume-content.json')).body), content);
    const next = { ...content, notes: '新しい架空の本人希望' };
    await request(directory, JSON.stringify(next));
    assert.deepEqual(JSON.parse((await get('resume-content.json')).body), next);
    assert.equal((await get('../outside.json')).status, 0);
  });
});
