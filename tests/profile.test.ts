import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { emptyProfile, parseProfile } from '../src/profile.ts';

test('the documented fictional example and empty template are valid', async () => {
  const example = await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8');
  assert.equal(parseProfile(example).career.length, 1);
  assert.equal(parseProfile(example).education.length, 3);
  assert.equal(parseProfile(example).education[0].period, '2020年3月');
  assert.match(parseProfile(example).education[0].description, /高等学校.*卒業/);
  assert.equal(parseProfile(example).birthday, '2001年6月1日');
  assert.equal(parseProfile(JSON.stringify(emptyProfile())).name, '');
});

test('invalid JSON errors never echo the input', () => {
  const marker = 'PRIVATE_DUMMY_MARKER';
  assert.throws(() => parseProfile(`{"name":"${marker}"`), (error: Error) => !error.message.includes(marker));
});

test('wrong field types and very large arrays are rejected', () => {
  assert.throws(() => parseProfile(JSON.stringify({ ...emptyProfile(), name: 7 })), /name/);
  assert.deepEqual(parseProfile(JSON.stringify({ ...emptyProfile(), skills: [null] })).skills, []);
  assert.throws(() => parseProfile(JSON.stringify({ ...emptyProfile(), skills: [1] })), /skills/);
  assert.throws(() => parseProfile(JSON.stringify({ ...emptyProfile(), career: Array(201).fill({}) })), /career/);
});

test('unexpected properties are discarded and data stays plain text', () => {
  const value = parseProfile(JSON.stringify({ ...emptyProfile(), name: '<img onerror="alert(1)">', extra: 'ignored' }));
  assert.equal(value.name, '<img onerror="alert(1)">');
  assert.equal('extra' in value, false);
});

test('existing profiles without the optional contact fields remain valid', () => {
  const value = parseProfile(JSON.stringify({ name: '', kana: '', birthday: '', address: '', email: '', phone: '', education: [], career: [], qualifications: [], skills: [], summary: '', motivation: '', notes: '' }));
  assert.equal(value.gender, '');
  assert.equal(value.contactAddress, '');
  assert.equal(value.postalCode, '');
});

test('optional contact fields preserve text and reject non-string values', () => {
  const profile = { ...emptyProfile(), addressKana: 'かくうちょう', contactAddress: '架空の連絡先\nサンプル建物', gender: '任意の記載' };
  const value = parseProfile(JSON.stringify(profile));
  assert.equal(value.contactAddress, profile.contactAddress);
  assert.equal(value.gender, profile.gender);
  assert.throws(() => parseProfile(JSON.stringify({ ...profile, contactEmail: 123 })), /contactEmail/);
});

test('nullable scalar, collection and row fields become empty editable values', () => {
  const value = parseProfile(JSON.stringify({ name: null, birthday: null, photo: null, education: [null, { period: null, description: null }], career: [{ company: null, role: null, description: null, business: null, projects: [null, { overview: null }] }], qualifications: null, skills: null, summary: null }));
  assert.equal(value.name, '');
  assert.equal(value.birthday, '');
  assert.equal(value.photo, undefined);
  assert.deepEqual(value.education, [{ period: '', description: '' }, { period: '', description: '' }]);
  assert.equal(value.career[0].company, '');
  assert.equal(value.sharedProjects?.[0].overview, '');
  assert.deepEqual(value.qualifications, []);
});

test('career IDs must be safe and unique', () => {
  const job = { period: '', company: '', role: '', description: '' };
  for (const career of [[{ ...job, id: 'bad.id' }], [{ ...job, id: 'same' }, { ...job, id: 'same' }]]) {
    assert.throws(() => parseProfile(JSON.stringify({ ...emptyProfile(), career })), /ID/);
  }
});
