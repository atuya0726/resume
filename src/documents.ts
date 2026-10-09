import { html } from 'lit-html';
import type { CareerProject, Profile, TimelineItem } from './profile.ts';
import { photoStyle } from './photo.ts';
import { proseBlocks } from './document-prose.ts';
import { careerRows } from './resume-history.ts';
import { careerId } from './profile.ts';

export type DocumentType = 'resume' | 'career';

function field(value: string | undefined, path: string, label: string, placeholder = '未入力') {
  return html`<span class="sheet-field" data-edit=${path} role="button" tabindex="0" aria-label=${`${label}を編集`} title="クリックして編集">${value || html`<span class="sheet-placeholder">${placeholder}</span>`}</span>`;
}

function rowText(value: string | undefined) {
  return value || html`<span class="sheet-placeholder">未入力</span>`;
}

function prose(value: string, lineItems = false) {
  return proseBlocks(value, lineItems).map((block) => block.kind === 'list'
    ? html`<ul>${block.items.map((item) => html`<li>${item}</li>`)}</ul>`
    : block.kind === 'heading' ? html`<h4>${block.text}</h4>` : html`<p>${block.text}</p>`);
}

function proseField(value: string | undefined, path: string, label: string) {
  return html`<div class="sheet-field career-prose" data-edit=${path} role="button" tabindex="0" aria-label=${`${label}を編集`} title="クリックして編集">${value ? prose(value) : rowText(value)}</div>`;
}

function sectionTitle(title: string, number: string, extra?: ReturnType<typeof addEntry>) {
  return html`<h2><span class="section-number" aria-hidden="true">${number}</span>${title}${extra ?? ''}</h2>`;
}

function addEntry(collection: string, label: string) {
  return html`<button type="button" class="sheet-add no-print" data-add=${collection} aria-label=${`${label}を追加`}>＋ ${label}</button>`;
}

function timeline(title: string, items: TimelineItem[], number: string) {
  return html`<section class="document-section">
    ${sectionTitle(title, number, addEntry('qualifications', '資格'))}
    <table class="timeline"><thead><tr><th>年月・期間</th><th>${title}</th></tr></thead>
      <tbody>${items.map((item, index) => html`<tr class="sheet-row" data-edit=${`qualifications.${index}`} role="button" tabindex="0" aria-label=${`資格${index + 1}を編集`}><td>${rowText(item.period)}</td><td>${rowText(item.description)}</td></tr>`)}</tbody>
    </table>
  </section>`;
}

function monthParts(period: string) {
  return period.trim().match(/^(\d{4}|(?:令和|平成|昭和)(?:\d+|元))年\s*(\d{1,2})月$/);
}

function resumeRows(groups: { title?: string; collection: string; items: (TimelineItem & { path?: string })[] }[], end = false) {
  const rows = groups.flatMap((group) => [
    ...(group.title ? [html`<tr class="resume-group"><td></td><td></td><td>${group.title}${addEntry(group.collection, group.title)}</td></tr>`] : []),
    ...group.items.map((item, index) => {
      const path = item.path ?? `${group.collection}.${index}`;
      const label = `${group.title ?? '資格'}${index + 1}`;
      const parts = monthParts(item.period);
      return html`<tr class="sheet-row" data-edit=${path} role="button" tabindex="0" aria-label=${`${label}を編集`}>${parts ? html`<td>${parts[1]}</td><td>${Number(parts[2])}</td>` : html`<td colspan="2" class="resume-period">${rowText(item.period)}</td>`}<td>${rowText(item.description)}</td></tr>`;
    }),
  ]);
  if (end && groups.some((group) => group.items.length)) rows.push(html`<tr class="resume-end"><td></td><td></td><td>以上</td></tr>`);
  return rows;
}

function resumeTimeline(title: string, content: ReturnType<typeof resumeRows>, minimumRows: number) {
  const rows = [...content];
  while (rows.length < minimumRows) rows.push(html`<tr class="resume-blank"><td></td><td></td><td></td></tr>`);
  return html`<table class="resume-timeline" aria-label=${title}>
    <colgroup><col class="resume-year" /><col class="resume-month" /><col /></colgroup>
    <thead><tr><th scope="col">年</th><th scope="col">月</th><th scope="col">${title}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function birthdayWithAge(birthday: string, today: Date) {
  const parts = birthday.trim().match(/^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})日?$/);
  if (!parts) return birthday || '年　　月　　日（満　　歳）';
  const [, year, month, day] = parts.map(Number);
  const born = new Date(year, month - 1, day);
  if (born.getFullYear() !== year || born.getMonth() !== month - 1 || born.getDate() !== day || born > today) return birthday;
  const beforeBirthday = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  return `${year}年${month}月${day}日（満${today.getFullYear() - year - Number(beforeBirthday)}歳）`;
}

function projectTemplate(project: CareerProject, path: string, index: number, profile: Profile) {
  const affiliations = profile.career.flatMap((job, jobIndex) => project.careerIds?.includes(careerId(job, jobIndex))
    ? [`${job.company || `職歴${jobIndex + 1}`}${job.period ? `（${job.period}）` : ''}`] : []);
  const narrative = [
    ['概要', project.overview], ['担当フェーズ', project.phases], ['担当業務', project.tasks], ['実績・取り組み', project.achievements],
  ];
  const details = [
    ['OS', project.os], ['DB', project.database], ['NW／サーバー・クラウド', project.infrastructure], ['言語・ツール', project.languages],
    ['役割', project.role], ['体制・規模・工数', project.team],
  ];
  return html`<section class="career-project sheet-row" data-edit=${path} role="button" tabindex="0" aria-label=${`案件${index + 1}を編集`}>
    <div class="project-heading"><h4><span class="project-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>${rowText(project.name)}</h4><p>${rowText(project.period)}</p></div>
    ${affiliations.length ? html`<p class="project-affiliations">所属：${affiliations.join(' ／ ')}</p>` : ''}
    ${narrative.filter(([, value]) => value).map(([label, value]) => html`<div class="project-detail"><h5>${label}</h5><div class="career-prose">${prose(value, label === '担当業務')}</div></div>`)}
    ${details.some(([, value]) => value) ? html`<table class="project-specs" aria-label="案件の技術・体制"><tbody>${details.filter(([, value]) => value).map(([label, value]) => html`<tr><th scope="row">${label}</th><td>${value}</td></tr>`)}</tbody></table>` : ''}
  </section>`;
}

export function documentTemplate(profile: Profile, type: DocumentType) {
  const today = new Date();
  const date = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(today);
  const heading = html`<header class="document-header"><h1>${type === 'resume' ? '履歴書' : '職務経歴書'}</h1>
    <p>${date} 現在</p></header>`;
  if (type === 'resume') {
    const history = resumeRows([{ title: '学歴', collection: 'education', items: profile.education }, { title: '職歴', collection: 'career', items: careerRows(profile) }], true);
    return html`<article class="document resume-document">${heading}
      <div class="resume-identity">
        <table class="resume-personal" aria-label="氏名・生年月日"><colgroup><col /><col class="resume-gender-column" /></colgroup><tbody>
          <tr class="resume-kana"><td colspan="2"><span class="resume-inline-label">ふりがな</span>${field(profile.kana, 'kana', 'ふりがな')}</td></tr>
          <tr class="resume-name"><td colspan="2"><span class="resume-field-label">氏名</span><div>${field(profile.name, 'name', '氏名')}</div></td></tr>
          <tr class="resume-birthday"><td><span class="resume-inline-label">生年月日</span>${field(birthdayWithAge(profile.birthday, today), 'birthday', '生年月日')}</td><td><span class="resume-field-label">性別（任意）</span>${field(profile.gender, 'gender', '性別')}</td></tr>
        </tbody></table>
        <div class="resume-photo ${profile.photo ? 'has-photo' : ''}" data-photo role="button" tabindex="0" aria-label=${profile.photo ? '写真の切り取りを編集' : '写真を追加'} title="クリックして写真を編集">${profile.photo ? html`<img src=${profile.photo.dataUrl} style=${photoStyle(profile.photo)} alt="履歴書の写真" />` : html`<span class="no-print">写真を追加</span><span>縦40mm × 横30mm</span>`}</div>
      </div>
      <table class="resume-contact" aria-label="住所・連絡先"><colgroup><col /><col class="resume-contact-column" /></colgroup><tbody>
        <tr class="resume-address-kana"><td><span class="resume-inline-label">ふりがな</span>${field(profile.addressKana, 'addressKana', '現住所のふりがな')}</td><td rowspan="2" class="resume-contact-methods"><div><span class="resume-field-label">電話</span>${field(profile.phone, 'phone', '電話番号')}</div><div><span class="resume-field-label">E-mail</span>${field(profile.email, 'email', 'メールアドレス')}</div></td></tr>
        <tr class="resume-address"><td><span class="resume-field-label">現住所　〒 ${field(profile.postalCode, 'postalCode', '郵便番号')}</span><div>${field(profile.address, 'address', '現住所')}</div></td></tr>
        <tr class="resume-address-kana"><td><span class="resume-inline-label">ふりがな</span>${field(profile.contactAddressKana, 'contactAddressKana', '連絡先のふりがな')}</td><td rowspan="2" class="resume-contact-methods"><div><span class="resume-field-label">電話</span>${field(profile.contactPhone, 'contactPhone', '連絡先の電話番号')}</div><div><span class="resume-field-label">E-mail</span>${field(profile.contactEmail, 'contactEmail', '連絡先のメールアドレス')}</div></td></tr>
        <tr class="resume-address"><td><span class="resume-field-label">連絡先　〒 ${field(profile.contactPostalCode, 'contactPostalCode', '連絡先の郵便番号')}<span class="resume-contact-hint">（現住所以外に連絡を希望する場合）</span></span><div>${field(profile.contactAddress, 'contactAddress', '連絡先住所')}</div></td></tr>
      </tbody></table>
      <div class="resume-history">
        ${resumeTimeline('学歴・職歴', history.slice(0, 14), 14)}
      </div>
      <section class="resume-second-page" aria-label="学歴・職歴の続き・資格・本人希望">
        ${history.length > 14 ? resumeTimeline('学歴・職歴（続き）', history.slice(14), 10) : ''}
        <div class="resume-qualifications">${addEntry('qualifications', '資格')}${resumeTimeline('免許・資格', resumeRows([{ collection: 'qualifications', items: profile.qualifications }]), 6)}</div>
        <section class="resume-entry resume-notes"><h2>本人希望記入欄<span>（給与・職種・勤務時間・勤務地などの希望）</span></h2><div>${field(profile.notes, 'notes', '本人希望')}</div></section>
      </section>
    </article>`;
  }
  let section = 0;
  const title = (label: string, extra?: ReturnType<typeof addEntry>) => sectionTitle(label, String(++section).padStart(2, '0'), extra);
  return html`<article class="document career-document">${heading}
    <div class="career-intro">
      <p class="career-name">${field(profile.name, 'name', '氏名')}</p>
      <p class="career-target ${profile.targetRole ? '' : 'no-print'}">応募職種：${field(profile.targetRole, 'targetRole', '応募職種')}</p>
    </div>
    <section class="document-section career-summary">${title('職務要約')}${proseField(profile.summary, 'summary', '職務経歴要約')}</section>
    <section class="document-section">${title('職務経歴', addEntry('career', '職歴'))}
      ${profile.careerOverview ? proseField(profile.careerOverview, 'careerOverview', '職務経歴の概要') : ''}
      <div class="employment-list">${profile.career.map((job, index) => html`<section class="job">
        <div class="job-info sheet-row" data-edit=${`career.${index}`} role="button" tabindex="0" aria-label=${`職歴${index + 1}を編集`}>
          <div class="job-heading"><h3>${field(job.company, `career.${index}.company`, '会社名', '会社名を入力')}</h3><p>${rowText(job.period)}</p></div>
          ${job.role ? html`<p class="job-role">${job.role}</p>` : ''}
          <div class="company-details">${[['事業内容', job.business], ['資本金', job.capital], ['従業員数', job.employees], ['設立', job.established], ['売上高', job.revenue]].filter(([, value]) => value).map(([label, value]) => html`<p><span>${label}</span>${value}</p>`)}</div>
          ${job.description ? html`<div class="career-prose job-description">${prose(job.description)}</div>` : ''}
        </div>
      </section>`)}</div>
      <div class="project-list shared-projects ${profile.sharedProjects?.length ? '' : 'no-print'}"><h3 class="project-list-title">担当案件</h3>${addEntry('sharedProjects', '案件')}${(profile.sharedProjects ?? []).map((project, index) => projectTemplate(project, `sharedProjects.${index}`, index, profile))}</div>
    </section>
    ${profile.improvements ? html`<section class="document-section">${title('開発・業務改善')}${proseField(profile.improvements, 'improvements', '開発・業務改善')}</section>` : ''}
    ${profile.activities ? html`<section class="document-section">${title('技術活動・受賞実績')}${proseField(profile.activities, 'activities', '技術活動・受賞実績')}</section>` : ''}
    <section class="document-section">${title('活かせる経験・スキル')}${proseField(profile.strengths, 'strengths', '得意分野・活かせる経験')}</section>
    <section class="document-section">${title('技術スタック')}<div class="sheet-field career-prose" data-edit="skills" role="button" tabindex="0" aria-label="技術スキルを編集" title="クリックして編集">${profile.skills.length ? html`<ul class="skill-list">${profile.skills.map((skill) => html`<li>${skill}</li>`)}</ul>` : rowText('')}</div></section>
    ${timeline('保有資格', profile.qualifications, String(++section).padStart(2, '0'))}
    <section class="document-section">${title('自己PR')}${proseField(profile.motivation, 'motivation', '自己PR')}</section>
    <p class="career-end">以上</p>
  </article>`;
}
