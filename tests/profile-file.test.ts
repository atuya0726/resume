import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptProfile } from '../src/crypto.ts';
import { loadEncryptedFile, loadResumeContent, savePublicFile } from '../src/profile-file.ts';
import { resumeContentFrom } from '../src/profile-storage.ts';
import { emptyProfile } from '../src/profile.ts';

function respond(body: string, status = 200, type = 'application/json'): typeof fetch {
  return async () => new Response(body, { status, headers: { 'content-type': type } });
}

test('missing file and Vite HTML fallback are reported as missing', async () => {
  assert.equal(await loadEncryptedFile('/', respond('', 404)), null);
  assert.equal(await loadEncryptedFile('/', respond('<!doctype html><html></html>', 200, 'text/html')), null);
});

test('ciphertext loads without requiring the server to label it application/json', async () => {
  const dummy = await encryptProfile('{"name":"架空の検証"}', 'dummy');
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, '/local/profile.enc.json');
    assert.equal(options?.cache, 'no-store');
    return new Response(JSON.stringify(dummy), { headers: { 'content-type': 'text/plain' } });
  };
  assert.deepEqual(await loadEncryptedFile('/local/', request), dummy);
});

test('invalid files and server failures surface a useful error', async () => {
  await assert.rejects(loadEncryptedFile('/', respond('{}')), /壊れた/);
  await assert.rejects(loadEncryptedFile('/', respond('', 500)), /HTTP 500/);
  await assert.rejects(loadEncryptedFile('/', async () => { throw new Error('network unavailable'); }), /network unavailable/);
});

test('separate document content auto-loads and its absence is distinct from invalid JSON', async () => {
  const content = resumeContentFrom(emptyProfile());
  assert.deepEqual(await loadResumeContent('/', respond(JSON.stringify(content))), content);
  assert.equal(await loadResumeContent('/', respond('', 404)), null);
  assert.deepEqual((await loadResumeContent('/', respond('{}')))?.career, []);
  await assert.rejects(loadResumeContent('/', respond('{"skills":1}')), /skills/);
});

test('saving sends only the selected payload to the local API and requires its acknowledgement', async () => {
  const content = JSON.stringify(resumeContentFrom(emptyProfile()));
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, '/local/__local-resume/save/resume-content.json');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.body, content);
    assert.equal(options?.mode, 'same-origin');
    assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).get('x-local-resume'), '1');
    return new Response(null, { status: 204 });
  };
  await savePublicFile('resume-content.json', content, '/local/', request);
  for (const status of [200, 400, 403, 404, 413, 500]) {
    await assert.rejects(savePublicFile('resume-content.json', content, '/', respond('<html>PRIVATE_DUMMY_MARKER</html>', status)),
      (error: Error) => !error.message.includes('PRIVATE_DUMMY_MARKER'));
  }
  await assert.rejects(savePublicFile('resume-content.json', content, '/', async () => { throw new Error('PRIVATE_DUMMY_MARKER'); }), /保存サーバーに接続できません/);
});
