import { html, render } from 'lit-html';
import { Previewer } from 'pagedjs';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/600.css';
import './style.css';
import documentCSS from './document.css?url';
import sampleJSON from '../examples/profile.example.json?raw';
import { decryptProfile, encryptProfile, parseEncrypted } from './crypto.ts';
import type { EncryptedProfile } from './crypto.ts';
import { emptyProfile, parseProfile } from './profile.ts';
import type { Profile } from './profile.ts';
import { documentTemplate } from './documents.ts';
import type { DocumentType } from './documents.ts';
import { loadEncryptedFile, loadResumeContent, savePublicFile, CONTENT_FILE_PATH } from './profile-file.ts';
import { basicInfoFrom, resumeContentFrom, encryptedBasicInfo, needsCompanyEncryption, profileWithContent, restoreProfile, publicPreviewProfile, contentForUnlock, isEncryptedField } from './profile-storage.ts';

import { openSheetEditor, closeSheetEditors, hasPendingSheetEdits, finishSheetEdit } from './sheet-editor.ts';
import { openPhotoEditor, closePhotoEditors, hasPendingPhotoEdits } from './photo-editor.ts';
import { normalizeProfile, validateProfile, profileForStorage } from './validation.ts';
import type { ValidationIssue, ValidationScope } from './validation.ts';
import { createContentSaveQueue } from './content-save-queue.ts';

const root = document.querySelector<HTMLDivElement>('#app')!;
let profile: Profile | null = null;
let encrypted: EncryptedProfile | null = null;
let draft = '';
let contentDraft = '';
let storedContent = resumeContentFrom(emptyProfile());
let hasStoredContent = false;
let contentLoadError = '';
let companyMigrationPending = false;
let documentType: DocumentType = 'career';
let mode: 'sample' | 'new' | 'private' | 'public' | null = null;
let busy = false;
let booting = true;
let message = '';
let error = '';
let pageCount = 0;
let generation = 0;
let savedDraft = '';
let savedContentDraft = '';
let activePreviewer: Previewer | null = null;
let issues: ValidationIssue[] = [];
let profileSession = 0;
let contentSaving = 0;
let contentSaveError = '';
const contentSaveQueue = createContentSaveQueue((snapshot) => savePublicFile('resume-content.json', snapshot, import.meta.env.BASE_URL));

function contentSnapshot(value: Profile) {
  return JSON.stringify(resumeContentFrom(profileForStorage(value, mode === 'public')), null, 2);
}

function disposePreviewer() {
  const previous = activePreviewer;
  activePreviewer = null;
  if (!previous) return;
  // A failed preview may not have initialized both internal objects.
  try { previous.chunker.destroy(); } catch { /* No initialized page area. */ }
  try { previous.polisher.destroy(); } catch { /* No initialized stylesheet. */ }
}

function notify(text: string, failed = false) {
  message = failed ? '' : text;
  error = failed ? text : '';
  renderApp();
}

function clearPasswords() {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ''; });
}

function renderApp() {
  render(html`
    <header class="app-header no-print">
      <a class="brand" href="/" aria-label="Local Resume ホーム"><span class="brand-icon">R</span><span>Local Resume</span></a>
    </header>
    <main class="workspace">
      <aside class="controls no-print">
        <div role="status" aria-live="polite" class="notice ${message ? '' : 'empty'}">${message}</div>
        <div role="alert" class="notice error ${error ? '' : 'empty'}">${error}</div>
        <section class="control-card identity-card">
          <div class="card-heading"><h2>基本情報・会社名</h2>${mode === 'sample' ? html`<span class="mode-badge">サンプル</span>` : ''}</div>
          ${mode === 'public' || !profile ? html`
            <form @submit=${unlock} autocomplete="off">
              <label for="unlock-password">パスワード</label>
              <input id="unlock-password" name="password" type="password" autocomplete="off" required maxlength="1024" ?disabled=${busy || booting} />
              <button class="button primary wide" type="submit" ?disabled=${busy || booting}>${busy ? '解除しています…' : 'パスワードで開く'}</button>
            </form>
          ` : html`<button class="button secondary wide" @click=${lock} ?disabled=${busy}>基本情報をロック</button>`}
        </section>
        ${profile ? html`
          ${issues.length ? html`<div class="validation-summary" role="alert"><p>入力を確認してください。</p><ul>${issues.map((issue) => html`<li><button type="button" @click=${() => editIssue(issue.path)}>${issue.message}</button></li>`)}</ul></div>` : ''}
          <div class="save-feedback" role=${contentSaveError ? 'alert' : 'status'} data-content-save-state=${contentSaveError ? 'error' : contentSaving ? 'saving' : contentDraft === savedContentDraft ? 'saved' : 'unsaved'} ?hidden=${!contentSaveError && !contentSaving && contentDraft === savedContentDraft}>
            <p class=${contentSaveError ? 'field-error content-save-error' : 'save-hint'}>${contentSaveError || (contentSaving ? '保存中…' : '未保存')}</p>
            ${contentSaveError ? html`<button class="button secondary wide" @click=${saveContent} ?disabled=${busy || contentSaving > 0}>書類内容を保存</button>` : ''}
          </div>
          ${mode !== 'public' && (mode === 'new' || draft !== savedDraft || companyMigrationPending) ? html`<section class="control-card">
            <h2>基本情報を保存</h2>
            <form @submit=${saveEncrypted} autocomplete="off">
              <label for="save-password">パスワード</label>
              <input id="save-password" name="password" type="password" autocomplete="new-password" maxlength="1024" required ?disabled=${busy} />
              <label for="confirm-password">パスワードを再入力</label>
              <input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" maxlength="1024" required ?disabled=${busy} />
              <button class="button primary wide" type="submit" ?disabled=${busy}>${busy ? '保存しています…' : '暗号化ファイルを保存'}</button>
            </form>
          </section>` : ''}
        ` : ''}
        <details class="secondary-controls">
          <summary>その他</summary>
          ${mode === 'public' || !profile ? html`
            <button class="button secondary wide" @click=${beginBasicInfo} ?disabled=${busy || booting}>基本情報を新しく入力</button>
            <label class="button secondary wide file-button">暗号化ファイルを選ぶ
              <input type="file" accept=".json,application/json" @change=${openEncrypted} ?disabled=${busy || booting} />
            </label>` : ''}
          <button class="button secondary wide" @click=${boot} ?disabled=${busy || booting}>書類内容を再読み込み</button>
          ${profile && !contentSaveError ? html`<button class="button secondary wide" @click=${saveContent} ?disabled=${busy || contentSaving > 0}>書類内容を保存</button>` : ''}
          <button class="button secondary wide" @click=${() => startProfile(parseProfile(sampleJSON), 'sample')} ?disabled=${busy || booting}>架空のサンプルで試す</button>
        </details>
      </aside>
      <section class="preview-panel" aria-label="書類プレビュー">
        <div class="preview-toolbar no-print">
          <div class="document-tabs" role="group" aria-label="書類の種類">
            <button class=${documentType === 'resume' ? 'active' : ''} aria-pressed=${documentType === 'resume'} @click=${() => switchDocument('resume')} ?disabled=${busy}>履歴書</button>
            <button class=${documentType === 'career' ? 'active' : ''} aria-pressed=${documentType === 'career'} @click=${() => switchDocument('career')} ?disabled=${busy}>職務経歴書</button>
          </div>
          <button class="button primary print-button" @click=${printDocument} ?disabled=${busy || !profile || pageCount === 0}>PDFに保存 <span>↓</span></button>
        </div>
        <div class="preview-meta no-print"><span>${busy ? '処理中…' : pageCount ? `${pageCount} ページ` : 'プレビュー'}</span></div>
        <div class="preview-stage">
          <div class="empty-preview no-print" ?hidden=${!!profile}>
            <div class="paper-symbol"><span></span><span></span><span></span><span></span></div>
            <p>${booting ? '読み込み中…' : '書類内容を再読み込みしてください。'}</p>
          </div>
          <div id="pages" aria-busy=${busy}></div>
        </div>
      </section>
    </main>`, root);
}

async function updatePreview() {
  if (!profile) return;
  closeSheetEditors();
  const current = ++generation;
  busy = true;
  pageCount = 0;
  renderApp();
  disposePreviewer();
  document.querySelector('#pages')!.replaceChildren();
  const source = document.createElement('div');
  render(documentTemplate(profile, documentType), source);
  const staging = document.createElement('div');
  staging.className = 'pagination-staging no-print';
  document.body.append(staging);
  // Paged.js can log DOM nodes on layout warnings. Suppress its diagnostics
  // while processing the document so decrypted content never enters logs.
  const previousWarn = console.warn;
  const previousError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await document.fonts.ready;
    const previewer = new Previewer();
    activePreviewer = previewer;
    const result = await previewer.preview(source, [documentCSS], staging);
    if (current !== generation) return;
    document.querySelector('#pages')!.replaceChildren(...Array.from(staging.children));
    pageCount = result.total;
  } catch {
    if (current === generation) error = 'プレビューを生成できませんでした。内容を確認して再度反映してください。';
  } finally {
    console.warn = previousWarn;
    console.error = previousError;
    source.replaceChildren();
    staging.remove();
    if (current === generation) { busy = false; renderApp(); }
  }
}

async function startProfile(value: Profile, origin: 'sample' | 'new' | 'private' | 'public', requiresCompanyEncryption = false) {
  ++profileSession;
  contentSaving = 0;
  contentSaveError = '';
  companyMigrationPending = requiresCompanyEncryption;
  clearPasswords();
  closeSheetEditors();
  closePhotoEditors();
  profile = normalizeProfile(value);
  value = profile;
  issues = validateProfile(value);
  mode = origin;
  draft = JSON.stringify(basicInfoFrom(value), null, 2);
  contentDraft = contentSnapshot(value);
  savedDraft = origin === 'public' || (origin === 'private' && !companyMigrationPending) ? draft : '';
  savedContentDraft = (origin === 'public' || !storedContent.career.some((job) => Boolean(job.company))) && contentDraft === contentSnapshot(profileWithContent(storedContent)) ? contentDraft : '';
  message = '';
  error = origin === 'sample' ? '' : contentLoadError;
  await updatePreview();
}

function syncDrafts() {
  if (!profile) return;
  draft = JSON.stringify(basicInfoFrom(profile), null, 2);
  contentDraft = contentSnapshot(profile);
}

async function commitProfile(next: Profile, path?: string, focusField = true) {
  const previousContent = contentDraft;
  const outsideFocus = !focusField && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const outsidePath = outsideFocus?.dataset.edit;
  profile = normalizeProfile(next);
  syncDrafts();
  if (mode === 'public') savedDraft = draft;
  issues = validateProfile(profile);
  error = '';
  message = '';
  if (contentDraft !== previousContent) void persistContent(true);
  const scroll = window.scrollY;
  await updatePreview();
  window.scrollTo({ top: scroll });
  if (focusField && path) root.querySelector<HTMLElement>(`#pages [data-edit="${path}"]`)?.focus({ preventScroll: true });
  if (focusField && path === 'photo') root.querySelector<HTMLElement>('#pages [data-photo]')?.focus({ preventScroll: true });
  if (!focusField && outsideFocus && document.hasFocus()) {
    const target = outsideFocus.isConnected ? outsideFocus : outsidePath ? root.querySelector<HTMLElement>(`#pages [data-edit="${outsidePath}"]`) : null;
    if (target && target !== document.body) target.focus({ preventScroll: true });
  }
}

async function flushSheetEditor() {
  const result = finishSheetEdit();
  if (!result.valid) return false;
  if (result.profile) await commitProfile(result.profile, result.path);
  return true;
}

async function editIssue(path: string) {
  if (!profile || busy) return;
  if (mode === 'public' && isEncryptedField(path)) { focusUnlock(); return; }
  if (path === 'photo') { await editPhoto(); return; }
  const row = path.match(/^sharedProjects\.\d+/)?.[0] ?? path.match(/^(education|career|qualifications)\.\d+/)?.[0];
  if (!await flushSheetEditor() || !profile) return;
  openSheetEditor(profile, row ?? path.split('.')[0], false, (next, reason) => { void commitProfile(next, row ?? path, reason !== 'blur'); }, undefined, mode === 'public');
}

async function openEditor(target: HTMLElement) {
  if (!profile || busy) return;
  if (target.hasAttribute('data-photo')) { await editPhoto(); return; }
  const path = target.dataset.edit ?? target.dataset.add;
  const adding = target.hasAttribute('data-add');
  if (!path) return;
  if (mode === 'public' && isEncryptedField(path)) { focusUnlock(); return; }
  if (!await flushSheetEditor() || !profile) return;
  if (adding && (path === 'education' || path === 'career' || path === 'qualifications') && profile[path].length >= 200) {
    notify('項目は200件まで追加できます。不要な行を削除してください。', true);
    return;
  }
  const anchor = target.isConnected ? target : root.querySelector<HTMLElement>(`#pages [${adding ? 'data-add' : 'data-edit'}="${path}"]`) ?? undefined;
  openSheetEditor(profile, path, adding, (next, reason) => { void commitProfile(next, path, reason !== 'blur'); }, anchor, mode === 'public');
}

async function editPhoto() {
  if (!profile || busy) return;
  if (mode === 'public') { focusUnlock(); return; }
  if (!await flushSheetEditor() || !profile) return;
  openPhotoEditor(profile, (next) => { void commitProfile(next, 'photo'); });
}

root.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.sheet-editor')) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-edit],[data-add],[data-photo]') : null;
  if (target && target.closest('#pages')) void openEditor(target);
});
root.addEventListener('keydown', (event) => {
  if (event.isComposing || (event.target instanceof Element && event.target.closest('.sheet-editor'))) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-edit],[data-photo]') : null;
  if (target && target.closest('#pages')) { event.preventDefault(); void openEditor(target); }
});

function validatedProfile(scope: ValidationScope, required = false): Profile | null {
  if (!profile) return null;
  const value = normalizeProfile(profile);
  issues = validateProfile(value, scope, required);
  if (issues.length) { notify('入力内容を確認してください。項目ごとの案内から修正できます。', true); return null; }
  return profileForStorage(value, mode === 'public');
}

async function persistContent(automatic: boolean): Promise<boolean> {
  if (!profile) return false;
  if (contentLoadError) { contentSaveError = contentLoadError; renderApp(); return false; }
  if (companyMigrationPending) {
    contentSaveError = '会社名の移行には、先に「暗号化ファイルを保存」が必要です。';
    renderApp(); return false;
  }
  const session = profileSession;
  const value = automatic ? profileForStorage(profile, mode === 'public') : validatedProfile('content');
  if (!value) return false;
  if (automatic && validateProfile(value, 'content').length) {
    contentSaveError = '入力内容を確認してください。エラーのある書類内容は自動保存できません。';
    renderApp(); return false;
  }
  const content = resumeContentFrom(value);
  const snapshot = JSON.stringify(content, null, 2);
  if (automatic && snapshot === savedContentDraft && !contentSaving) return true;
  ++contentSaving;
  contentSaveError = '';
  renderApp();
  try {
    await contentSaveQueue.save(snapshot);
    if (session !== profileSession || !profile) return false;
    storedContent = content;
    hasStoredContent = true;
    contentLoadError = '';
    savedContentDraft = snapshot;
    if (snapshot === contentDraft) contentSaveError = '';
    if (!automatic) { message = '保存しました。'; error = ''; }
    return true;
  } catch (cause) {
    if (session === profileSession && profile && snapshot === contentDraft) contentSaveError = cause instanceof Error ? cause.message : '自動保存できませんでした。「書類内容を保存」で再試行してください。';
    return false;
  } finally {
    if (session === profileSession) { --contentSaving; renderApp(); }
  }
}

async function saveContent() {
  if (busy || contentSaving) return;
  if (!await flushSheetEditor()) return;
  await persistContent(false);
}

async function switchDocument(type: DocumentType) {
  if (busy || type === documentType) return;
  if (!await flushSheetEditor()) return;
  documentType = type;
  if (profile) await updatePreview(); else renderApp();
}

async function unlock(event: SubmitEvent) {
  event.preventDefault();
  if (!profile || busy || booting) return;
  const input = root.querySelector<HTMLInputElement>('#unlock-password')!;
  const password = input.value;
  input.value = '';
  if (!await flushSheetEditor() || !profile) return;
  const currentContent = contentForUnlock(profile, storedContent);
  const useCurrentContent = hasStoredContent || contentDraft !== savedContentDraft;
  busy = true;
  error = '';
  renderApp();
  try {
    if (!crypto.subtle) throw new Error('このブラウザでは暗号化機能を利用できません。localhost で開いてください。');
    encrypted ??= await loadEncryptedFile(import.meta.env.BASE_URL);
    if (!encrypted) throw new Error('暗号化ファイルが見つかりません。「その他」からファイルを選ぶか、基本情報を新しく入力してください。');
    const plaintext = await decryptProfile(encrypted, password);
    const value = restoreProfile(plaintext, currentContent, useCurrentContent);
    await startProfile(value, 'private', needsCompanyEncryption(plaintext, currentContent));
  } catch (cause) { notify(cause instanceof Error ? cause.message : 'データを開けませんでした。', true); }
  finally { busy = false; clearPasswords(); renderApp(); }
}

async function openEncrypted(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('ファイルは2MB以内にしてください。');
    encrypted = parseEncrypted(await file.text());
    notify('ファイルを選択しました。');
  } catch (cause) { notify(cause instanceof Error ? cause.message : 'ファイルを開けませんでした。', true); }
}

async function saveEncrypted(event: SubmitEvent) {
  event.preventDefault();
  if (busy) return;
  if (mode === 'public') { focusUnlock(); return; }
  const passwordInput = root.querySelector<HTMLInputElement>('#save-password')!;
  const confirmationInput = root.querySelector<HTMLInputElement>('#confirm-password')!;
  const password = passwordInput.value;
  const confirmation = confirmationInput.value;
  clearPasswords();
  if (password !== confirmation) { notify('パスワードが一致しません。', true); return; }
  try {
    if (!await flushSheetEditor()) return;
    const value = validatedProfile('basic');
    if (!value) return;
    busy = true;
    error = '';
    renderApp();
    const data = await encryptProfile(encryptedBasicInfo(value), password);
    await savePublicFile('profile.enc.json', JSON.stringify(data, null, 2), import.meta.env.BASE_URL);
    encrypted = data;
    profile = value;
    mode = 'private';
    syncDrafts();
    savedDraft = draft;
    const migrateContent = companyMigrationPending || storedContent.career.some((job) => Boolean(job.company));
    companyMigrationPending = false;
    if (migrateContent) await persistContent(true);
    message = '保存しました。';
    await updatePreview();
  } catch (cause) { notify(cause instanceof Error ? cause.message : '暗号化して保存できませんでした。', true); }
  finally { busy = false; clearPasswords(); renderApp(); }
}

async function printDocument() {
  if (busy || !profile) return;
  // Print the current editor contents, not a stale preview.
  try {
    if (!await flushSheetEditor()) return;
    const value = validatedProfile('all', mode !== 'public');
    if (!value) return;
    profile = value;
    syncDrafts();
    closeSheetEditors();
    closePhotoEditors();
    error = '';
    await updatePreview();
    if (!error && pageCount) {
      document.title = documentType === 'resume' ? '履歴書' : '職務経歴書';
      window.print();
      document.title = 'Local Resume — 履歴書・職務経歴書';
    }
  } catch (cause) { notify(cause instanceof Error ? cause.message : 'JSONを確認してください。', true); }
}

async function lock() {
  if (hasUnsavedChanges() && !window.confirm('保存していない編集内容を破棄してロックしますか？')) return;
  ++generation;
  ++profileSession;
  contentSaving = 0;
  contentSaveError = '';
  closeSheetEditors();
  companyMigrationPending = false;
  closePhotoEditors();
  clearPasswords();
  root.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((editor) => { editor.value = ''; });
  disposePreviewer();
  profile = null;
  issues = [];
  draft = '';
  contentDraft = '';
  savedDraft = '';
  savedContentDraft = '';
  mode = null;
  pageCount = 0;
  busy = false;
  message = '';
  error = '';
  document.querySelector('#pages')!.replaceChildren();
  document.querySelectorAll('.pagination-staging').forEach((element) => element.remove());
  await startProfile(publicPreviewProfile(storedContent), 'public', storedContent.career.some((job) => Boolean(job.company)));
}

function focusUnlock() {
  notify('基本情報を表示・編集するには、パスワードを入力してください。');
  root.querySelector<HTMLInputElement>('#unlock-password')?.focus();
}

async function beginBasicInfo() {
  if (!profile || busy || booting) return;
  if (!await flushSheetEditor() || !profile) return;
  await startProfile(profileWithContent(contentForUnlock(profile, storedContent)), 'new', companyMigrationPending);
}

function hasUnsavedChanges() {
  return contentSaving > 0 || hasPendingSheetEdits() || hasPendingPhotoEdits() || (!!profile && (draft !== savedDraft || contentDraft !== savedContentDraft));
}

window.addEventListener('beforeunload', (event) => {
  if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => {
  closeSheetEditors();
  closePhotoEditors();
  clearPasswords();
  root.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((input) => { input.value = ''; });
});

async function boot() {
  if (busy) return;
  if (profile && hasUnsavedChanges() && !window.confirm('保存していない編集内容を破棄して書類内容を再読み込みしますか？')) return;
  booting = true;
  encrypted = null;
  error = '';
  message = '';
  contentLoadError = '';
  renderApp();
  try {
    const content = await loadResumeContent(import.meta.env.BASE_URL);
    hasStoredContent = content !== null;
    storedContent = content ?? resumeContentFrom(emptyProfile());
    await startProfile(publicPreviewProfile(storedContent), 'public', storedContent.career.some((job) => Boolean(job.company)));
  } catch {
    hasStoredContent = false;
    contentLoadError = `${CONTENT_FILE_PATH} を読み込めませんでした。保存先とJSONの形式を確認してください。`;
    error = contentLoadError;
  } finally { booting = false; renderApp(); }
}

void boot();
