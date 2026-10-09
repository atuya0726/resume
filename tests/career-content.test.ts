import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { emptyProfile, emptyProject, parseProfile } from '../src/profile.ts';
import { applyEditor, editorSpec, moveEntry, removeEntry } from '../src/editor-model.ts';
import { basicInfoFrom, parseResumeContent, resumeContentFrom } from '../src/profile-storage.ts';
import { profileForStorage, validateProfile } from '../src/validation.ts';

const sample = parseProfile(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
const valuesFor = (spec: NonNullable<ReturnType<typeof editorSpec>>) => Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));

test('company and project details survive parsing and content storage, outside basic information', () => {
  const content = resumeContentFrom(sample);
  assert.deepEqual(parseResumeContent(JSON.stringify(content)), content);
  assert.equal(content.sharedProjects?.length, 2);
  assert.equal(content.career[0].capital, '3,000万円');
  assert.equal('targetRole' in basicInfoFrom(sample), false);
  assert.equal('strengths' in basicInfoFrom(sample), false);
  const old = { ...emptyProfile(), career: [{ period: '2024年4月〜現在', company: '架空会社', role: '技術職', description: '以前の本文' }] };
  delete old.targetRole;
  delete old.strengths;
  const restored = parseProfile(JSON.stringify(old));
  assert.equal(restored.targetRole, '');
  assert.deepEqual(restored.career, old.career.map((job, index) => ({ ...job, id: `legacy-career-${index}` })));
});

test('editing company information preserves all project details', () => {
  const spec = editorSpec(sample, 'career.0')!;
  const result = applyEditor(sample, spec, { ...valuesFor(spec), employees: '100名', description: '変更した架空の本文' });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.profile.sharedProjects, sample.sharedProjects);
  assert.equal(result.profile.career[0].employees, '100名');
  assert.equal(sample.career[0].employees, '80名');
});

test('projects can be added to older careers, edited, reordered and removed independently', () => {
  const profile = { ...sample, sharedProjects: [], career: [{ period: '2024年4月〜現在', company: '架空会社', role: '技術職', description: '既存の本文' }] };
  const spec = editorSpec(profile, 'sharedProjects', true)!;
  const added = applyEditor(profile, spec, { ...emptyProject(), name: '架空の追加案件', period: '2024年4月〜2025年3月', achievements: '架空の成果\n2行目' });
  assert.deepEqual(added.issues, []);
  assert.equal(added.profile.career[0].description, '既存の本文');
  assert.equal(added.profile.sharedProjects?.[0].achievements, '架空の成果\n2行目');
  const editSpec = editorSpec(added.profile, 'sharedProjects.0')!;
  const edited = applyEditor(added.profile, editSpec, { ...valuesFor(editSpec), role: 'リーダー' });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.profile.sharedProjects?.[0].role, 'リーダー');
  const moved = moveEntry(sample, 'sharedProjects', 1, -1);
  assert.equal(moved.sharedProjects?.[0].name, sample.sharedProjects?.[1].name);
  assert.equal(removeEntry(moved, 'sharedProjects', 0).sharedProjects?.length, 1);
  assert.equal(editorSpec(sample, 'career.0.projects', true), null);
  assert.equal(editorSpec(sample, 'sharedProjects.99'), null);
});

test('project validation rejects invalid values while accepting incomplete drafts', () => {
  const spec = editorSpec(sample, 'sharedProjects.0')!;
  for (const changes of [{ period: '2025年3月〜2024年4月' }, { achievements: 'x'.repeat(6001) }]) {
    const result = applyEditor(sample, spec, { ...valuesFor(spec), ...changes });
    assert.ok(result.issues.some((issue) => issue.path.startsWith('sharedProjects.0.')));
  }
  for (const changes of [{ period: '' }, { name: '' }]) assert.deepEqual(applyEditor(sample, spec, { ...valuesFor(spec), ...changes }).issues, []);
  assert.ok(applyEditor(sample, editorSpec(sample, 'sharedProjects', true)!, emptyProject()).issues.length);
  assert.ok(validateProfile({ ...sample, strengths: 'x'.repeat(6001) }).some((issue) => issue.path === 'strengths'));
  const blank = { ...sample, sharedProjects: [emptyProject()] };
  assert.deepEqual(profileForStorage(blank).sharedProjects, []);
});

test('project parser rejects invalid types and oversized arrays and discards unexpected fields', () => {
  const withProjects = (sharedProjects: unknown) => JSON.stringify({ ...sample, sharedProjects });
  for (const projects of [{}, [{ ...emptyProject(), name: 1 }], Array(201).fill(emptyProject())]) {
    assert.throws(() => parseProfile(withProjects(projects)), /projects/);
  }
  const restored = parseProfile(withProjects([{ ...emptyProject(), name: '<img onerror="alert(1)">', password: 'discard' }]));
  assert.equal(restored.sharedProjects?.[0].name, '<img onerror="alert(1)">');
  assert.equal('password' in restored.sharedProjects![0], false);
});
