import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptProfile, encryptProfile, parseEncrypted } from '../src/crypto.ts';

const password = 'dummy-test-password-2026';
const text = JSON.stringify({ name: '架空の検証氏名', description: '日本語\n改行・記号 < > & 😀' });

test('Japanese data round-trips; saved JSON does not contain plaintext', async () => {
  const encrypted = await encryptProfile(text, password);
  const stored = JSON.stringify(encrypted);
  assert.equal(stored.includes('架空の検証氏名'), false);
  assert.equal(stored.includes(password), false);
  assert.equal(await decryptProfile(parseEncrypted(stored), password), text);
});

test('each encryption uses a fresh salt and IV', async () => {
  const first = await encryptProfile(text, password);
  const second = await encryptProfile(text, password);
  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('wrong password and modified ciphertext are rejected', async () => {
  const encrypted = await encryptProfile(text, password);
  await assert.rejects(decryptProfile(encrypted, 'another-test-password'), /復号できません/);
  const modified = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
  modified[0] ^= 1;
  encrypted.ciphertext = btoa(String.fromCharCode(...modified));
  await assert.rejects(decryptProfile(encrypted, password), /復号できません/);
});

test('corrupt format and excessive KDF work are rejected before derivation', async () => {
  assert.throws(() => parseEncrypted('{'), /壊れた/);
  const encrypted = await encryptProfile(text, password);
  assert.throws(() => parseEncrypted(JSON.stringify({ ...encrypted, iv: 'AAAA' })), /壊れた/);
  const invalid = { ...encrypted, kdf: { ...encrypted.kdf, iterations: 2_000_001 } };
  await assert.rejects(decryptProfile(invalid, password), /壊れた/);
});

test('short passwords round-trip while empty and oversized passwords are rejected', async () => {
  const encrypted = await encryptProfile(text, 'a');
  assert.equal(await decryptProfile(encrypted, 'a'), text);
  await assert.rejects(encryptProfile(text, ''), /入力してください/);
  await assert.rejects(encryptProfile(text, 'a'.repeat(1025)), /長すぎます/);
});
