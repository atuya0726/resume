import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProfile } from '../src/profile.ts';
import { careerRows } from '../src/resume-history.ts';
import { publicPreviewProfile, resumeContentFrom } from '../src/profile-storage.ts';

const fictional = {
  ...emptyProfile(),
  summary: '2023年7月には会社買収に伴い雇用先が変更となりました。担当プロダクトおよび案件は変更なく、継続して開発しています。',
  career: [
    { id: 'dummy-old', company: '架空旧会社', period: '2021年4月 ～ 2023年6月', role: '技術職', description: '' },
    { id: 'dummy-current', company: '架空現会社', period: '2023年7月 ～ 現在', role: '技術職', description: '' },
  ],
};

test('an explicitly dated acquisition produces an employer change instead of resignation and rejoining', () => {
  assert.deepEqual(careerRows(fictional), [
    { path: 'career.0', period: '2021年4月', description: '架空旧会社 入社（技術職）' },
    { path: 'career.1', period: '2023年7月', description: '会社買収に伴い 架空現会社 へ雇用先変更（技術職）' },
    { path: 'career.1', period: '', description: '現在に至る' },
  ]);
  assert.equal(careerRows(fictional).some((row) => row.description.includes('退職')), false);
  const publicRows = careerRows(publicPreviewProfile(resumeContentFrom(fictional)));
  assert.equal(publicRows[1].description, '会社買収に伴い雇用先変更（技術職）');
  assert.equal(publicRows.some((row) => row.description.includes('架空')), false);
});

test('career overview and reordered rows retain the same acquisition event', () => {
  const rows = careerRows({ ...fictional, summary: '', careerOverview: fictional.summary, career: [...fictional.career].reverse() });
  assert.equal(rows[0].description, '会社買収に伴い 架空現会社 へ雇用先変更（技術職）');
  assert.equal(rows.filter((row) => row.path === 'career.1').length, 1);
});

test('unrelated acquisitions, mismatched dates and ambiguous jobs do not overwrite employment events', () => {
  for (const summary of ['', '2023年7月に顧客の会社買収案件を担当しました。', '2024年7月には会社買収に伴い雇用先が変更となりました。']) {
    assert.equal(careerRows({ ...fictional, summary })[1].description, '架空旧会社 退職');
  }
  const ambiguous = { ...fictional, career: [...fictional.career, { ...fictional.career[0], id: 'dummy-other' }] };
  assert.equal(careerRows(ambiguous).filter((row) => row.description.includes('退職')).length, 2);
  assert.equal(careerRows({ ...fictional, summary: '2021年4月に入社し、2023年7月には会社買収に伴い雇用先が変更となりました。' })[1].period, '2023年7月');
});

test('incomplete periods retain original text without guessing dates', () => {
  assert.deepEqual(careerRows({ ...emptyProfile(), career: [{ period: '2021年頃〜現在', company: '架空会社', role: '', description: '' }] }), [
    { path: 'career.0', period: '2021年頃〜現在', description: '架空会社' },
  ]);
});
