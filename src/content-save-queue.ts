// Serialize writes so an older request cannot overwrite a newer edit.
export function createContentSaveQueue(write: (snapshot: string) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve();
  let latest: { snapshot: string; task: Promise<void>; pending: boolean } | null = null;
  return {
    save(snapshot: string): Promise<void> {
      if (latest?.pending && latest.snapshot === snapshot) return latest.task;
      const task = tail.then(() => write(snapshot));
      const entry = { snapshot, task, pending: true };
      latest = entry;
      task.then(() => { entry.pending = false; }, () => { entry.pending = false; });
      tail = task.catch(() => {});
      return task;
    },
  };
}
