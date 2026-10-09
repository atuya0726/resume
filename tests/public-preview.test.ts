import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseProfile } from '../src/profile.ts';
import { publicPreviewProfile, contentForUnlock, restoreProfile, basicInfoFrom, encryptedBasicInfo, resumeContentFrom, needsCompanyEncryption } from '../src/profile-storage.ts';
import { applyEditor, editorSpec, moveEntry } from '../src/editor-model.ts';
import { profileForStorage } from '../src/validation.ts';

const base = parseProfile(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
const sample = { ...base, career: [...base.career, { ...base.career[0], id: 'dummy-preview-second', company: '架空の別会社', period: '2025年4月〜現在' }] };
const stored = resumeContentFrom(sample);

test('the public preview retains document content while hiding identity and legacy employer names', () => {
  const legacy = { ...stored, career: sample.career };
  const before = structuredClone(legacy);
  const preview = publicPreviewProfile(legacy);
  assert.deepEqual(resumeContentFrom(preview), stored);
  assert.equal(preview.name, '');
  assert.equal(preview.email, '');
  assert.equal(preview.photo, undefined);
  assert.ok(preview.career.every((job) => job.company === ''));
  assert.deepEqual(preview.career.map((job) => job.id), sample.career.map((job) => job.id));
  assert.deepEqual(legacy, before);
});

test('unlocking retains edits and reordering performed in the public preview', () => {
  const preview = moveEntry(publicPreviewProfile(stored), 'career', 0, 1);
  const updated = { ...preview, summary: '架空の解除前の編集', qualifications: [{ period: '2021年4月', description: '架空の新しい資格 合格' }] };
  const restored = restoreProfile(encryptedBasicInfo(sample), contentForUnlock(updated, stored), true);
  assert.equal(restored.summary, updated.summary);
  assert.deepEqual(restored.qualifications, updated.qualifications);
  assert.equal(restored.career[0].company, sample.career[1].company);
  assert.equal(restored.career[1].company, sample.career[0].company);
  assert.equal(restored.name, sample.name);
  assert.deepEqual(resumeContentFrom(publicPreviewProfile(resumeContentFrom(restored))), resumeContentFrom(restored));
});

test('legacy company migration retains names by ID even when preview rows are reordered', () => {
  const legacy = { ...stored, career: sample.career };
  const preview = moveEntry(publicPreviewProfile(legacy), 'career', 0, 1);
  const edited = contentForUnlock(preview, legacy);
  assert.equal(edited.career[0].company, sample.career[1].company);
  const { careerCompanies: _companies, ...basicInfo } = basicInfoFrom(sample);
  const plaintext = JSON.stringify({ format: 'local-resume/basic-info', version: 1, basicInfo });
  assert.ok(needsCompanyEncryption(plaintext, edited));
  assert.equal(restoreProfile(plaintext, edited, true).career[0].company, sample.career[1].company);
});

test('locked editors allow document changes without editing or overwriting encrypted fields', () => {
  const preview = publicPreviewProfile(stored);
  for (const path of ['name', 'address', 'birthday', 'email', 'career.0.company']) assert.equal(editorSpec(preview, path, false, true), null);
  const spec = editorSpec(preview, 'career.0', false, true)!;
  assert.ok(!spec.fields.some((field) => field.key === 'company'));
  const values = Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));
  const edited = applyEditor(preview, spec, { ...values, role: '架空の更新した職種', company: '架空の上書き禁止名' });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.profile.career[0].company, '');
  const restored = restoreProfile(encryptedBasicInfo(sample), contentForUnlock(edited.profile, stored), true);
  assert.equal(restored.career[0].company, sample.career[0].company);
  assert.equal(restored.career[0].role, '架空の更新した職種');
  const adding = editorSpec(preview, 'career', true, true)!;
  const added = applyEditor(preview, adding, { period: '2024年4月〜現在', role: '架空の新しい職種' });
  assert.deepEqual(added.issues, []);
  assert.equal(added.profile.career.at(-1)?.company, '');
  assert.ok(added.profile.career.at(-1)?.id);
});

test('editing a company directly changes only encrypted information', () => {
  const before = structuredClone(sample);
  const spec = editorSpec(sample, 'career.0.company')!;
  assert.deepEqual(spec.fields.map((field) => field.key), ['company']);
  assert.equal(spec.collection, undefined);
  const edited = applyEditor(sample, spec, { company: '架空の更新会社' });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.profile.career[0].company, '架空の更新会社');
  assert.deepEqual(resumeContentFrom(edited.profile), resumeContentFrom(sample));
  assert.equal(basicInfoFrom(edited.profile).careerCompanies[sample.career[0].id!], '架空の更新会社');
  assert.deepEqual(sample, before);
  assert.equal(editorSpec(sample, 'career.999.company'), null);
  assert.ok(applyEditor(sample, spec, { company: '架'.repeat(201) }).issues.some((issue) => issue.path === spec.path));
});

test('public saving preserves career IDs even when only the hidden company has content', () => {
  const companyOnly = { ...sample, career: [{ id: 'dummy-company-only', period: '', company: '架空の会社名のみ', role: '', description: '' }] };
  const publicProfile = publicPreviewProfile(resumeContentFrom(companyOnly));
  publicProfile.notes = '架空の本人希望を更新';
  const saved = resumeContentFrom(profileForStorage(publicProfile, true));
  assert.equal(saved.career[0].id, 'dummy-company-only');
  assert.equal('company' in saved.career[0], false);
  assert.equal(restoreProfile(encryptedBasicInfo(companyOnly), saved).career[0].company, companyOnly.career[0].company);
});
