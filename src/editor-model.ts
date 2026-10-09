import type { Profile } from './profile.ts';
import { careerId, companyFields, emptyProject, projectFields } from './profile.ts';
import { normalizeProfile, parseBirthday, parseMonth, validateProfile } from './validation.ts';
import type { ValidationIssue } from './validation.ts';
import { isEncryptedField } from './profile-storage.ts';

export type Collection = 'education' | 'career' | 'qualifications' | 'sharedProjects';
export function collectionEntries(profile: Profile, collection: Collection): unknown[] {
  if (collection === 'sharedProjects') return profile.sharedProjects ?? [];
  return profile[collection];
}
function mutableEntries(profile: Profile, collection: Collection): unknown[] {
  if (collection === 'sharedProjects') return profile.sharedProjects ??= [];
  return collectionEntries(profile, collection);
}
export interface EditorField { key: string; label: string; value: string; type: 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'year-month' | 'career-links'; maxLength: number; hint?: string; options?: { value: string; label: string }[] }
export interface EditorSpec { path: string; title: string; fields: EditorField[]; collection?: Collection; index?: number; adding?: boolean }
const labels = {
  name: '氏名', kana: 'ふりがな', birthday: '生年月日', address: '現住所', phone: '電話番号', email: 'メールアドレス',
  gender: '性別（任意）', postalCode: '郵便番号', addressKana: '現住所のふりがな', contactPostalCode: '連絡先の郵便番号',
  contactAddressKana: '連絡先のふりがな', contactAddress: '連絡先住所', contactPhone: '連絡先の電話番号', contactEmail: '連絡先のメールアドレス',
  summary: '職務経歴要約', motivation: '自己PR', notes: '本人希望', skills: '技術スキル',
  targetRole: '応募職種', strengths: '得意分野・活かせる経験',
  careerOverview: '職務経歴の概要', improvements: '開発・業務改善', activities: '技術活動・受賞実績',
} as const;
const companyLabels = { business: '事業内容', capital: '資本金', employees: '従業員数', established: '設立', revenue: '売上高' };
const projectLabels = { period: '案件期間', name: 'プロジェクト名', overview: '概要', phases: '担当フェーズ', tasks: '担当業務', achievements: '実績・取り組み', os: 'OS', database: 'DB', infrastructure: 'NW／サーバー・クラウド', languages: '言語・ツール', role: '役割', team: '体制・規模・工数' };

export function yearMonthParts(value: string): { year: string; month: string } {
  const parsed = parseMonth(value);
  if (parsed !== null) return { year: String(Math.floor(parsed / 12)), month: String(parsed % 12 + 1) };
  // Keep partial input intact while switching between the two controls.
  const partial = value.match(/^(.*?)年(.*?)月$/);
  return { year: partial?.[1] ?? '', month: partial?.[2] ?? '' };
}

export function yearMonthValue(year: string, month: string): string {
  return year || month ? `${year}年${month}月` : '';
}

export function editorSpec(profile: Profile, path: string, adding = false, basicLocked = false): EditorSpec | null {
  if (basicLocked && isEncryptedField(path)) return null;
  const companyMatch = path.match(/^career\.(\d+)\.company$/);
  if (companyMatch) {
    const job = profile.career[Number(companyMatch[1])];
    return job ? { path, title: '会社名', fields: [{ key: 'company', label: '会社名', value: job.company, type: 'text', maxLength: 200 }] } : null;
  }
  if (Object.hasOwn(labels, path)) {
    const key = path as keyof typeof labels;
    const raw = key === 'skills' ? profile.skills.join('\n') : profile[key] ?? '';
    const birthday = key === 'birthday' ? parseBirthday(raw) : null;
    const value = birthday ? `${birthday.getFullYear()}-${String(birthday.getMonth() + 1).padStart(2, '0')}-${String(birthday.getDate()).padStart(2, '0')}` : raw;
    const multiline = ['address', 'contactAddress', 'summary', 'motivation', 'notes', 'skills', 'strengths', 'careerOverview', 'improvements', 'activities'];
    const type = key === 'birthday' ? (birthday || !raw ? 'date' : 'text') : key.endsWith('Email') || key === 'email' ? 'email' : key.endsWith('Phone') || key === 'phone' ? 'tel' : multiline.includes(key) ? 'textarea' : 'text';
    return { path, title: labels[key], fields: [{ key, label: labels[key], value, type, maxLength: multiline.includes(key) && !['address', 'contactAddress'].includes(key) ? 6000 : key === 'targetRole' ? 200 : ['address', 'contactAddress', 'addressKana', 'contactAddressKana'].includes(key) ? 300 : key === 'email' || key === 'contactEmail' ? 254 : 100, hint: key === 'skills' ? '1行に1つずつ入力してください。例：OS：Linux／DB：PostgreSQL／言語：TypeScript' : undefined }] };
  }
  const sharedMatch = path.match(/^sharedProjects(?:\.(\d+))?$/);
  if (sharedMatch) {
    const collection: Collection = 'sharedProjects';
    const projects = profile.sharedProjects ?? [];
    const index = adding ? projects.length : Number(sharedMatch[1]);
    if (!Number.isInteger(index) || index < 0 || (adding ? index >= 200 : index >= projects.length)) return null;
    const item = adding ? emptyProject() : projects[index];
    const multiline = ['overview', 'tasks', 'achievements', 'os', 'database', 'infrastructure', 'languages', 'team'];
    return { path: `${collection}.${index}`, title: `案件${adding ? 'を追加' : 'を編集'}`, collection, index, adding,
      fields: [
        { key: 'careerIds', label: '所属', value: (item.careerIds ?? []).join(','), type: 'career-links', maxLength: 20200,
          options: profile.career.map((job, index) => ({ value: careerId(job, index), label: `${job.company || `職歴${index + 1}`}${job.period ? `（${job.period}）` : ''}` })) },
        ...projectFields.map((key): EditorField => ({ key, label: projectLabels[key], value: item[key], type: multiline.includes(key) ? 'textarea' : 'text', maxLength: ['overview', 'tasks', 'achievements'].includes(key) ? 6000 : key === 'period' ? 100 : ['name', 'role'].includes(key) ? 200 : 1000,
          hint: key === 'period' ? '例：2024年4月〜2025年3月／2025年4月〜現在' : key === 'phases' ? '例：要件定義、設計、構築、テスト、運用、保守' : undefined })),
      ] };
  }
  const match = path.match(/^(education|career|qualifications)(?:\.(\d+))?$/);
  if (!match) return null;
  const collection = match[1] as 'education' | 'career' | 'qualifications';
  const index = adding ? profile[collection].length : Number(match[2]);
  if (!Number.isInteger(index) || index < 0 || (!adding && index >= profile[collection].length) || (adding && index >= 200)) return null;
  const title = { education: '学歴', career: '職歴', qualifications: '免許・資格' }[collection];
  const item = (adding ? (collection === 'career' ? { period: '', company: '', role: '', description: '' } : { period: '', description: '' }) : collectionEntries(profile, collection)[index]) as Record<string, string>;
  const fields: EditorField[] = [{ key: 'period', label: collection === 'career' ? '在籍期間' : '年月', value: item.period, type: collection === 'career' ? 'text' : 'year-month', maxLength: 100, hint: collection === 'career' ? '例：2024年4月〜現在／2024年4月〜2026年3月' : '年は西暦で入力し、月は選択してください。' }];
  if (collection === 'career') fields.push({ key: 'company', label: '会社名', value: item.company ?? '', type: 'text', maxLength: 200 }, { key: 'role', label: '職種・役職', value: item.role ?? '', type: 'text', maxLength: 200 });
  fields.push({ key: 'description', label: collection === 'career' ? '業務概要' : collection === 'education' ? '学校名・学部・入学／卒業など' : '資格名・取得内容', value: item.description, type: 'textarea', maxLength: collection === 'career' ? 6000 : 500 });
  if (collection === 'career') fields.push(...companyFields.map((key): EditorField => ({ key, label: companyLabels[key], value: item[key] ?? '', type: key === 'business' ? 'textarea' : 'text', maxLength: key === 'business' ? 1000 : 200 })));
  return { path: `${collection}.${index}`, title: `${title}${adding ? 'を追加' : 'を編集'}`, fields: basicLocked ? fields.filter((field) => field.key !== 'company') : fields, collection, index, adding };
}

export function applyEditor(profile: Profile, spec: EditorSpec, values: Record<string, string>): { profile: Profile; issues: ValidationIssue[] } {
  const next = normalizeProfile(profile);
  const companyMatch = spec.path.match(/^career\.(\d+)\.company$/);
  if (spec.collection !== undefined && spec.index !== undefined) {
    const item = Object.fromEntries(spec.fields.map((field) => [field.key, field.type === 'career-links' ? (values[field.key] ?? '').split(',').filter(Boolean) : (values[field.key] ?? '').trim()]));
    const entries = mutableEntries(next, spec.collection);
    if (spec.adding) entries.push(spec.collection === 'career' ? { period: '', company: '', role: '', description: '', ...item, id: crypto.randomUUID() } : item);
    else entries[spec.index] = { ...(entries[spec.index] as object), ...item };
  } else if (companyMatch && next.career[Number(companyMatch[1])]) next.career[Number(companyMatch[1])].company = (values.company ?? '').trim();
  else if (spec.path === 'skills') next.skills = (values.skills ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  else if (Object.hasOwn(labels, spec.path)) {
    const key = spec.path as Exclude<keyof typeof labels, 'skills'>;
    let value = (values[key] ?? '').trim();
    if (key === 'birthday' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      value = `${y}年${m}月${d}日`;
    }
    next[key] = value;
  }
  const normalized = normalizeProfile(next);
  const existing = new Set(validateProfile(profile).map((issue) => `${issue.path}:${issue.message}`));
  const issues = validateProfile(normalized).filter((issue) => issue.path === spec.path || issue.path.startsWith(`${spec.path}.`) || (spec.collection && issue.path.startsWith(`${spec.collection}.`) && !existing.has(`${issue.path}:${issue.message}`)));
  // Newly added entries must contain actual content, even though unused blank rows are optional.
  if (spec.adding && !spec.fields.some((field) => field.type !== 'career-links' && (values[field.key] ?? '').trim())) issues.push({ path: `${spec.path}.period`, message: '追加する内容を入力してください。' });
  return { profile: normalized, issues };
}

export function removeEntry(profile: Profile, collection: Collection, index: number): Profile {
  const next = normalizeProfile(profile);
  const entries = mutableEntries(next, collection);
  if (Number.isInteger(index) && index >= 0 && index < entries.length) {
    if (collection === 'career') {
      const id = careerId(next.career[index], index);
      next.sharedProjects = next.sharedProjects?.map((project) => project.careerIds ? { ...project, careerIds: project.careerIds.filter((linkedId) => linkedId !== id) } : project);
    }
    entries.splice(index, 1);
  }
  return next;
}

export function moveEntry(profile: Profile, collection: Collection, index: number, direction: number): Profile {
  const next = normalizeProfile(profile);
  const other = index + direction;
  const list = mutableEntries(next, collection);
  if (Number.isInteger(index) && Math.abs(direction) === 1 && index >= 0 && index < list.length && other >= 0 && other < list.length) {
    [list[index], list[other]] = [list[other], list[index]];
  }
  return next;
}
