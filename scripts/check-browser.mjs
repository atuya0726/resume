// Dedicated automated browser, fictional fixtures only. No user profile or real encrypted file is opened.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { decryptProfile, encryptProfile, parseEncrypted } from '../src/crypto.ts';
import { basicInfoFrom, resumeContentFrom, encryptedBasicInfo } from '../src/profile-storage.ts';

const directory = new URL('../.work/', import.meta.url);
await mkdir(directory, { recursive: true });
const sample = JSON.parse(await readFile(new URL('../examples/profile.example.json', import.meta.url), 'utf8'));
const password = 'dummy';
const server = await preview({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  publicDir: false,
  envDir: directory.pathname,
  preview: { host: '127.0.0.1', port: 4183, strictPort: true },
  logLevel: 'silent',
});
let browser;
const pageErrors = [];
const remoteRequests = [];
try {
  let executablePath = process.env.RESUME_CHROME_PATH;
  if (!executablePath && process.platform === 'darwin') {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try { await access(systemChrome); executablePath = systemChrome; } catch {}
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  let encryptedRequests = 0;
  const savedFiles = new Map();
  const savePosts = [];
  let failNextContentSave = false;
  let failNextEncryptedSave = false;
  const serveFixture = (response) => (route) => route.request().method() === 'GET' ? route.fulfill(response) : route.fallback();
  // Save endpoints are mocked: automated QA must never overwrite the user's public files.
  await page.route('**/__local-resume/save/**', async (route) => {
    const request = route.request();
    assert.equal(request.method(), 'POST');
    assert.equal(request.headers()['x-local-resume'], '1');
    const name = new URL(request.url()).pathname.split('/').pop();
    assert.ok(['profile.enc.json', 'resume-content.json'].includes(name));
    savePosts.push(name);
    if (name === 'profile.enc.json' && failNextEncryptedSave) {
      failNextEncryptedSave = false;
      await route.fulfill({ status: 500, body: '{}' });
      return;
    }
    if (name === 'resume-content.json' && failNextContentSave) {
      failNextContentSave = false;
      await route.fulfill({ status: 500, body: '{}' });
      return;
    }
    savedFiles.set(name, request.postData());
    await route.fulfill({ status: 204 });
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.on('pageerror', (error) => { pageErrors.push(error.name); });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/profile.enc.json')) ++encryptedRequests;
    if (!request.url().startsWith('http://127.0.0.1:4183/') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) {
      remoteRequests.push(new URL(request.url()).origin);
    }
  });
  // Never allow the app to fetch a real user's encrypted fixture.
  await page.route('**/profile.enc.json', serveFixture({ status: 404, body: '' }));
  // Document content may also be real. Serve only this script's fictional fixture.
  await page.route('**/resume-content.json', serveFixture({ status: 200, contentType: 'application/json', body: JSON.stringify(resumeContentFrom(sample)) }));
  await page.goto('http://127.0.0.1:4183/');
  const ready = () => page.waitForFunction(() => document.querySelector('#pages')?.getAttribute('aria-busy') === 'false' && document.querySelector('#pages .pagedjs_page'));
  const otherAction = async (name) => {
    const button = page.getByRole('button', { name, exact: true });
    if (!await button.isVisible()) await page.locator('.secondary-controls > summary').click();
    await button.click();
  };
  await ready();
  assert.equal(encryptedRequests, 0, 'initial preview must not fetch encrypted JSON');
  assert.ok((await page.locator('#pages').innerText()).includes(sample.summary));
  assert.equal(await page.locator('#pages [data-edit="name"]').first().innerText(), '未入力');
  assert.equal(await page.locator('#save-password').count(), 0, 'a public preview must not overwrite unseen basic information');
  assert.equal(await page.getByRole('heading', { name: '紙面で編集', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: '書類内容は自動保存', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '2001年生まれの学歴例を入れる', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-content-save-state="saved"]').isVisible(), false);
  assert.equal(await page.locator('#pages [data-edit="career.0.company"]').first().innerText(), '会社名を入力');
  assert.equal(await page.locator('#pages [data-add^="career."][data-add$=".projects"]').count(), 0);
  assert.equal(await page.locator('#pages [data-add="sharedProjects"]').count(), 1);
  await page.locator('#pages [data-edit="career.0.company"]').first().click();
  assert.equal(await page.locator('#unlock-password').evaluate((input) => input === document.activeElement), true);
  assert.equal(encryptedRequests, 0, 'clicking a locked company field does not load ciphertext');
  await page.screenshot({ path: new URL('sample-public-career.png', directory).pathname, fullPage: true });
  await page.getByRole('button', { name: '履歴書', exact: true }).click();
  await ready();
  assert.equal(await page.locator('#profile-editor,#content-editor').count(), 0, 'JSON editors must be absent');
  const edit = async (path, values) => {
    await page.locator(`#pages [data-edit="${path}"]`).first().click();
    const editor = page.locator('#pages .sheet-editor');
    for (const [name, value] of Object.entries(values)) {
      if (name === 'period' && await editor.locator('[name="period-year"]').count()) {
        const parts = value.match(/^(\d+)年(\d+)月$/);
        assert.ok(parts);
        await editor.locator('[name="period-year"]').fill(parts[1]);
        await editor.locator('[name="period-month"]').selectOption(String(Number(parts[2])));
      } else await editor.locator(`[name="${name}"]`).fill(value);
    }
    await editor.getByRole('button', { name: '反映', exact: true }).click();
    await page.locator('.sheet-editor').waitFor({ state: 'detached' });
    await ready();
  };
  const loadFixture = async (value) => {
    const fixture = await encryptProfile(encryptedBasicInfo(value), password);
    await page.unroute('**/profile.enc.json');
    await page.unroute('**/resume-content.json');
    await page.route('**/profile.enc.json', serveFixture({ status: 200, contentType: 'text/plain', body: JSON.stringify(fixture) }));
    await page.route('**/resume-content.json', serveFixture({ status: 200, contentType: 'application/json', body: JSON.stringify(resumeContentFrom(value)) }));
    const requestsBeforeReload = encryptedRequests;
    await page.reload();
    await ready();
    assert.equal(encryptedRequests, requestsBeforeReload, 'encrypted JSON is fetched only after password submission');
    await page.locator('#unlock-password').fill(password);
    await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
    await ready();
  };
  // Missing and corrupt encrypted files leave the public preview available.
  await edit('career.0', { role: '架空の解除前の職種変更' });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).career[0].role, '架空の解除前の職種変更');
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '暗号化ファイルが見つかりません' }).waitFor();
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 0);
  await page.unroute('**/profile.enc.json');
  await page.route('**/profile.enc.json', serveFixture({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '壊れた暗号化ファイル' }).waitFor();
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 0);
  // Successful unlock preserves a public edit rather than reloading older content.
  const publicCipher = await encryptProfile(encryptedBasicInfo(sample), password);
  await page.unroute('**/profile.enc.json');
  await page.route('**/profile.enc.json', serveFixture({ status: 200, contentType: 'application/json', body: JSON.stringify(publicCipher) }));
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes('架空の解除前の職種変更'));
  assert.ok((await page.locator('#pages').innerText()).includes(sample.name));
  await page.getByRole('button', { name: '基本情報をロック', exact: true }).click();
  await ready();
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 0);
  assert.equal(await page.locator('#pages [data-edit="name"]').first().innerText(), '未入力');
  await otherAction('架空のサンプルで試す');
  await ready();
  await edit('name', { name: '架空の編集氏名' });
  assert.ok((await page.locator('#pages').innerText()).includes('架空の編集氏名'));
  await edit('name', { name: sample.name });

  await page.locator('#pages [data-edit="name"]').first().click();
  assert.equal(await page.locator('dialog').count(), 0, 'text editing must stay on the paper without a modal');
  assert.equal(await page.locator('#pages .sheet-editor [name="name"]').count(), 1);
  await page.locator('#pages .sheet-editor [name="name"]').fill('架空');
  await page.locator('#pages .sheet-editor [name="name"]').press('Space');
  await page.locator('#pages .sheet-editor [name="name"]').pressSequentially('氏名');
  assert.equal(await page.locator('#pages .sheet-editor [name="name"]').inputValue(), '架空 氏名');
  await page.locator('#pages .sheet-editor [name="name"]').press('Enter');
  await ready();
  assert.equal(await page.locator('.sheet-editor').count(), 0);
  await edit('name', { name: sample.name });

  await page.locator('#pages [data-edit="notes"]').first().click();
  const notesInput = page.locator('#pages .sheet-editor [name="notes"]');
  await notesInput.fill('架空の本人希望');
  await notesInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(await notesInput.isVisible(), true, 'IME confirmation must not submit');
  await notesInput.press('Shift+Enter');
  await notesInput.pressSequentially('検証用の改行');
  assert.equal(await notesInput.inputValue(), '架空の本人希望\n検証用の改行');
  await notesInput.press('Enter');
  await page.locator('.sheet-editor').waitFor({ state: 'detached' });
  await ready();
  assert.equal(await page.locator('#pages [data-edit="notes"]').first().innerText(), '架空の本人希望\n検証用の改行');
  await edit('notes', { notes: sample.notes });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });

  // Leaving a content field saves automatically; failed writes keep the visible draft.
  await page.locator('#pages [data-edit="notes"]').first().click();
  await page.locator('#pages .sheet-editor [name="notes"]').fill('フォーカスを外して保存する架空の本人希望');
  const autoResponse = page.waitForResponse((response) => response.url().endsWith('/__local-resume/save/resume-content.json') && response.request().method() === 'POST');
  await page.locator('.preview-meta').click();
  assert.equal((await autoResponse).status(), 204);
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).notes, 'フォーカスを外して保存する架空の本人希望');
  assert.equal(savedFiles.has('profile.enc.json'), false, 'content autosave must not write identity information');
  failNextContentSave = true;
  await page.locator('#pages [data-edit="notes"]').first().click();
  await page.locator('#pages .sheet-editor [name="notes"]').fill('保存失敗しても残る架空の本人希望');
  await page.locator('.preview-meta').click();
  await page.locator('[data-content-save-state="error"]').waitFor();
  await ready();
  assert.equal(await page.locator('#pages [data-edit="notes"]').first().innerText(), '保存失敗しても残る架空の本人希望');
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).notes, 'フォーカスを外して保存する架空の本人希望');
  await otherAction('書類内容を保存');
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).notes, '保存失敗しても残る架空の本人希望');
  await edit('notes', { notes: sample.notes });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });

  // The blank padding at the end of a history row must activate the editor too.
  const schoolRow = page.locator('#pages tr[data-edit="education.0"]').first();
  const schoolBounds = await schoolRow.boundingBox();
  assert.ok(schoolBounds);
  await schoolRow.click({ position: { x: schoolBounds.width - 5, y: schoolBounds.height / 2 } });
  assert.equal(await page.locator('#pages .sheet-editor').locator('[name="period-year"]').inputValue(), '2020');
  assert.equal(await page.locator('#pages .sheet-editor').locator('[name="period-month"]').inputValue(), '3');
  const postsBeforeInternalFocus = savePosts.length;
  await page.locator('#pages .sheet-editor [name="period-year"]').press('Tab');
  await page.waitForTimeout(50);
  assert.equal(savePosts.length, postsBeforeInternalFocus, 'moving within the same row must not save partial input');
  await page.locator('#pages .sheet-editor').getByRole('button', { name: '4月', exact: true }).click();
  assert.equal(await page.locator('#pages .sheet-editor').locator('[name="period-month"]').inputValue(), '4');
  await page.locator('#pages .sheet-editor').getByRole('button', { name: 'キャンセル', exact: true }).click();
  await schoolRow.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pages .sheet-editor').isVisible(), true);
  await page.keyboard.press('Escape');

  await page.locator('#pages tr[data-edit="education.0"]').first().click();
  await page.locator('#pages .sheet-editor [name="period-year"]').fill('1899');
  const postsBeforeInvalidBlur = savePosts.length;
  await page.locator('.preview-meta').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#pages .sheet-editor').count(), 1, 'invalid focus-out must retain the draft');
  assert.equal(savePosts.length, postsBeforeInvalidBlur, 'invalid focus-out must not write');
  await page.locator('#pages .sheet-editor').getByRole('button', { name: 'キャンセル', exact: true }).click();

  await page.locator('#pages [data-edit="email"]').first().click();
  await page.locator('#pages .sheet-editor').locator('[name="email"]').fill('invalid-address');
  await page.locator('#pages .sheet-editor [name="email"]').press('Enter');
  assert.equal(await page.locator('#pages .sheet-editor').isVisible(), true, 'invalid input must stay in the editor');
  assert.ok((await page.locator('#pages .sheet-editor').innerText()).includes('メールアドレスの形式'));
  await page.locator('#pages [data-edit="name"]').first().click();
  assert.equal(await page.locator('#pages .sheet-editor').getAttribute('data-editor-path'), 'email', 'invalid drafts must survive a click on another field');
  await page.locator('#pages .sheet-editor').locator('[name="email"]').fill(sample.email);
  await page.locator('#pages .sheet-editor').getByRole('button', { name: '反映', exact: true }).click();
  await ready();

  await page.locator('#pages [data-add="qualifications"]').first().click();
  await page.locator('#pages .sheet-editor').locator('[name="period-year"]').fill('2024');
  await page.locator('#pages .sheet-editor').locator('[name="period-month"]').selectOption('5');
  await page.locator('#pages .sheet-editor').locator('[name="description"]').fill('架空の追加資格');
  await page.locator('#pages .sheet-editor [name="description"]').press('Enter');
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes('架空の追加資格'));
  await page.locator('#pages [data-edit="qualifications.1"]').first().click();
  await page.locator('#pages .sheet-editor').getByRole('button', { name: 'この行を削除', exact: true }).click();
  await ready();
  assert.equal((await page.locator('#pages').innerText()).includes('架空の追加資格'), false);

  await edit('name', { name: '' });
  await page.locator('#save-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: '暗号化ファイルを保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '保存しました。' }).waitFor();
  await ready();
  const nullablePrivate = JSON.parse(await decryptProfile(parseEncrypted(savedFiles.get('profile.enc.json')), password));
  assert.equal(nullablePrivate.basicInfo.name, null, 'an empty identity field must save as null');
  await edit('name', { name: sample.name });
  assert.equal(await page.locator('.controls').isVisible(), true, 'pagination must not hide the controls');
  assert.ok(await page.locator('#pages').innerText().then((text) => text.includes(sample.name)));
  assert.equal(await page.locator('#pages .pagedjs_page').count(), 2, 'standard resume must use two A4 pages');
  assert.equal(await page.locator('#pages .resume-photo').count(), 1);
  assert.ok((await page.locator('#pages').innerText()).includes('本人希望記入欄'));
  assert.equal(await page.locator('#pages .resume-motivation').count(), 0, 'simple resume has no motivation box');
  assert.equal(await page.locator('#pages .resume-second-page .resume-timeline').count(), 1, 'short resumes show only the qualifications table on the second page');
  assert.ok((await page.locator('#pages .resume-contact').innerText()).includes(sample.contactAddress));
  assert.equal(await page.locator('#save-password').getAttribute('minlength'), null);
  assert.equal(await page.getByText('長く独自のパスワードを設定してください。忘れると復元できません。', { exact: true }).count(), 0);
  await page.screenshot({ path: new URL('sample-resume.png', directory).pathname, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: new URL('sample-resume.pdf', directory).pathname, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: '職務経歴書', exact: true }).click();
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes(sample.career[0].company));
  const headings = await page.locator('#pages .career-document h2').allTextContents();
  for (const title of ['職務要約', '職務経歴', '活かせる経験・スキル', '技術スタック', '保有資格', '自己PR']) assert.ok(headings.some((heading) => heading.includes(title)));
  for (const project of sample.sharedProjects) assert.ok((await page.locator('#pages').innerText()).includes(project.name));
  const beforeCompanyEdit = savedFiles.get('resume-content.json');
  await edit('career.0.company', { company: '架空の直接編集した会社' });
  assert.ok((await page.locator('#pages').innerText()).includes('架空の直接編集した会社'));
  assert.equal(savedFiles.get('resume-content.json'), beforeCompanyEdit, 'company edits remain outside plaintext saves');
  assert.equal(await page.locator('#save-password').count(), 1);
  await edit('career.0.company', { company: sample.career[0].company });
  await edit('targetRole', { targetRole: '架空の応募職種' });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).targetRole, '架空の応募職種');
  await edit('targetRole', { targetRole: sample.targetRole });
  await edit('career.0', { employees: '100名' });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.deepEqual(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects, sample.sharedProjects, 'company editing must retain consolidated projects');
  await edit('career.0', { employees: sample.career[0].employees });
  await edit('sharedProjects.0', { achievements: '架空の編集成果\n2行目', role: '架空のリーダー' });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects[0].achievements, '架空の編集成果\n2行目');
  await edit('sharedProjects.0', { achievements: sample.sharedProjects[0].achievements, role: sample.sharedProjects[0].role });
  await page.locator('#pages [data-add="sharedProjects"]').first().click();
  await page.locator('#pages .sheet-editor [name="name"]').fill('架空の追加案件');
  await page.locator('#pages .sheet-editor [name="period"]').fill('2026年4月〜現在');
  await page.locator('#pages .sheet-editor').getByRole('button', { name: '反映', exact: true }).click();
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects.length, 3);
  await page.locator('#pages [data-edit="sharedProjects.2"]').first().click();
  await page.locator('#pages .sheet-editor').getByRole('button', { name: '上へ', exact: true }).click();
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.equal(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects[1].name, '架空の追加案件');
  await page.locator('#pages [data-edit="sharedProjects.1"]').first().click();
  await page.locator('#pages .sheet-editor').getByRole('button', { name: 'この行を削除', exact: true }).click();
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.deepEqual(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects, sample.sharedProjects);
  await page.screenshot({ path: new URL('sample-career-structured.png', directory).pathname, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#pages [data-add="sharedProjects"]').first().isVisible(), false);
  await page.pdf({ path: new URL('sample-career-structured.pdf', directory).pathname, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  const longProject = structuredClone(sample);
  longProject.sharedProjects[0].tasks = '架空の長い担当業務。'.repeat(400) + '\n担当業務の末尾';
  longProject.sharedProjects[0].achievements = '架空の長い実績。'.repeat(300) + '\n実績の末尾';
  await loadFixture(longProject);
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 2, 'long project descriptions must paginate');
  const longProjectText = await page.locator('#pages').innerText();
  for (const marker of ['担当業務の末尾', '実績の末尾', sample.sharedProjects[1].name, sample.motivation]) assert.ok(longProjectText.includes(marker), 'long projects must retain subsequent content');

  const long = structuredClone(sample);
  long.name = '<img src=x onerror="window.__injected=true">';
  long.sharedProjects = [];
  long.career = Array.from({ length: 30 }, (_, index) => ({
    period: '2024年4月〜現在', company: `架空の会社 ${index + 1}`,
    role: '検証用エンジニア', description: '業務内容と成果の検証用テキスト。'.repeat(25),
  }));
  await loadFixture(long);
  const total = await page.locator('#pages .pagedjs_page').count();
  assert.ok(total > 1, 'long career must paginate');
  assert.ok((await page.locator('#pages').innerText()).includes('架空の会社 30'), 'last job must be present');
  assert.equal(await page.locator('#pages img').count(), 0, 'profile values must render as text');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  const pages = await page.locator('#pages .pagedjs_page').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  for (const bounds of pages) {
    assert.ok(Math.abs(bounds.width - 793.7) < 2, 'page width must be A4');
    assert.ok(Math.abs(bounds.height - 1122.5) < 2, 'page height must be A4');
  }
  await page.getByRole('button', { name: '履歴書', exact: true }).click();
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes('架空の会社 30'), 'long resume must retain the last job');
  assert.ok((await page.locator('#pages').innerText()).includes('本人希望記入欄'), 'long resume must retain its final section');
  assert.ok((await page.locator('#pages').innerText()).includes('学歴・職歴（続き）'), 'long resume must identify its continuation');
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 2, 'long resume must add pages');
  assert.equal(await page.locator('#pages img').count(), 0);
  await page.screenshot({ path: new URL('sample-long-resume.png', directory).pathname, fullPage: true });
  await page.getByRole('button', { name: '職務経歴書', exact: true }).click();
  await ready();
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.app-header').isVisible(), false);
  await page.pdf({ path: new URL('sample-career.pdf', directory).pathname, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  // Save through the browser UI with a mocked API and decrypt only the fictional ciphertext.
  await loadFixture(sample);
  await page.getByRole('button', { name: '履歴書', exact: true }).click();
  await ready();
  // Use a generated color pattern; never open a user's photo or browser.
  const syntheticImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
    const context = canvas.getContext('2d');
    ['#d94949', '#f4d44b', '#49a268', '#4979d9'].forEach((color, index) => {
      context.fillStyle = color; context.fillRect(index * 250, 0, 250, 600);
    });
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooseSyntheticPhoto = async () => {
    await page.getByRole('dialog').locator('input[type="file"]').setInputFiles({ name: 'fictional-pattern.png', mimeType: 'image/png', buffer: Buffer.from(syntheticImage, 'base64') });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('.photo-editor button')].find((button) => button.textContent === '反映');
      return button && !button.disabled;
    });
  };
  await page.locator('#pages [data-photo]').click();
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<svg>fictional invalid file</svg>') });
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await chooseSyntheticPhoto();
  const cropCanvas = page.getByRole('dialog').locator('canvas');
  const cropBounds = await cropCanvas.boundingBox();
  assert.ok(cropBounds);
  assert.ok(Math.abs(cropBounds.width / cropBounds.height - .75) < .01);
  await page.mouse.move(cropBounds.x + cropBounds.width / 2, cropBounds.y + cropBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropBounds.x + cropBounds.width / 2 + 20, cropBounds.y + cropBounds.height / 2);
  await page.mouse.up();
  assert.ok(Number(await page.locator('#photo-x').inputValue()) < .5, 'drag pans the photo');
  await page.locator('#photo-zoom').fill('2');
  await page.locator('#photo-x').fill('0.25');
  await page.locator('#photo-y').fill('0.75');
  await page.getByRole('dialog').getByRole('button', { name: '反映', exact: true }).click();
  await ready();
  assert.equal(await page.locator('#pages .resume-photo img').count(), 1);
  const photoFrame = await page.locator('#pages .resume-photo').boundingBox();
  assert.ok(Math.abs(photoFrame.width - 30 * 96 / 25.4) < 1);
  assert.ok(Math.abs(photoFrame.height - 40 * 96 / 25.4) < 1);
  const savedPhotoSrc = await page.locator('#pages .resume-photo img').getAttribute('src');
  const savedPhotoStyle = await page.locator('#pages .resume-photo img').getAttribute('style');
  assert.ok(savedPhotoSrc.startsWith('data:image/jpeg;base64,'));
  await page.locator('#pages [data-photo]').click();
  await page.waitForFunction(() => !document.querySelector('#photo-zoom')?.disabled);
  assert.equal(await page.locator('#photo-zoom').inputValue(), '2');
  await page.locator('#photo-zoom').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.equal(await page.locator('#pages .resume-photo img').getAttribute('style'), savedPhotoStyle, 'cancel preserves crop');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: new URL('sample-photo-resume.pdf', directory).pathname, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  // Saving directly from an unfinished inline edit must include the draft.
  const editedName = `${sample.name}（架空編集）`;
  await page.locator('#pages [data-edit="name"]').first().click();
  await page.locator('#pages .sheet-editor [name="name"]').fill(editedName);
  await otherAction('書類内容を保存');
  await page.getByRole('status').filter({ hasText: '書類内容を public/resume-content.json に保存しました。' }).waitFor();
  await ready();
  const publicContent = JSON.parse(savedFiles.get('resume-content.json'));
  assert.deepEqual(publicContent, resumeContentFrom(sample));
  assert.equal('name' in publicContent, false);
  assert.equal('address' in publicContent, false);
  assert.equal('photo' in publicContent, false);
  assert.equal('company' in publicContent.career[0], false);
  await page.locator('#save-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: '暗号化ファイルを保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '保存しました。' }).waitFor();
  await ready();
  const ciphertext = savedFiles.get('profile.enc.json');
  assert.equal(ciphertext.includes(sample.name), false);
  const privateData = JSON.parse(await decryptProfile(parseEncrypted(ciphertext), password));
  assert.equal(privateData.basicInfo.name, editedName);
  assert.equal(privateData.basicInfo.careerCompanies[sample.career[0].id], sample.career[0].company);
  assert.equal('education' in privateData.basicInfo, false);
  assert.equal('career' in privateData.basicInfo, false);
  assert.equal('qualifications' in privateData.basicInfo, false);
  assert.equal(privateData.basicInfo.photo.dataUrl, savedPhotoSrc);
  assert.equal(privateData.basicInfo.photo.zoom, 2);
  assert.equal(privateData.basicInfo.photo.x, .25);
  assert.equal(privateData.basicInfo.photo.y, .75);
  assert.equal(await page.locator('#save-password').count(), 0, 'the encrypted save form disappears after saving');
  assert.equal(await page.evaluate(() => localStorage.length), 0);

  await page.getByRole('button', { name: '基本情報をロック', exact: true }).click();
  assert.equal(await page.locator('.sheet-editor').count(), 0);
  assert.equal(await page.locator('.photo-editor').count(), 0);
  await ready();
  assert.ok(await page.locator('#pages .pagedjs_page').count() > 0, 'locking retains the document preview');
  assert.equal(await page.locator('#pages [data-edit="name"]').first().innerText(), '未入力');
  await page.locator('#unlock-password').fill('incorrect-dummy-password');
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '復号できません' }).waitFor();

  // Auto-loading is tested by serving only the generated fictional encrypted fixture.
  await page.unroute('**/profile.enc.json');
  await page.route('**/profile.enc.json', serveFixture({ status: 200, contentType: 'application/json', body: ciphertext }));
  await page.reload();
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: '履歴書', exact: true }).click();
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes(sample.name));
  assert.equal(await page.locator('#pages .resume-photo img').getAttribute('src'), savedPhotoSrc);
  assert.equal(await page.locator('#pages .resume-photo img').getAttribute('style'), savedPhotoStyle);
  await page.screenshot({ path: new URL('sample-unlocked.png', directory).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('sample-mobile.png', directory).pathname, fullPage: true });
  await page.locator('#pages [data-photo]').click();
  await page.waitForFunction(() => !document.querySelector('#photo-zoom')?.disabled);
  await page.getByRole('dialog').getByRole('button', { name: '写真を削除', exact: true }).click();
  await ready();
  assert.equal(await page.locator('#pages .resume-photo img').count(), 0);

  // Legacy names stay available until the encrypted save succeeds, then leave public content.
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { careerCompanies: _companies, ...legacyBasic } = basicInfoFrom(sample);
  const legacyEncrypted = await encryptProfile(JSON.stringify({ format: 'local-resume/basic-info', version: 1, basicInfo: legacyBasic }), password);
  const legacyContent = { ...resumeContentFrom(sample), career: sample.career };
  await page.unroute('**/profile.enc.json');
  await page.unroute('**/resume-content.json');
  await page.route('**/profile.enc.json', serveFixture({ status: 200, contentType: 'application/json', body: JSON.stringify(legacyEncrypted) }));
  await page.route('**/resume-content.json', serveFixture({ status: 200, contentType: 'application/json', body: JSON.stringify(legacyContent) }));
  await page.reload();
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await ready();
  const postsBeforeMigration = savePosts.length;
  await otherAction('書類内容を保存');
  await page.locator('[data-content-save-state="error"]').waitFor();
  assert.equal(savePosts.length, postsBeforeMigration, 'legacy names must not be removed before encryption');
  failNextEncryptedSave = true;
  await page.locator('#save-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: '暗号化ファイルを保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'public/ に書き込めませんでした' }).waitFor();
  assert.deepEqual(savePosts.slice(postsBeforeMigration), ['profile.enc.json']);
  assert.ok((await page.locator('#pages').innerText()).includes(sample.career[0].company));
  await page.locator('#save-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: '暗号化ファイルを保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '保存しました。' }).waitFor();
  await ready();
  assert.deepEqual(savePosts.slice(postsBeforeMigration), ['profile.enc.json', 'profile.enc.json', 'resume-content.json']);
  const migratedPrivate = JSON.parse(await decryptProfile(parseEncrypted(savedFiles.get('profile.enc.json')), password));
  assert.equal(migratedPrivate.basicInfo.careerCompanies[sample.career[0].id], sample.career[0].company);
  assert.equal('company' in JSON.parse(savedFiles.get('resume-content.json')).career[0], false);

  // Shared career sections load directly from fictional document JSON.
  const sharedProfile = structuredClone(sample);
  Object.assign(sharedProfile, {
    careerOverview: '架空の所属変更と案件継続',
    sharedProjects: [{ name: '架空の共通案件', period: '2023年頃〜現在', overview: '架空の概要', tasks: '架空の担当業務' }],
    improvements: '架空の業務改善', activities: '架空の技術活動と受賞',
  });
  await loadFixture(sharedProfile);
  await page.getByRole('button', { name: '職務経歴書', exact: true }).click();
  await ready();
  const sharedText = await page.locator('#pages').innerText();
  for (const marker of [sharedProfile.career[0].company, '架空の共通案件', sharedProfile.improvements, sharedProfile.activities]) assert.ok(sharedText.includes(marker));
  assert.equal(await page.getByRole('button', { name: '下書きを反映', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '資格を反映', exact: true }).count(), 0);
  await edit('sharedProjects.0', { tasks: '架空の更新した共通案件の担当業務' });
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  const sharedContent = JSON.parse(savedFiles.get('resume-content.json'));
  assert.equal('company' in sharedContent.career[0], false);
  assert.deepEqual(sharedContent.education, sharedProfile.education);
  assert.deepEqual(sharedContent.qualifications, sharedProfile.qualifications);
  assert.equal(sharedContent.notes, sharedProfile.notes);
  await page.unroute('**/resume-content.json');
  await page.route('**/resume-content.json', serveFixture({ status: 200, contentType: 'application/json', body: savedFiles.get('resume-content.json') }));
  await page.reload();
  await page.locator('#unlock-password').fill(password);
  await page.getByRole('button', { name: 'パスワードで開く', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: '職務経歴書', exact: true }).click();
  await ready();
  assert.ok((await page.locator('#pages').innerText()).includes('架空の更新した共通案件の担当業務'));

  // A single project input remains discoverable even with no projects; one project can span employers.
  const emptyProjects = structuredClone(sample);
  emptyProjects.sharedProjects = [];
  emptyProjects.career.push({ ...emptyProjects.career[0], id: 'dummy-next-employer', company: '架空の継続先会社' });
  await loadFixture(emptyProjects);
  assert.equal(await page.locator('#pages [data-add="sharedProjects"]').count(), 1);
  assert.equal(await page.locator('#pages [data-add$=".projects"]').count(), 0);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.getByRole('heading', { name: '担当案件', exact: true }).isVisible(), false);
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#pages [data-add="sharedProjects"]').click();
  const projectEditor = page.locator('#pages .sheet-editor');
  await projectEditor.locator('[name="name"]').fill('架空の所属をまたぐ継続案件');
  await projectEditor.locator('[name="period"]').fill('2025年頃〜現在');
  await projectEditor.locator(`[name="careerIds"][value="${sample.career[0].id}"]`).check();
  await projectEditor.locator('[name="careerIds"][value="dummy-next-employer"]').check();
  await projectEditor.getByRole('button', { name: '反映', exact: true }).click();
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  const consolidatedSave = savedFiles.get('resume-content.json');
  const consolidatedContent = JSON.parse(consolidatedSave);
  assert.deepEqual(consolidatedContent.sharedProjects[0].careerIds, [sample.career[0].id, 'dummy-next-employer']);
  assert.ok(consolidatedContent.career.every((job) => !('projects' in job) && !('company' in job)));
  for (const job of emptyProjects.career) assert.equal(consolidatedSave.includes(job.company), false);
  const affiliation = page.locator('#pages .project-affiliations').first();
  for (const job of emptyProjects.career) assert.ok((await affiliation.innerText()).includes(job.company));
  await page.screenshot({ path: new URL('sample-consolidated-projects.png', directory).pathname, fullPage: true });
  await page.getByRole('button', { name: '基本情報をロック', exact: true }).click();
  await ready();
  const lockedAffiliation = await page.locator('#pages .project-affiliations').first().innerText();
  for (const job of emptyProjects.career) assert.equal(lockedAffiliation.includes(job.company), false);
  assert.ok(lockedAffiliation.includes('職歴1') && lockedAffiliation.includes('職歴2'));
  await page.locator('#pages [data-edit="sharedProjects.0"]').first().click();
  assert.equal(await page.locator('#pages .sheet-editor [name="careerIds"]:checked').count(), 2);
  await page.locator('#pages .sheet-editor [name="careerIds"][value="dummy-next-employer"]').uncheck();
  await page.locator('#pages .sheet-editor').getByRole('button', { name: '反映', exact: true }).click();
  await ready();
  await page.locator('[data-content-save-state="saved"]').waitFor({ state: 'attached' });
  assert.deepEqual(JSON.parse(savedFiles.get('resume-content.json')).sharedProjects[0].careerIds, [sample.career[0].id]);

  assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
  assert.deepEqual(remoteRequests, [], 'no external network requests');
  const report = { result: 'passed', longCareerPages: total, checks: ['two templates', 'two-page ruled resume', 'paper field editing', 'direct company editing', 'minimal controls and conditional feedback', 'focus-out autosave', 'autosave failure and retry', 'internal row focus and invalid drafts', 'inline validation', 'nullable identity save', 'encrypted company names', 'ordered legacy company migration and failed-save recovery', 'row addition and deletion', 'long resume pagination', 'A4 pagination', 'escaped data', 'PDF', 'photo import and validation', 'photo crop and drag', 'encrypted photo restore', 'photo removal', 'short-password browser encryption', 'lock', 'wrong password', 'public preview without ciphertext', 'lazy encrypted loading', 'failed unlock retains preview', 'public edits survive unlock', 'career hierarchy and prose layout', 'no external requests', 'no localStorage'] };
  await writeFile(new URL('browser-check.json', directory), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
