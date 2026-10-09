import type { CareerItem, CareerProject, Profile } from './profile.ts';
import { careerId, companyFields, consolidateProjects, projectFields } from './profile.ts';
import { parsePhoto } from './photo.ts';

export interface ValidationIssue { path: string; message: string }
export type ValidationScope = 'basic' | 'content' | 'all';

export function hasCareerContent(job: CareerItem): boolean {
  return [job.period, job.company, job.role, job.description, ...companyFields.map((key) => job[key] ?? '')].some((value) => value.trim()) || Boolean(job.projects?.some((project) => projectFields.some((key) => project[key].trim())));
}

export function parseMonth(value: string): number | null {
  const text = value.trim();
  const western = text.match(/^(\d{4})(?:年\s*|[-/])(\d{1,2})月?$/);
  const japanese = text.match(/^(昭和|平成|令和)(元|\d+)年\s*(\d{1,2})月$/);
  let year: number;
  let month: number;
  if (western) { year = Number(western[1]); month = Number(western[2]); }
  else if (japanese) {
    const eraYear = japanese[2] === '元' ? 1 : Number(japanese[2]);
    if (eraYear < 1) return null;
    year = ({ 昭和: 1925, 平成: 1988, 令和: 2018 } as const)[japanese[1] as '昭和' | '平成' | '令和'] + eraYear;
    month = Number(japanese[3]);
    if ((japanese[1] === '昭和' && eraYear > 64) || (japanese[1] === '平成' && eraYear > 31)) return null;
  } else return null;
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
}

function projectMonth(value: string): { first: number; last: number } | null {
  const month = parseMonth(value);
  if (month !== null) return { first: month, last: month };
  const year = value.trim().match(/^(\d{4})年(?:頃)?$/);
  return year && Number(year[1]) >= 1900 && Number(year[1]) <= 2100 ? { first: Number(year[1]) * 12, last: Number(year[1]) * 12 + 11 } : null;
}

export function parseBirthday(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})日?$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return y >= 1900 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function normalizeProfile(profile: Profile): Profile {
  const result = consolidateProjects(structuredClone(profile));
  result.career = result.career.map((job, index) => ({ ...job, id: careerId(job, index) }));
  for (const key of ['name', 'kana', 'birthday', 'address', 'phone', 'email', 'gender', 'postalCode', 'addressKana', 'contactPostalCode', 'contactAddressKana', 'contactAddress', 'contactPhone', 'contactEmail'] as const) {
    const value = result[key];
    if (value !== undefined) result[key] = value.trim();
  }
  for (const key of ['postalCode', 'contactPostalCode'] as const) {
    const value = (result[key] ?? '').replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/[－ー−]/g, '-');
    result[key] = /^\d{7}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3)}` : value;
  }
  for (const key of ['phone', 'contactPhone'] as const) result[key] = (result[key] ?? '').replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/[－ー−]/g, '-');
  return result;
}

export function validateProfile(profile: Profile, scope: ValidationScope = 'all', required = false, today = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const limit = (path: string, value: string, label: string, maximum: number) => {
    if (value.length > maximum) add(path, `${label}は${maximum}文字以内で入力してください。`);
  };
  const validateProject = (project: CareerProject, path: string) => {
    const ids = project.careerIds ?? [];
    if (ids.length > 200 || new Set(ids).size !== ids.length || ids.some((id) => !profile.career.some((job, index) => careerId(job, index) === id))) add(`${path}.careerIds`, '案件の所属職歴を確認してください。');
    if (!projectFields.some((key) => project[key].trim())) return;
    if (required && !project.name.trim()) add(`${path}.name`, 'プロジェクト名を入力してください。');
    const range = project.period.trim().split(/\s*[〜～~–—]\s*/);
    const start = projectMonth(range[0]);
    const end = range.length === 2 && range[1] !== '現在' ? projectMonth(range[1]) : null;
    if ((required || project.period.trim()) && (start === null || range.length > 2 || (range.length === 2 && range[1] !== '現在' && end === null))) add(`${path}.period`, '案件期間を確認してください（例：2024年4月〜現在／2025年頃〜現在）。');
    else if (end !== null && start !== null && end.last < start.first) add(`${path}.period`, '案件の終了年月は開始年月以降にしてください。');
    projectFields.forEach((key) => limit(`${path}.${key}`, project[key], '案件の内容', ['overview', 'tasks', 'achievements'].includes(key) ? 6000 : key === 'period' ? 100 : ['name', 'role'].includes(key) ? 200 : 1000));
  };
  if (scope !== 'content') {
    profile.career.forEach((job, index) => limit(`career.${index}.company`, job.company, '会社名', 200));
    try { parsePhoto(profile.photo); } catch { add('photo', '写真の形式・サイズ・切り取り位置を確認してください。写真を選び直してください。'); }
    for (const [key, label, maximum] of [['name', '氏名', 100], ['kana', 'ふりがな', 100], ['address', '現住所', 300], ['contactAddress', '連絡先住所', 300], ['addressKana', '住所のふりがな', 300], ['contactAddressKana', '連絡先のふりがな', 300], ['gender', '性別', 40]] as const) {
      limit(key, profile[key] ?? '', label, maximum);
    }
    for (const key of ['kana', 'addressKana', 'contactAddressKana'] as const) {
      const value = profile[key] ?? '';
      if (value.trim() && !/^[ぁ-ゖァ-ヺｦ-ﾟー・\s\d０-９−－-]+$/.test(value)) add(key, 'ふりがなはひらがな・カタカナで入力してください。');
    }
    for (const key of ['email', 'contactEmail'] as const) {
      const value = profile[key] ?? '';
      if (value && (value.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value))) add(key, 'メールアドレスの形式を確認してください。');
    }
    for (const key of ['phone', 'contactPhone'] as const) {
      const value = profile[key] ?? '';
      const digits = value.replace(/\D/g, '');
      if (value && (value.length > 40 || !/^\+?[\d()\s-]+$/.test(value) || digits.length < 7 || digits.length > 15)) add(key, '電話番号は7〜15桁の数字で入力してください（ハイフン・括弧・先頭の＋は使用できます）。');
    }
    for (const key of ['postalCode', 'contactPostalCode'] as const) {
      if (profile[key] && !/^\d{3}-\d{4}$/.test(profile[key]!)) add(key, '郵便番号は7桁で入力してください（例：000-0000）。');
    }
    if (profile.birthday) {
      const birthday = parseBirthday(profile.birthday);
      if (!birthday) add('birthday', '生年月日は実在する日付で入力してください。');
      else if (birthday > today) add('birthday', '生年月日は今日以前の日付にしてください。');
    }
    if (required) {
      for (const [key, label] of [['name', '氏名'], ['kana', 'ふりがな'], ['birthday', '生年月日'], ['address', '現住所']] as const) {
        if (!profile[key].trim()) add(key, `${label}を入力してください。`);
      }
      if (!profile.phone && !profile.email) add('phone', '電話番号かメールアドレスを入力してください。');
    }
  }
  if (scope !== 'basic') {
    for (const key of ['education', 'qualifications'] as const) {
      if (profile[key].length > 200) add(key, '項目は200件以内にしてください。');
      let previous: number | null = null;
      profile[key].forEach((item, index) => {
        const path = `${key}.${index}`;
        const period = item.period.trim();
        const description = item.description.trim();
        if (!period && !description) return;
        if (required && !period) add(`${path}.period`, '年月を入力してください。');
        if (required && !description) add(`${path}.description`, key === 'education' ? '学校名と入学・卒業などの内容を入力してください。' : '資格名を入力してください。');
        const month = parseMonth(period);
        if (period && month === null) add(`${path}.period`, '年月を確認してください（例：2024年3月）。');
        if (key === 'education' && month !== null && previous !== null && month < previous) add(`${path}.period`, '学歴は古い年月から順に並べてください。');
        if (month !== null) previous = month;
        limit(`${path}.description`, description, key === 'education' ? '学歴の内容' : '資格名', 500);
      });
    }
    if (profile.career.length > 200) add('career', '職歴は200件以内にしてください。');
    profile.career.forEach((job, index) => {
      const path = `career.${index}`;
      if (!hasCareerContent(job)) return;
      if (required && !job.company.trim()) add(`${path}.company`, '会社名を入力してください。');
      const range = job.period.trim().split(/\s*[〜～~–—]\s*/);
      const start = parseMonth(range[0]);
      const end = range.length === 2 && range[1] !== '現在' ? parseMonth(range[1]) : null;
      if ((required || job.period.trim()) && (start === null || range.length > 2 || (range.length === 2 && range[1] !== '現在' && end === null))) add(`${path}.period`, '期間を確認してください（例：2024年4月〜現在）。');
      else if (end !== null && start !== null && end < start) add(`${path}.period`, '終了年月は開始年月以降にしてください。');
      limit(`${path}.role`, job.role, '職種', 200);
      limit(`${path}.description`, job.description, '業務内容', 6000);
      companyFields.forEach((key) => limit(`${path}.${key}`, job[key] ?? '', '会社情報', key === 'business' ? 1000 : 200));
      if ((job.projects?.length ?? 0) > 200) add(`${path}.projects`, '案件は200件以内にしてください。');
      job.projects?.forEach((project, index) => validateProject(project, `${path}.projects.${index}`));
    });
    for (const [key, label] of [['summary', '職務要約'], ['motivation', '自己PR・志望動機'], ['notes', '本人希望']] as const) limit(key, profile[key], label, 6000);
    if (profile.skills.length > 100) add('skills', 'スキルは100件以内にしてください。');
    profile.skills.forEach((skill, index) => limit(`skills.${index}`, skill, 'スキル', 200));
    limit('targetRole', profile.targetRole ?? '', '応募職種', 200);
    limit('strengths', profile.strengths ?? '', '得意分野・活かせる経験', 6000);
    for (const [key, label] of [['careerOverview', '職務経歴の概要'], ['improvements', '開発・業務改善'], ['activities', '技術活動・受賞実績']] as const) limit(key, profile[key] ?? '', label, 6000);
    if ((profile.sharedProjects?.length ?? 0) > 200) add('sharedProjects', '案件は200件以内にしてください。');
    profile.sharedProjects?.forEach((project, index) => validateProject(project, `sharedProjects.${index}`));
  }
  return issues;
}

export function profileForStorage(profile: Profile, keepCareerRows = false): Profile {
  const normalized = normalizeProfile(profile);
  const linkedCareers = new Set(normalized.sharedProjects?.flatMap((project) => project.careerIds ?? []));
  normalized.education = normalized.education.filter((item) => item.period.trim() || item.description.trim());
  normalized.qualifications = normalized.qualifications.filter((item) => item.period.trim() || item.description.trim());
  normalized.career = keepCareerRows ? normalized.career : normalized.career.filter((job, index) => hasCareerContent(job) || linkedCareers.has(careerId(job, index)));
  normalized.skills = normalized.skills.map((skill) => skill.trim()).filter(Boolean);
  if (normalized.sharedProjects) normalized.sharedProjects = normalized.sharedProjects.filter((project) => projectFields.some((key) => project[key].trim()));
  return normalized;
}
