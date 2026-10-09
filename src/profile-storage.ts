import { careerId, consolidateProjects, emptyProfile, parseProfile } from './profile.ts';
import type { CareerItem, Profile } from './profile.ts';

const basicKeys = ['name', 'kana', 'birthday', 'address', 'email', 'phone', 'gender', 'postalCode', 'addressKana', 'contactPostalCode', 'contactAddressKana', 'contactAddress', 'contactPhone', 'contactEmail', 'photo'] as const;
const contentKeys = ['education', 'career', 'qualifications', 'skills', 'summary', 'motivation', 'notes', 'targetRole', 'strengths', 'careerOverview', 'sharedProjects', 'improvements', 'activities'] as const;
export type BasicInfo = Pick<Profile, typeof basicKeys[number]> & { careerCompanies: Record<string, string | null> };
// company is accepted only while reading legacy content for migration in the browser.
export type StoredCareerItem = Omit<CareerItem, 'company'> & { company?: string };
export type ResumeContent = Omit<Pick<Profile, typeof contentKeys[number]>, 'career'> & { career: StoredCareerItem[] };

export function basicInfoFrom(profile: Profile): BasicInfo {
  return {
    ...Object.fromEntries(basicKeys.filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]])) as Pick<Profile, typeof basicKeys[number]>,
    careerCompanies: Object.fromEntries(profile.career.map((job, index) => [careerId(job, index), job.company || null])),
  };
}

export function resumeContentFrom(profile: Profile): ResumeContent {
  profile = consolidateProjects(profile);
  const defaults = emptyProfile();
  return {
    ...Object.fromEntries(contentKeys.map((key) => [key, profile[key] ?? defaults[key] ?? ''])) as Pick<Profile, typeof contentKeys[number]>,
    career: profile.career.map(({ company: _company, ...job }, index) => ({ ...job, id: careerId(job, index) })),
  };
}

function object(text: string): Record<string, unknown> {
  if (text.length > 1_000_000) throw new Error('JSONが大きすぎます。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONの書き方を確認してください。'); }
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSONのルートはオブジェクトにしてください。');
  return value as Record<string, unknown>;
}

export function parseBasicInfo(text: string): BasicInfo {
  const data = object(text);
  const selected = Object.fromEntries(basicKeys.map((key) => [key, data[key]]));
  const basic = basicInfoFrom(parseProfile(JSON.stringify({ ...emptyProfile(), ...selected, career: [] })));
  const companies = data.careerCompanies ?? {};
  if (!companies || typeof companies !== 'object' || Array.isArray(companies) || Object.keys(companies).length > 200) throw new Error('会社名のデータ形式を確認してください。');
  basic.careerCompanies = Object.fromEntries(Object.entries(companies).map(([id, name]) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || (name != null && (typeof name !== 'string' || name.length > 200))) throw new Error('会社名のデータ形式を確認してください。');
    return [id, name || null];
  }));
  return basic;
}

export function parseResumeContent(text: string): ResumeContent {
  const data = object(text);
  const selected = Object.fromEntries(contentKeys.map((key) => [key, data[key]]));
  const profile = parseProfile(JSON.stringify({ ...emptyProfile(), ...selected }));
  const content = resumeContentFrom(profile);
  // Keep old company names only in browser memory until encryption has succeeded.
  content.career = content.career.map((job, index) => profile.career[index].company ? { ...job, company: profile.career[index].company } : job);
  return content;
}

export function profileWithContent(content: ResumeContent, basic?: BasicInfo): Profile {
  const companies = basic?.careerCompanies ?? {};
  return parseProfile(JSON.stringify({ ...emptyProfile(), ...basic, ...content,
    career: content.career.map((job, index) => {
      const id = careerId(job, index);
      return { ...job, id, company: Object.hasOwn(companies, id) ? companies[id] ?? '' : job.company ?? '' };
    }),
  }));
}

export function publicPreviewProfile(content: ResumeContent): Profile {
  return profileWithContent({ ...content, career: content.career.map((job) => ({ ...job, company: '' })) });
}

export function contentForUnlock(profile: Profile, stored: ResumeContent): ResumeContent {
  const legacyCompanies = new Map(stored.career.map((job, index) => [careerId(job, index), job.company]));
  const content = resumeContentFrom(profile);
  content.career = content.career.map((job, index) => {
    const company = legacyCompanies.get(careerId(job, index));
    return company ? { ...job, company } : job;
  });
  return content;
}

export function isEncryptedField(path: string): boolean {
  return basicKeys.some((key) => key === path) || /^career\.\d+\.company$/.test(path);
}

export function encryptedBasicInfo(profile: Profile): string {
  const basic = basicInfoFrom(profile);
  const nullable = Object.fromEntries(Object.entries(basic).map(([key, value]) => [key, value === '' ? null : value]));
  return JSON.stringify({ format: 'local-resume/basic-info', version: 2, basicInfo: nullable });
}

export function needsCompanyEncryption(plaintext: string, content: ResumeContent): boolean {
  const data = object(plaintext);
  if (data.format === undefined) return false;
  const basic = parseBasicInfo(JSON.stringify(data.basicInfo ?? null));
  return content.career.some((job, index) => Boolean(job.company) && !Object.hasOwn(basic.careerCompanies, careerId(job, index)));
}

export function restoreProfile(plaintext: string, content: ResumeContent, hasStoredContent = false): Profile {
  const data = object(plaintext);
  // Prefer the current document JSON when present; otherwise retain legacy content.
  if (data.format === undefined) {
    const legacy = parseProfile(plaintext);
    return hasStoredContent ? profileWithContent(content, basicInfoFrom(legacy)) : legacy;
  }
  if (data.format !== 'local-resume/basic-info' || (data.version !== 1 && data.version !== 2)) throw new Error('対応していない基本情報の形式です。');
  return profileWithContent(content, parseBasicInfo(JSON.stringify(data.basicInfo ?? null)));
}
