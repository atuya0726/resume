import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { decryptProfile, encryptProfile } from '../src/crypto.ts';
import { emptyProfile, parseProfile } from '../src/profile.ts';
import { basicInfoFrom, resumeContentFrom, encryptedBasicInfo, needsCompanyEncryption, profileWithContent, restoreProfile, parseBasicInfo, parseResumeContent } from '../src/profile-storage.ts';
import { moveEntry, removeEntry } from '../src/editor-model.ts';

const sample = parseProfile(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
const content = resumeContentFrom(sample);

test('new encrypted files include company names and combine with content that omits them', async () => {
  const encrypted = await encryptProfile(encryptedBasicInfo(sample), 'dummy');
  const plaintext = await decryptProfile(encrypted, 'dummy');
  const saved = JSON.parse(plaintext);
  assert.deepEqual(parseBasicInfo(JSON.stringify(saved.basicInfo)), basicInfoFrom(sample));
  for (const key of Object.keys(content)) assert.equal(key in saved.basicInfo, false);
  assert.equal(saved.basicInfo.careerCompanies[sample.career[0].id!], sample.career[0].company);
  assert.equal('company' in content.career[0], false);
  assert.equal(JSON.stringify(content).includes(sample.career[0].company), false);
  assert.equal(plaintext.includes(sample.qualifications[0].description), false);
  assert.deepEqual(restoreProfile(plaintext, content), sample);
});

test('old encrypted profiles preserve their own content during migration', () => {
  assert.deepEqual(restoreProfile(JSON.stringify(sample), resumeContentFrom(emptyProfile())), sample);
});

test('direct edits to an existing document JSON take priority over legacy encrypted content', () => {
  const updated = { ...content, summary: '架空の更新した要約', qualifications: [{ period: '2020年4月', description: '架空の新しい資格 合格' }], career: content.career.map((job) => ({ ...job, role: '架空の更新した職種' })) };
  const restored = restoreProfile(JSON.stringify(sample), updated, true);
  assert.equal(restored.summary, updated.summary);
  assert.deepEqual(restored.qualifications, updated.qualifications);
  assert.equal(restored.career[0].role, '架空の更新した職種');
  assert.deepEqual(basicInfoFrom(restored), basicInfoFrom(sample));
  assert.deepEqual(restoreProfile(JSON.stringify(sample), resumeContentFrom(emptyProfile()), true).qualifications, []);
});

test('public content discards basic information even if pasted into its editor', () => {
  const value = parseResumeContent(JSON.stringify(sample));
  assert.deepEqual(resumeContentFrom(profileWithContent(value)), content);
  assert.equal('name' in value, false);
  assert.equal('address' in value, false);
  assert.equal('phone' in value, false);
  assert.deepEqual(parseBasicInfo(JSON.stringify(sample)), { ...basicInfoFrom(sample), careerCompanies: {} });
});

test('invalid split files and unsupported versions fail without echoing their contents', () => {
  assert.throws(() => parseBasicInfo('{"name":1}'), /name/);
  assert.throws(() => parseResumeContent('{"skills":1}'), /skills/);
  assert.throws(() => restoreProfile('{"format":"local-resume/basic-info","version":3}', content), /対応していない/);
  assert.throws(() => parseResumeContent('{"PRIVATE_DUMMY_MARKER"'), (error: Error) => !error.message.includes('PRIVATE_DUMMY_MARKER'));
});

test('nullable and omitted basic fields save encrypted and restore as empty editable values', async () => {
  const basic = parseBasicInfo('{"name":null,"email":null,"photo":null,"careerCompanies":null}');
  assert.equal(basic.name, '');
  assert.equal(basic.email, '');
  assert.equal(basic.photo, undefined);
  assert.deepEqual(basic.careerCompanies, {});
  assert.equal(parseBasicInfo('{}').birthday, '');
  assert.equal(parseBasicInfo('null').address, '');
  const nullableContent = parseResumeContent('{"education":null,"career":null,"qualifications":null,"skills":null,"summary":null}');
  assert.deepEqual(nullableContent.career, []);
  assert.equal(nullableContent.summary, '');
  const profile = profileWithContent(nullableContent, basic);
  const encrypted = await encryptProfile(encryptedBasicInfo(profile), 'dummy');
  const plaintext = await decryptProfile(encrypted, 'dummy');
  assert.equal(JSON.parse(plaintext).basicInfo.name, null);
  assert.deepEqual(restoreProfile(plaintext, nullableContent), profile);
});

test('company IDs preserve names across career reordering and deletion', () => {
  const profile = parseProfile(JSON.stringify({ ...sample, career: [sample.career[0], { ...sample.career[0], id: 'second-job', company: '架空の第二会社' }] }));
  const plaintext = encryptedBasicInfo(profile);
  const reordered = moveEntry(profile, 'career', 1, -1);
  const restored = restoreProfile(plaintext, resumeContentFrom(reordered));
  assert.deepEqual(restored.career.map((job) => job.company), ['架空の第二会社', sample.career[0].company]);
  const removed = removeEntry(reordered, 'career', 0);
  assert.equal(restoreProfile(plaintext, resumeContentFrom(removed)).career[0].company, sample.career[0].company);
});

test('legacy plaintext company names survive until the encrypted migration has succeeded', () => {
  const legacyContent = parseResumeContent(JSON.stringify(sample));
  const { careerCompanies: _companies, ...basic } = basicInfoFrom(sample);
  const legacyPlaintext = JSON.stringify({ format: 'local-resume/basic-info', version: 1, basicInfo: basic });
  assert.equal(needsCompanyEncryption(legacyPlaintext, legacyContent), true);
  const restored = restoreProfile(legacyPlaintext, legacyContent);
  assert.equal(restored.career[0].company, sample.career[0].company);
  const migrated = encryptedBasicInfo(restored);
  assert.equal(needsCompanyEncryption(migrated, legacyContent), false);
  assert.deepEqual(restoreProfile(migrated, resumeContentFrom(restored)), restored);
  const cleared = parseProfile(JSON.stringify({ ...restored, career: [{ ...restored.career[0], company: null }] }));
  assert.equal(restoreProfile(encryptedBasicInfo(cleared), legacyContent).career[0].company, '', 'an encrypted null must override the old company name');
});
