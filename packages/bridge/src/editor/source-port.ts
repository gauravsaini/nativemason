import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { BridgeFault, EditPlanSchema, type CommitReceipt, type EditPlan, type SourcePort } from '@nativemason/contracts';
import { hashSource } from './planner.js';

/** Serialized, hash-checked single-file writes. External editors are checked again immediately before rename. */
export function createSourcePort(projectRoot: string): SourcePort {
  const rootPromise = realpath(projectRoot);
  const receipts = new Map<string, CommitReceipt>();
  let queue: Promise<unknown> = Promise.resolve();

  async function resolveSource(relative: string): Promise<string> {
    const root = await rootPromise;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || relative.includes('\0')) throw new BridgeFault('SOURCE_OUTSIDE_PROJECT', 'Source paths must be project-relative without traversal');
    const resolved = await realpath(path.resolve(root, relative));
    const within = path.relative(root, resolved);
    if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) throw new BridgeFault('SOURCE_OUTSIDE_PROJECT', 'Source resolves outside the project');
    if (!(await stat(resolved)).isFile()) throw new BridgeFault('INVALID_INPUT', 'Source is not a regular file');
    return resolved;
  }

  return {
    async read(relative) {
      const file = await resolveSource(relative);
      const text = await readFile(file, 'utf8');
      return { path: relative, text, hash: hashSource(text) };
    },
    apply(plan: EditPlan): Promise<CommitReceipt> {
      const work = async (): Promise<CommitReceipt> => {
        const validated = EditPlanSchema.safeParse(plan);
        if (!validated.success || plan.expectedHash !== plan.source.hash) throw new BridgeFault('INVALID_INPUT', 'Invalid source edit plan');
        const file = await resolveSource(plan.source.path);
        const before = await readFile(file, 'utf8');
        const currentHash = hashSource(before);
        const newHash = hashSource(plan.updatedText);
        const key = hashSource(`${file}\0${plan.expectedHash}\0${newHash}`);
        const replay = receipts.get(key);
        if (replay) {
          if (currentHash !== replay.newHash) throw new BridgeFault('STALE_SOURCE', 'Previously committed source has changed');
          return { ...replay };
        }
        if (currentHash !== plan.expectedHash) throw new BridgeFault('STALE_SOURCE', 'Source changed after the trial was captured');
        const original = await lstat(file);
        const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, 'wx', original.mode & 0o777);
          try {
            await handle.writeFile(plan.updatedText, 'utf8');
            await handle.chmod(original.mode & 0o777);
            await handle.sync();
          } finally { await handle.close(); }
          if (await resolveSource(plan.source.path) !== file) throw new BridgeFault('STALE_SOURCE', 'Source symlink changed during commit');
          const latest = await lstat(file);
          if (latest.ino !== original.ino || latest.dev !== original.dev || hashSource(await readFile(file, 'utf8')) !== plan.expectedHash) throw new BridgeFault('STALE_SOURCE', 'Source changed during commit');
          await rename(temporary, file);
        } finally {
          await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        }
        const receipt: CommitReceipt = { commitId: randomUUID(), path: plan.source.path, oldHash: plan.expectedHash, newHash, diff: plan.diff, nativeStatus: 'pending' };
        receipts.set(key, receipt);
        return { ...receipt };
      };
      const result = queue.then(work, work);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
