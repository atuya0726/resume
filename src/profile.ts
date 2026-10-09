import { parsePhoto } from './photo.ts';
import type { ResumePhoto } from './photo.ts';
export interface TimelineItem { period: string; description: string }
export const projectFields = ['period', 'name', 'overview', 'phases', 'tasks', 'achievements', 'os', 'database', 'infrastructure', 'languages', 'role', 'team'] as const;
export type CareerProject = Record<typeof projectFields[number], string> & { careerIds?: string[] };
export const companyFields = ['business', 'capital', 'employees', 'established', 'revenue'] as const;
export interface CareerItem {
  id?: string;
  period: string; company: string; role: string; description: string;
  business?: string; capital?: string; employees?: string; established?: string; revenue?: string;
  // Accepted for migration from the old company-specific project format.
  projects?: CareerProject[];
}
export function careerId(job: Pick<CareerItem, 'id'>, index: number): string {
  return job.id ?? `legacy-career-${index}`;
}
export function emptyProject(): CareerProject {
  return Object.fromEntries(projectFields.map((key) => [key, ''])) as Record<typeof projectFields[number], string>;
}
export interface Profile {
  name: string;
  kana: string;
  birthday: string;
  address: string;
  email: string;
  phone: string;
  gender?: string;
  postalCode?: string;
  addressKana?: string;
  contactPostalCode?: string;
  contactAddressKana?: string;
  contactAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
  photo?: ResumePhoto;
  education: TimelineItem[];
  career: CareerItem[];
  qualifications: TimelineItem[];
  skills: string[];
  summary: string;
  motivation: string;
  notes: string;
  targetRole?: string;
  strengths?: string;
  careerOverview?: string;
  sharedProjects?: CareerProject[];
  improvements?: string;
  activities?: string;
}

export function consolidateProjects(profile: Profile): Profile {
  const sharedProjects = [...(profile.sharedProjects ?? [])];
  const career = profile.career.map(({ projects, ...job }, index) => {
    for (const project of projects ?? []) {
      sharedProjects.push({ ...project, careerIds: [...new Set([...(project.careerIds ?? []), careerId(job, index)])] });
    }
    return job;
  });
  return { ...profile, career, sharedProjects };
}

export function parseProfile(text: string): Profile {
  if (text.length > 1_000_000) throw new Error('JSONが大きすぎます。');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('JSONの書き方を確認してください。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSONのルートはオブジェクトにしてください。');
  }
  const data = value as Record<string, unknown>;
  function string(key: string): string {
    if (data[key] == null) return '';
    if (typeof data[key] !== 'string' || data[key].length > 50_000) {
      throw new Error(`${key} は文字列（50,000文字以内）にしてください。`);
    }
    return data[key];
  }
  function items<T>(key: string, fields: string[]): T[] {
    const list = data[key] ?? [];
    if (!Array.isArray(list) || list.length > 200) {
      throw new Error(`${key} は配列（200項目以内）にしてください。`);
    }
    return list.map((entry) => {
      if (entry === null) entry = {};
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          fields.some((field) => entry[field] != null && (typeof entry[field] !== 'string' || entry[field].length > 50_000))) {
        throw new Error(`${key} の各項目には ${fields.join(', ')} を文字列で指定してください。`);
      }
      return Object.fromEntries(fields.map((field) => [field, entry[field] ?? ''])) as T;
    });
  }
  function optionalString(key: string): string {
    return data[key] === undefined ? '' : string(key);
  }
  function projects(list: unknown): CareerProject[] {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 200) throw new Error('projects は配列（200項目以内）にしてください。');
    return list.map((project) => {
      if (project === null) project = {};
      if (!project || typeof project !== 'object' || Array.isArray(project) || projectFields.some((key) => project[key] != null && (typeof project[key] !== 'string' || project[key].length > 50_000))) throw new Error('projects の各項目には案件の各フィールドを文字列で指定してください。');
      const parsed = Object.fromEntries(projectFields.map((key) => [key, project[key] ?? ''])) as CareerProject;
      if (project.careerIds != null) {
        const ids = project.careerIds;
        if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('案件の所属職歴を確認してください。');
        parsed.careerIds = [...ids];
      }
      return parsed;
    });
  }
  function careers(): CareerItem[] {
    const jobs = items<CareerItem>('career', ['period', 'company', 'role', 'description']);
    const ids = new Set<string>();
    return jobs.map((job, index) => {
      const entry = (data.career as (Record<string, unknown> | null)[])[index] ?? {};
      const id = entry.id ?? careerId(job, index);
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error('職歴のIDを確認してください。');
      ids.add(id);
      job.id = id;
      for (const key of companyFields) {
        if (entry[key] === undefined) continue;
        if (entry[key] === null) { job[key] = ''; continue; }
        if (typeof entry[key] !== 'string' || entry[key].length > 50_000) throw new Error(`career.${index}.${key} は文字列にしてください。`);
        job[key] = entry[key];
      }
      if (entry.projects != null) {
        job.projects = projects(entry.projects);
      }
      return job;
    });
  }
  const skills = data.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 100 ||
      skills.some((skill) => skill != null && (typeof skill !== 'string' || skill.length > 200))) {
    throw new Error('skills は文字列の配列（100項目以内）にしてください。');
  }
  return consolidateProjects({
    name: string('name'), kana: string('kana'), birthday: string('birthday'),
    address: string('address'), email: string('email'), phone: string('phone'),
    gender: optionalString('gender'), postalCode: optionalString('postalCode'), addressKana: optionalString('addressKana'),
    contactPostalCode: optionalString('contactPostalCode'), contactAddressKana: optionalString('contactAddressKana'),
    contactAddress: optionalString('contactAddress'), contactPhone: optionalString('contactPhone'), contactEmail: optionalString('contactEmail'),
    ...(data.photo == null ? {} : { photo: parsePhoto(data.photo) }),
    education: items<TimelineItem>('education', ['period', 'description']),
    career: careers(),
    qualifications: items<TimelineItem>('qualifications', ['period', 'description']),
    skills: skills.filter((skill): skill is string => skill != null), summary: string('summary'),
    motivation: string('motivation'), notes: string('notes'),
    targetRole: optionalString('targetRole'), strengths: optionalString('strengths'),
    careerOverview: optionalString('careerOverview'), sharedProjects: projects(data.sharedProjects),
    improvements: optionalString('improvements'), activities: optionalString('activities'),
  });
}

export function emptyProfile(): Profile {
  return {
    name: '', kana: '', birthday: '', address: '', email: '', phone: '',
    gender: '', postalCode: '', addressKana: '', contactPostalCode: '', contactAddressKana: '', contactAddress: '', contactPhone: '', contactEmail: '',
    education: [{ period: '', description: '' }],
    career: [{ id: 'legacy-career-0', period: '', company: '', role: '', description: '' }],
    qualifications: [], skills: [], summary: '', motivation: '', notes: '', targetRole: '', strengths: '',
    careerOverview: '', sharedProjects: [], improvements: '', activities: '',
  };
}
