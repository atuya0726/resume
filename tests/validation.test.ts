import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { emptyProfile, parseProfile } from '../src/profile.ts';
import { normalizeProfile, validateProfile, parseMonth, parseBirthday, profileForStorage } from '../src/validation.ts';
import { applyEditor, editorSpec, removeEntry, moveEntry, yearMonthParts, yearMonthValue } from '../src/editor-model.ts';

const sample = parseProfile(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
const today = new Date(2026, 9, 9);

test('fictional 2001 graduate example is complete and valid', () => {
  assert.deepEqual(validateProfile(sample, 'all', true, today), []);
  assert.equal(sample.education.at(-1)?.period, '2024年3月');
});

test('birthdays must exist and cannot be future dates', () => {
  assert.equal(parseBirthday('2001年2月29日'), null);
  assert.ok(parseBirthday('2000-02-29'));
  assert.ok(validateProfile({ ...sample, birthday: '2001年2月29日' }, 'basic', true, today).some((issue) => issue.path === 'birthday'));
  assert.ok(validateProfile({ ...sample, birthday: '2099年1月1日' }, 'basic', true, today).some((issue) => issue.path === 'birthday'));
});

test('contact formats reject malformed data while optional blanks remain allowed', () => {
  for (const [key, value] of [['email', 'missing-at-sign'], ['phone', 'abc123'], ['postalCode', '1234'], ['kana', '山田太郎']] as const) {
    assert.ok(validateProfile({ ...sample, [key]: value }, 'basic', true, today).some((issue) => issue.path === key));
  }
  assert.deepEqual(validateProfile({ ...sample, contactEmail: '', contactPhone: '', postalCode: '' }, 'basic', true, today), []);
  const normalized = normalizeProfile({ ...sample, postalCode: '１２３４５６７', phone: '０００ー１２３４ー５６７８' });
  assert.equal(normalized.postalCode, '123-4567');
  assert.equal(normalized.phone, '000-1234-5678');
});

test('basic saving requires identity and at least one contact method, but content can save separately', () => {
  assert.ok(validateProfile(emptyProfile(), 'basic', true, today).some((issue) => issue.path === 'name'));
  assert.deepEqual(validateProfile(emptyProfile(), 'content', true, today), []);
  assert.deepEqual(validateProfile({ ...sample, phone: '' }, 'basic', true, today), []);
  assert.ok(validateProfile({ ...sample, phone: '', email: '' }, 'basic', true, today).some((issue) => issue.path === 'phone'));
});

test('education chronology, actual months, complete rows and career ranges are checked', () => {
  assert.equal(parseMonth('2024年13月'), null);
  assert.equal(parseMonth('令和6年3月'), parseMonth('2024-03'));
  const education = [{ period: '2024年3月', description: '架空大学 卒業' }, { period: '2020年4月', description: '架空大学 入学' }];
  assert.ok(validateProfile({ ...sample, education }).some((issue) => issue.path === 'education.1.period'));
  const incomplete = { ...sample, qualifications: [{ period: '', description: 'サンプル資格' }] };
  assert.deepEqual(validateProfile(incomplete, 'content'), []);
  assert.ok(validateProfile(incomplete, 'all', true).some((issue) => issue.path === 'qualifications.0.period'));
  assert.ok(validateProfile({ ...sample, career: [{ ...sample.career[0], period: '2026年3月〜2024年4月' }] }).some((issue) => issue.path === 'career.0.period'));
  assert.ok(validateProfile({ ...sample, notes: 'x'.repeat(6001) }).some((issue) => issue.path === 'notes'));
});

test('an invalid edit never mutates the original profile', () => {
  const original = structuredClone(sample);
  const spec = editorSpec(sample, 'email')!;
  const result = applyEditor(sample, spec, { email: 'bad-address' });
  assert.ok(result.issues.length);
  assert.deepEqual(sample, original);
  assert.equal(editorSpec(sample, '__proto__'), null);
  assert.equal(editorSpec(sample, 'career.9999'), null);
});

test('editing a school also detects a newly reversed following date', () => {
  const result = applyEditor(sample, editorSpec(sample, 'education.0')!, { period: '2025年3月', description: sample.education[0].description });
  assert.ok(result.issues.some((issue) => issue.path === 'education.1.period'));
});

test('row addition, reordering and deletion work without JSON editing', () => {
  const spec = editorSpec(sample, 'qualifications', true)!;
  assert.ok(applyEditor(sample, spec, { period: '', description: '' }).issues.length);
  const added = applyEditor(sample, spec, { period: '2024年5月', description: '架空の資格' });
  assert.deepEqual(added.issues, []);
  assert.equal(added.profile.qualifications.length, 2);
  const moved = moveEntry(added.profile, 'qualifications', 1, -1);
  assert.equal(moved.qualifications[0].description, '架空の資格');
  assert.deepEqual(removeEntry(moved, 'qualifications', 0).qualifications, sample.qualifications);
});

test('birthday editor converts native date inputs and blank placeholder rows do not get saved', () => {
  const spec = editorSpec(sample, 'birthday')!;
  assert.equal(spec.fields[0].type, 'date');
  assert.equal(spec.fields[0].value, '2001-06-01');
  assert.equal(applyEditor(sample, spec, { birthday: '2001-07-01' }).profile.birthday, '2001年7月1日');
  const stored = profileForStorage(emptyProfile());
  assert.deepEqual(stored.education, []);
  assert.deepEqual(stored.career, []);
});

test('year and month controls open existing Western and Japanese dates without losing partial input', () => {
  assert.equal(editorSpec(sample, 'education.0')?.fields[0].type, 'year-month');
  assert.equal(editorSpec(sample, 'qualifications.0')?.fields[0].type, 'year-month');
  assert.equal(editorSpec(sample, 'career.0')?.fields[0].type, 'text');
  assert.deepEqual(yearMonthParts('2017年4月'), { year: '2017', month: '4' });
  assert.deepEqual(yearMonthParts('平成29年4月'), { year: '2017', month: '4' });
  assert.deepEqual(yearMonthParts(yearMonthValue('2024', '')), { year: '2024', month: '' });
  assert.deepEqual(yearMonthParts(yearMonthValue('', '3')), { year: '', month: '3' });
});

test('split month input validates incomplete and out-of-range dates and saves complete selections', () => {
  const spec = editorSpec(sample, 'qualifications.0')!;
  for (const [year, month] of [['2024', ''], ['', '3'], ['2024', '13'], ['2200', '3'], ['2024.5', '3']]) {
    const result = applyEditor(sample, spec, { period: yearMonthValue(year, month), description: sample.qualifications[0].description });
    assert.ok(result.issues.some((issue) => issue.path === 'qualifications.0.period'));
  }
  const result = applyEditor(sample, spec, { period: yearMonthValue('2024', '3'), description: sample.qualifications[0].description });
  assert.deepEqual(result.issues, []);
  assert.equal(result.profile.qualifications[0].period, '2024年3月');
});
