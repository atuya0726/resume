import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProfile, emptyProject, parseProfile } from '../src/profile.ts';
import { basicInfoFrom, encryptedBasicInfo, parseResumeContent, restoreProfile, resumeContentFrom } from '../src/profile-storage.ts';
import { applyEditor, editorSpec, moveEntry, removeEntry } from '../src/editor-model.ts';
import { profileForStorage, validateProfile } from '../src/validation.ts';

const profile = parseProfile(JSON.stringify({ ...emptyProfile(), name: '架空の氏名', career: [{ id: 'dummy-company', company: '架空の会社', period: '2022年4月〜現在', role: '架空の技術職', description: '' }], summary: '架空の要約', careerOverview: '架空の案件継続', improvements: '架空の改善', activities: '架空の受賞', sharedProjects: [{ ...emptyProject(), name: '架空の共通案件', period: '2023年頃〜現在', tasks: '架空の担当業務' }] }));

test('shared projects and career sections survive content storage without identity or company names', () => {
  const content = resumeContentFrom(profile);
  assert.deepEqual(parseResumeContent(JSON.stringify(content)), content);
  assert.equal('company' in content.career[0], false);
  assert.equal('name' in content, false);
  assert.deepEqual(restoreProfile(encryptedBasicInfo(profile), content), profile);
});

test('shared projects allow imprecise years without guessing months and reject reversed ranges', () => {
  for (const period of ['2023年頃〜現在', '2023年〜2024年', '2023年12月〜2023年頃']) {
    assert.deepEqual(validateProfile({ ...profile, sharedProjects: [{ ...emptyProject(), name: '架空の案件', period }] }, 'content'), []);
  }
  for (const period of ['2024年頃〜2023年頃', '2023年13月〜現在']) {
    assert.ok(validateProfile({ ...profile, sharedProjects: [{ ...emptyProject(), name: '架空の案件', period }] }, 'content').some((issue) => issue.path === 'sharedProjects.0.period'));
  }
});

test('shared projects and career sections can be edited, reordered and removed while preserving identity', () => {
  const spec = editorSpec(profile, 'sharedProjects.0')!;
  const values = Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));
  const edited = applyEditor(profile, spec, { ...values, name: '架空の変更案件' });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.profile.sharedProjects?.[0].name, '架空の変更案件');
  assert.deepEqual(basicInfoFrom(edited.profile), basicInfoFrom(profile));
  const additional = { ...edited.profile, sharedProjects: [...edited.profile.sharedProjects!, { ...emptyProject(), name: '架空の追加案件', period: '2024年頃〜現在' }] };
  const moved = moveEntry(additional, 'sharedProjects', 1, -1);
  assert.equal(moved.sharedProjects?.[0].name, '架空の追加案件');
  assert.equal(removeEntry(moved, 'sharedProjects', 0).sharedProjects?.length, 1);
  assert.equal(applyEditor(profile, editorSpec(profile, 'improvements')!, { improvements: '架空の更新した改善内容' }).profile.improvements, '架空の更新した改善内容');
});

test('legacy company projects migrate once without losing content, affiliation, IDs or existing shared projects', () => {
  const legacy = { ...profile, career: profile.career.map((job) => ({ ...job, projects: [{ ...emptyProject(), name: '架空の旧形式案件', tasks: '移行しても保持する本文' }] })) };
  const migrated = parseProfile(JSON.stringify(legacy));
  assert.deepEqual(migrated.sharedProjects?.[0], profile.sharedProjects?.[0]);
  assert.equal(migrated.sharedProjects?.[1].tasks, '移行しても保持する本文');
  assert.deepEqual(migrated.sharedProjects?.[1].careerIds, ['dummy-company']);
  assert.equal('projects' in migrated.career[0], false);
  assert.equal(migrated.career[0].id, legacy.career[0].id);
  assert.equal(migrated.career[0].company, legacy.career[0].company);
  assert.deepEqual(parseProfile(JSON.stringify(migrated)), migrated);
  const content = resumeContentFrom(legacy);
  assert.equal(JSON.stringify(content).includes('架空の会社'), false);
  assert.deepEqual(content.sharedProjects, migrated.sharedProjects);
  assert.deepEqual(parseResumeContent(JSON.stringify(content)), content);
});

test('project affiliations can span employers and remain stable when careers move or are deleted', () => {
  const twoJobs = { ...profile, career: [...profile.career, { ...profile.career[0], id: 'dummy-second', company: '架空の変更後の会社' }] };
  const spec = editorSpec(twoJobs, 'sharedProjects.0', false, true)!;
  const values = Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));
  const edited = applyEditor(twoJobs, spec, { ...values, careerIds: 'dummy-company,dummy-second' });
  assert.deepEqual(edited.issues, []);
  assert.deepEqual(edited.profile.sharedProjects?.[0].careerIds, ['dummy-company', 'dummy-second']);
  assert.deepEqual(basicInfoFrom(edited.profile), basicInfoFrom(twoJobs));
  const reordered = moveEntry(edited.profile, 'career', 0, 1);
  assert.deepEqual(reordered.sharedProjects, edited.profile.sharedProjects);
  const removed = removeEntry(reordered, 'career', 0);
  assert.deepEqual(removed.sharedProjects?.[0].careerIds, ['dummy-company']);
  assert.equal(removed.sharedProjects?.[0].tasks, profile.sharedProjects?.[0].tasks);
  assert.deepEqual(validateProfile(removed, 'content'), []);
  assert.ok(applyEditor(twoJobs, spec, { ...values, careerIds: 'missing-job' }).issues.some((issue) => issue.path === 'sharedProjects.0.careerIds'));
  assert.ok(applyEditor(twoJobs, editorSpec(twoJobs, 'sharedProjects', true)!, { careerIds: 'dummy-company' }).issues.length);
});

test('project affiliations reject malformed, duplicate and oversized IDs', () => {
  for (const careerIds of ['dummy-company', [null], ['bad.id'], ['same', 'same'], Array(201).fill('same')]) {
    assert.throws(() => parseProfile(JSON.stringify({ ...profile, sharedProjects: [{ ...emptyProject(), careerIds }] })), /所属職歴/);
  }
});

test('saving an incomplete employer retains its ID when a project is linked to it', () => {
  const draft = { ...emptyProfile(), sharedProjects: [{ ...emptyProject(), name: '架空の入力途中案件', careerIds: ['legacy-career-0'] }] };
  const saved = profileForStorage(draft);
  assert.equal(saved.career[0].id, 'legacy-career-0');
  assert.deepEqual(saved.sharedProjects?.[0].careerIds, ['legacy-career-0']);
  assert.deepEqual(validateProfile(saved, 'content'), []);
});
