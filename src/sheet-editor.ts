import { html, render } from 'lit-html';
import type { Profile } from './profile.ts';
import { applyEditor, collectionEntries, editorSpec, removeEntry, moveEntry, yearMonthParts, yearMonthValue } from './editor-model.ts';
import type { ValidationIssue } from './validation.ts';

interface EditResult { valid: boolean; profile?: Profile; path?: string }
let pendingEdit: (() => boolean) | null = null;
let activeClose: (() => void) | null = null;
let activeFinish: (() => EditResult) | null = null;

export const hasPendingSheetEdits = () => pendingEdit?.() ?? false;
export const finishSheetEdit = (): EditResult => activeFinish?.() ?? { valid: true };
export function closeSheetEditors() { activeClose?.(); }

export function openSheetEditor(profile: Profile, path: string, adding: boolean, onCommit: (next: Profile, reason?: 'blur') => void, anchor?: HTMLElement, basicLocked = false) {
  // Finish or cancel the current draft before opening another field.
  if (activeClose) return;
  const spec = editorSpec(profile, path, adding, basicLocked);
  anchor ??= document.querySelector<HTMLElement>(`#pages [${adding ? 'data-add' : 'data-edit'}="${path}"]`) ?? undefined;
  if (!spec || !anchor) return;
  const original = adding ? null : anchor;
  const editor = document.createElement(spec.collection ? 'div' : 'span');
  editor.className = `sheet-editor no-print ${spec.collection ? 'sheet-editor--row' : 'sheet-editor--scalar'}`;
  editor.setAttribute('role', 'group');
  editor.setAttribute('aria-label', spec.title);
  editor.dataset.editorPath = spec.path;
  let inserted: HTMLElement = editor;
  const tableRow = anchor.closest<HTMLTableRowElement>('tr');
  const table = adding && !tableRow ? anchor.closest('.resume-qualifications,.document-section')?.querySelector('table') : null;
  if (spec.collection && (tableRow || table)) {
    const row = document.createElement('tr');
    row.className = 'sheet-editor-row no-print';
    const cell = document.createElement('td');
    cell.colSpan = tableRow ? [...tableRow.cells].reduce((sum, cell) => sum + cell.colSpan, 0) : table?.classList.contains('resume-timeline') ? 3 : 2;
    cell.append(editor); row.append(cell); inserted = row;
    if (adding && tableRow) tableRow.after(row);
    else if (tableRow) tableRow.before(row);
    else {
      const body = table!.querySelector('tbody')!;
      body.insertBefore(row, body.querySelector('.resume-blank'));
    }
  } else if (adding) {
    (anchor.closest('.project-list') ?? anchor.closest('.document-section'))?.append(editor);
  } else anchor.before(editor);
  if (!editor.isConnected) return;
  original?.classList.add('sheet-edit-original');
  const page = editor.closest<HTMLElement>('.pagedjs_page');
  if (page) {
    page.style.setProperty('--sheet-edit-page-height', `${page.getBoundingClientRect().height}px`);
    page.classList.add('sheet-page-editing');
  }
  let issues: ValidationIssue[] = [];
  let attempted = false;
  const values = Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));
  const hints = Object.fromEntries(spec.fields.map((field) => [field.key, [field.hint, field.type === 'textarea' ? 'Enterで反映、Shift＋Enterで改行できます。' : ''].filter(Boolean).join(' ')]));
  const changed = () => spec.fields.some((field) => values[field.key] !== field.value);
  pendingEdit = changed;
  let closed = false;
  let pointerActive = false;
  let composing = false;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const pointerDown = () => { pointerActive = true; };
  const pointerUp = () => { pointerActive = false; scheduleBlur(); };
  const close = () => {
    closed = true; clearTimeout(blurTimer);
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', pointerUp, true);
    editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach((input) => { input.value = ''; });
    inserted.remove(); original?.classList.remove('sheet-edit-original');
    page?.classList.remove('sheet-page-editing'); page?.style.removeProperty('--sheet-edit-page-height');
    pendingEdit = null; activeClose = null; activeFinish = null;
  };
  activeClose = close;
  const cancel = () => { close(); anchor?.focus({ preventScroll: true }); };
  const updateErrors = () => {
    for (const field of spec.fields) {
      const fieldPath = spec.collection ? `${spec.path}.${field.key}` : spec.path;
      const errors = issues.filter((issue) => issue.path === fieldPath || (field.key === 'period' && issue.path.startsWith(`${spec.collection}.`)));
      const container = editor.querySelector<HTMLElement>(`[data-field="${field.key}"]`)!;
      container.querySelectorAll('input,textarea,select').forEach((input) => input.setAttribute('aria-invalid', String(!!errors.length)));
      const hint = container.querySelector<HTMLElement>('.sheet-inline-hint')!;
      hint.classList.toggle('field-error', !!errors.length);
      hint.textContent = errors.map((issue) => issue.message).join(' ') || hints[field.key];
    }
  };
  const check = () => { issues = applyEditor(profile, spec, values).issues; updateErrors(); };
  const validate = (focusError = true) => {
    attempted = true;
    const result = applyEditor(profile, spec, values);
    issues = result.issues; updateErrors();
    if (issues.length) { if (focusError) editor.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); return null; }
    return result.profile;
  };
  const finish = (explicit: boolean, focusError = true): EditResult => {
    if (!explicit && !changed()) { close(); return { valid: true }; }
    const next = validate(focusError);
    if (!next) return { valid: false };
    close(); return { valid: true, profile: next, path: spec.path };
  };
  activeFinish = () => finish(false);
  const apply = () => {
    const result = finish(true);
    if (result.profile) onCommit(result.profile);
  };
  function scheduleBlur() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      // Let pointer clicks (including Cancel) finish before changing the paper.
      if (closed || pointerActive || composing || editor.contains(document.activeElement)) return;
      const result = finish(false, false);
      if (result.profile) onCommit(result.profile, 'blur');
    }, 0);
  }
  render(html`<span class="sheet-inline-fields ${spec.collection === 'career' || spec.collection === 'sharedProjects' ? 'sheet-inline-career' : spec.collection ? 'sheet-inline-timeline' : ''}">
    ${spec.fields.map((field) => {
      const id = `inline-${field.key}`;
      const blur = () => { if (attempted || values[field.key]) check(); };
      const input = (event: Event) => { values[field.key] = (event.target as HTMLInputElement).value; if (attempted) check(); };
      if (field.type === 'career-links') {
        return html`<span class="sheet-inline-field sheet-inline-affiliations" data-field=${field.key} role="group" aria-labelledby=${`${id}-label`}>
          <span id=${`${id}-label`} class="sheet-inline-label">${field.label}</span>
          ${(field.options ?? []).map((option) => html`<label><input type="checkbox" name=${field.key} value=${option.value} .checked=${values[field.key].split(',').includes(option.value)} aria-describedby=${`${id}-hint`} @change=${() => {
            values[field.key] = [...editor.querySelectorAll<HTMLInputElement>('[name="careerIds"]:checked')].map((checkbox) => checkbox.value).join(',');
            if (attempted) check();
          }} />${option.label}</label>`)}
          <span id=${`${id}-hint`} class="sheet-inline-hint" aria-live="polite">${hints[field.key]}</span>
        </span>`;
      }
      if (field.type === 'year-month') {
        const parts = yearMonthParts(values[field.key]);
        const changePart = (part: 'year' | 'month', value: string) => {
          const current = yearMonthParts(values[field.key]);
          values[field.key] = yearMonthValue(part === 'year' ? value : current.year, part === 'month' ? value : current.month);
          if (attempted) check();
        };
        return html`<span class="sheet-inline-field sheet-inline-period" data-field=${field.key}>
          <span class="sheet-inline-month-inputs">
            <span><label for=${`${id}-year`}>年</label><input id=${`${id}-year`} name="period-year" type="number" inputmode="numeric" min="1900" max="2100" step="1" placeholder="2024" .value=${parts.year} aria-describedby=${`${id}-hint`} @input=${(event: Event) => changePart('year', (event.target as HTMLInputElement).value)} @blur=${blur} /></span>
            <span><label for=${`${id}-month`}>月</label><select id=${`${id}-month`} name="period-month" aria-describedby=${`${id}-hint`} @change=${(event: Event) => {
              changePart('month', (event.target as HTMLSelectElement).value);
              editor.querySelectorAll<HTMLButtonElement>('.month-shortcuts button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.month === yearMonthParts(values.period).month)));
            }} @blur=${blur}><option value="" .selected=${!parts.month}>選択</option>${Array.from({ length: 12 }, (_, index) => html`<option value=${String(index + 1)} .selected=${parts.month === String(index + 1)}>${index + 1}月</option>`)}</select></span>
          </span>
          <span class="month-shortcuts">${[3, 4].map((month) => html`<button type="button" data-month=${String(month)} aria-pressed=${parts.month === String(month)} @click=${() => {
            changePart('month', String(month));
            (editor.querySelector('[name="period-month"]') as HTMLSelectElement).value = String(month);
            editor.querySelectorAll<HTMLButtonElement>('.month-shortcuts button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.month === String(month))));
          }}>${month}月</button>`)}</span>
          <span id=${`${id}-hint`} class="sheet-inline-hint" aria-live="polite">${field.hint}</span>
        </span>`;
      }
      return html`<span class="sheet-inline-field ${field.key === 'description' ? 'sheet-inline-description' : ''}" data-field=${field.key}><label class=${spec.collection ? '' : 'sr-only'} for=${id}>${field.label}</label>
        ${field.type === 'textarea' ? html`<textarea id=${id} name=${field.key} .value=${values[field.key]} maxlength=${field.maxLength} rows=${spec.collection ? 2 : 3} aria-describedby=${`${id}-hint`} @input=${input} @blur=${blur}></textarea>` : html`<input id=${id} name=${field.key} type=${field.type} .value=${values[field.key]} maxlength=${field.maxLength} aria-describedby=${`${id}-hint`} @input=${input} @blur=${blur} />`}
        <span id=${`${id}-hint`} class="sheet-inline-hint" aria-live="polite">${hints[field.key]}</span>
      </span>`;
    })}
    </span>
    <span class="sheet-inline-actions">
      ${spec.collection && !spec.adding ? html`<button type="button" class="button danger" @click=${() => { if (window.confirm('この行を削除しますか？')) { const next = removeEntry(profile, spec.collection!, spec.index!); close(); onCommit(next); } }}>この行を削除</button>
        ${([-1, 1] as const).map((direction) => html`<button type="button" class="button secondary" ?disabled=${direction === -1 ? spec.index === 0 : spec.index === collectionEntries(profile, spec.collection!).length - 1} @click=${() => { const next = validate(); if (next) { const moved = moveEntry(next, spec.collection!, spec.index!, direction); close(); onCommit(moved); } }}>${direction === -1 ? '上へ' : '下へ'}</button>`)}` : ''}
      <button type="button" class="button secondary" @click=${cancel}>キャンセル</button><button type="button" class="button primary" @click=${apply}>反映</button>
    </span>`, editor);
  editor.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent) || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (event.key === 'Enter' && !event.shiftKey && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault(); event.stopPropagation(); apply();
    }
  });
  editor.addEventListener('focusout', scheduleBlur);
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; scheduleBlur(); });
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointerup', pointerUp, true);
  document.addEventListener('pointercancel', pointerUp, true);
  editor.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea,select')?.focus({ preventScroll: true });
  editor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
