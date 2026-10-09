import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoCrop, photoStyle, parsePhoto } from '../src/photo.ts';
import { emptyProfile, parseProfile } from '../src/profile.ts';
import { validateProfile } from '../src/validation.ts';
import { encryptedBasicInfo, restoreProfile, resumeContentFrom, parseResumeContent } from '../src/profile-storage.ts';
import { encryptProfile, decryptProfile } from '../src/crypto.ts';

// Synthetic JPEG header bytes only: geometry and structure tests never use personal images.
const photo = { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', width: 1200, height: 800, zoom: 1, x: .5, y: .5 };

test('crop fills the 3:4 portrait frame for landscape, portrait and square photos', () => {
  for (const [width, height] of [[1200, 800], [600, 1600], [800, 800], [600, 800], [1, 1600]]) {
    for (const zoom of [1, 2, 4]) for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
      const crop = photoCrop({ width, height, zoom, x, y });
      assert.ok(Math.abs(crop.width / crop.height - .75) < 1e-10);
      assert.ok(crop.width > 0 && crop.height > 0);
      assert.ok(crop.x >= -1e-10 && crop.y >= -1e-10);
      assert.ok(crop.x + crop.width <= width + 1e-10 && crop.y + crop.height <= height + 1e-10);
    }
  }
  assert.deepEqual(photoCrop(photo), { x: 300, y: 0, width: 600, height: 800 });
  assert.equal(photoStyle(photo), 'width:200%;height:100%;left:-50%;top:0%;');
});

test('photo parser accepts bounded raster data and discards unexpected properties', () => {
  assert.deepEqual(parsePhoto({ ...photo, ignored: 'ignored' }), photo);
  assert.equal(parsePhoto(undefined), undefined);
  assert.deepEqual(parseProfile(JSON.stringify({ ...emptyProfile(), photo })).photo, photo);
});

test('external URLs, SVG, malformed coordinates and oversized photos are rejected without echoing input', () => {
  for (const value of [null, 'PRIVATE_DUMMY_MARKER', { ...photo, dataUrl: 'https://example.invalid/PRIVATE_DUMMY_MARKER' },
    { ...photo, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }, { ...photo, dataUrl: 'data:image/jpeg;base64,/9j/2Q=' },
    { ...photo, dataUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(600_000)}` },
    ...[0, -1, 1601, 1.5, Infinity].map((width) => ({ ...photo, width })),
    ...[0, 4.01, NaN].map((zoom) => ({ ...photo, zoom })),
    ...[-.01, 1.01, NaN, '0.5'].map((x) => ({ ...photo, x }))]) {
    assert.throws(() => parsePhoto(value), (error: Error) => !error.message.includes('PRIVATE_DUMMY_MARKER'));
  }
  assert.ok(validateProfile({ ...emptyProfile(), photo: { ...photo, zoom: 0 } }, 'basic').some((issue) => issue.path === 'photo'));
  assert.deepEqual(validateProfile({ ...emptyProfile(), photo: { ...photo, zoom: 0 } }, 'content'), []);
});

test('photo and crop survive encrypted basic storage and never enter public document content', async () => {
  const profile = { ...emptyProfile(), photo: { ...photo, zoom: 2, x: .25, y: .75 } };
  const content = resumeContentFrom(profile);
  assert.equal('photo' in content, false);
  assert.equal('photo' in parseResumeContent(JSON.stringify(profile)), false);
  const encrypted = await encryptProfile(encryptedBasicInfo(profile), 'dummy');
  assert.equal(JSON.stringify(encrypted).includes(photo.dataUrl), false);
  const restored = restoreProfile(await decryptProfile(encrypted, 'dummy'), content);
  assert.deepEqual(restored.photo, profile.photo);
});
