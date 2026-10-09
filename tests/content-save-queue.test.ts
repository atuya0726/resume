import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentSaveQueue } from '../src/content-save-queue.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('rapid edits and reverting to an earlier value reach disk in order', async () => {
  const first = deferred();
  const started = deferred();
  const disk: string[] = [];
  const queue = createContentSaveQueue(async (snapshot) => {
    if (!disk.length) { started.resolve(); await first.promise; }
    disk.push(snapshot);
  });
  const a = queue.save('FICTIONAL_A');
  await started.promise;
  const b = queue.save('FICTIONAL_B');
  const c = queue.save('FICTIONAL_A');
  assert.deepEqual(disk, []);
  first.resolve();
  await Promise.all([a, b, c]);
  assert.deepEqual(disk, ['FICTIONAL_A', 'FICTIONAL_B', 'FICTIONAL_A']);
});

test('a manual save during an identical pending autosave uses the same request', async () => {
  const gate = deferred();
  let requests = 0;
  const queue = createContentSaveQueue(async () => { ++requests; await gate.promise; });
  const automatic = queue.save('FICTIONAL_CONTENT');
  const manual = queue.save('FICTIONAL_CONTENT');
  assert.equal(automatic, manual);
  gate.resolve();
  await Promise.all([automatic, manual]);
  assert.equal(requests, 1);
});

test('a failed write can be retried and does not stop later edits from saving', async () => {
  let requests = 0;
  const disk: string[] = [];
  const queue = createContentSaveQueue(async (snapshot) => {
    if (++requests === 1) throw new Error('fictional write failure');
    disk.push(snapshot);
  });
  const failed = queue.save('FICTIONAL_A');
  const newer = queue.save('FICTIONAL_B');
  await assert.rejects(failed, /fictional write failure/);
  await newer;
  await queue.save('FICTIONAL_A');
  assert.deepEqual(disk, ['FICTIONAL_B', 'FICTIONAL_A']);
});
