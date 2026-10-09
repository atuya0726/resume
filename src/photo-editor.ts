import { html, render } from 'lit-html';
import type { Profile } from './profile.ts';
import { photoCrop } from './photo.ts';
import type { ResumePhoto } from './photo.ts';

let activeClose: (() => void) | null = null;
let pendingEdit: (() => boolean) | null = null;
function bitmapFrom(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
}
export const hasPendingPhotoEdits = () => pendingEdit?.() ?? false;
export function closePhotoEditors() { activeClose?.(); }

export function openPhotoEditor(profile: Profile, onCommit: (next: Profile) => void) {
  closePhotoEditors();
  const dialog = document.createElement('dialog');
  dialog.className = 'photo-editor no-print';
  dialog.setAttribute('aria-labelledby', 'photo-editor-title');
  let photo: ResumePhoto | undefined = profile.photo ? { ...profile.photo } : undefined;
  let bitmap: ImageBitmap | null = null;
  let loading = false;
  let error = '';
  let closed = false;
  let loadId = 0;
  const initial = JSON.stringify(photo);
  pendingEdit = () => loading || JSON.stringify(photo) !== initial;
  const close = () => {
    closed = true; loadId++; bitmap?.close(); bitmap = null; photo = undefined;
    dialog.querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvas) => { canvas.width = 0; canvas.height = 0; });
    dialog.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.value = ''; });
    dialog.close(); dialog.remove(); activeClose = null; pendingEdit = null;
  };
  activeClose = close;
  const paint = () => {
    const canvas = dialog.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (photo && bitmap) {
      const crop = photoCrop(photo);
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    }
  };
  const draw = () => {
    render(html`<div class="sheet-editor-heading"><h2 id="photo-editor-title">履歴書の写真</h2><button type="button" class="editor-close" aria-label="写真編集をキャンセル" @click=${close}>×</button></div>
      <p class="card-copy">写真をドラッグして位置を調整できます。切り取り枠は横3：縦4です。</p>
      <label class="button secondary file-button">${photo ? '別の写真を選ぶ' : '写真を選ぶ'}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="写真を選ぶ" ?disabled=${loading} @change=${(event: Event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0]; input.value = '';
        if (file) void importPhoto(file);
      }} /></label>
      <p class="field-hint">JPEG・PNG・WebP、15MBまで。写真はブラウザ内で処理し、基本情報と一緒に暗号化して保存します。</p>
      ${error ? html`<p class="field-error" role="alert">${error}</p>` : ''}
      <div class="photo-crop-preview" aria-busy=${loading}><canvas width="600" height="800" aria-label="切り取り後の写真プレビュー" @pointerdown=${startDrag} @pointermove=${drag} @pointerup=${endDrag} @pointercancel=${endDrag}></canvas>${!photo ? html`<span class="photo-empty">${loading ? '読み込み中…' : '写真を選んでください'}</span>` : ''}</div>
      <div class="photo-controls"><label for="photo-zoom">拡大 <output id="photo-zoom-value">${photo ? `${Math.round(photo.zoom * 100)}%` : '100%'}</output></label><input id="photo-zoom" type="range" min="1" max="4" step="0.01" .value=${String(photo?.zoom ?? 1)} ?disabled=${!photo || loading} @input=${(event: Event) => {
        if (!photo) return; photo.zoom = Number((event.target as HTMLInputElement).value); paint();
        dialog.querySelector('output')!.textContent = `${Math.round(photo.zoom * 100)}%`;
      }} />
      ${(['x', 'y'] as const).map((axis) => html`<label for=${`photo-${axis}`}>${axis === 'x' ? '左右の位置' : '上下の位置'}</label><input id=${`photo-${axis}`} type="range" min="0" max="1" step="0.001" .value=${String(photo?.[axis] ?? .5)} ?disabled=${!photo || loading} @input=${(event: Event) => { if (photo) { photo[axis] = Number((event.target as HTMLInputElement).value); paint(); } }} />`)}
      </div>
      <div class="sheet-editor-actions"><button type="button" class="button secondary" ?disabled=${!photo || loading} @click=${() => { if (photo) { photo.zoom = 1; photo.x = photo.y = .5; draw(); } }}>位置をリセット</button>
      ${profile.photo ? html`<button type="button" class="button danger" ?disabled=${loading} @click=${() => { const next = { ...profile }; delete next.photo; close(); onCommit(next); }}>写真を削除</button>` : ''}
      <button type="button" class="button secondary" @click=${close}>キャンセル</button><button type="button" class="button primary" ?disabled=${!photo || loading || !bitmap} @click=${() => { if (!photo) return; const next = { ...profile, photo: { ...photo } }; close(); onCommit(next); }}>反映</button></div>`, dialog);
    paint();
  };
  let pointer: { id: number; x: number; y: number; photoX: number; photoY: number } | null = null;
  function startDrag(event: PointerEvent) {
    if (!photo || loading || !bitmap) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, photoX: photo.x, photoY: photo.y };
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
  }
  function drag(event: PointerEvent) {
    if (!photo || loading || !pointer || event.pointerId !== pointer.id) return;
    const canvas = event.target as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const crop = photoCrop(photo);
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const rangeX = (photo.width - crop.width) * bounds.width / crop.width;
    const rangeY = (photo.height - crop.height) * bounds.height / crop.height;
    photo.x = rangeX > .01 ? clamp(pointer.photoX - (event.clientX - pointer.x) / rangeX) : .5;
    photo.y = rangeY > .01 ? clamp(pointer.photoY - (event.clientY - pointer.y) / rangeY) : .5;
    (dialog.querySelector('#photo-x') as HTMLInputElement).value = String(photo.x);
    (dialog.querySelector('#photo-y') as HTMLInputElement).value = String(photo.y);
    paint();
  }
  function endDrag(event: PointerEvent) { if (pointer?.id === event.pointerId) pointer = null; }
  async function importPhoto(file: File) {
    const current = ++loadId;
    loading = true; error = ''; draw();
    let decoded: ImageBitmap | null = null;
    let resized: HTMLCanvasElement | null = null;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) {
        throw new Error('JPEG・PNG・WebPの画像を15MB以内で選んでください。');
      }
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
      const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
      if (!jpeg && !png && !webp) throw new Error('画像を読み込めませんでした。別の画像を選んでください。');
      decoded = await createImageBitmap(file);
      if (closed || current !== loadId) return;
      if (decoded.width * decoded.height > 40_000_000) throw new Error('画像が大きすぎます。4,000万画素以内の画像を選んでください。');
      resized = document.createElement('canvas');
      const ratio = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
      resized.width = Math.max(1, Math.round(decoded.width * ratio));
      resized.height = Math.max(1, Math.round(decoded.height * ratio));
      const context = resized.getContext('2d');
      if (!context) throw new Error('このブラウザでは写真を処理できません。');
      context.fillStyle = '#fff'; context.fillRect(0, 0, resized.width, resized.height);
      context.drawImage(decoded, 0, 0, resized.width, resized.height);
      let dataUrl = '';
      for (const quality of [.9, .8, .7, .6, .5, .4]) {
        dataUrl = resized.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= 600_000) break;
      }
      if (dataUrl.length > 600_000) throw new Error('写真の容量を小さくしてから選び直してください。');
      const nextBitmap = await bitmapFrom(dataUrl);
      if (closed || current !== loadId) { nextBitmap.close(); return; }
      bitmap?.close(); bitmap = nextBitmap;
      photo = { dataUrl, width: resized.width, height: resized.height, zoom: 1, x: .5, y: .5 };
    } catch (cause) {
      if (!closed && current === loadId) error = cause instanceof Error && ['JPEG・PNG・WebPの画像を15MB以内で選んでください。', '画像が大きすぎます。4,000万画素以内の画像を選んでください。', '写真の容量を小さくしてから選び直してください。', 'このブラウザでは写真を処理できません。'].includes(cause.message) ? cause.message : '画像を読み込めませんでした。別の画像を選んでください。';
    } finally {
      decoded?.close(); if (resized) resized.width = resized.height = 0;
      if (!closed && current === loadId) { loading = false; draw(); }
    }
  }
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.body.append(dialog); draw(); dialog.showModal();
  if (photo) {
    loading = true; draw();
    void bitmapFrom(photo.dataUrl).then((image) => {
      if (closed) { image.close(); return; }
      bitmap = image; loading = false; draw();
    }).catch(() => { if (!closed) { loading = false; error = '写真を読み込めませんでした。画像を選び直してください。'; draw(); } });
  }
}
