import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTransactionSourcePort } from './transaction-port.js';
import { hashSource } from './planner.js';
import type { TransactionPlan } from '@nativemason/contracts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rn-layout-transaction-')); roots.push(root);
  await writeFile(path.join(root, 'A.tsx'), 'before A'); await writeFile(path.join(root, 'B.tsx'), 'before B');
  const port = createTransactionSourcePort(root);
  const files = ['A.tsx', 'B.tsx'].map(name => {
    const text = `before ${name[0]}`;
    return { source: { path: name, hash: hashSource(text), start: 1, end: 2, line: 1, column: 1 }, expectedHash: hashSource(text), updatedText: `after ${name[0]}`, diff: `diff ${name}` };
  });
  const plan: TransactionPlan = { files, blastRadius: { consumers: [], unresolvedReferences: [] } };
  return { root, port, plan };
}

describe('recoverable transaction source port', () => {
  it('distinguishes a new trial after revert from replaying an old intent', async () => {
    const {port,plan}=await setup();
    const first=await port.applyTransaction({...plan,intentId:'first-trial'});
    const firstRevert=await port.revert(first.commitId);
    await expect(port.applyTransaction({...plan,intentId:'first-trial'})).rejects.toMatchObject({code:'STALE_SOURCE'});
    const second=await port.applyTransaction({...plan,intentId:'second-trial'});
    expect(second.commitId).not.toBe(first.commitId);
    expect(await port.applyTransaction({...plan,intentId:'second-trial'})).toEqual(second);
    const secondRevert=await port.revert(second.commitId);
    expect(secondRevert.commitId).not.toBe(firstRevert.commitId);
    expect(secondRevert.revertsCommitId).toBe(second.commitId);
    expect(await port.revert(second.commitId)).toEqual(secondRevert);
  });
  it('applies every file, replays the receipt, and reverts as a linked transaction', async () => {
    const { root, port, plan } = await setup();
    const receipt = await port.applyTransaction(plan);
    expect(receipt).toMatchObject({ nativeStatus: 'pending', files: [{ path: 'A.tsx' }, { path: 'B.tsx' }] });
    expect(await readFile(path.join(root, 'A.tsx'), 'utf8')).toBe('after A');
    expect(await readFile(path.join(root, 'B.tsx'), 'utf8')).toBe('after B');
    expect(await port.applyTransaction(plan)).toEqual(receipt);
    const reverted = await port.revert(receipt.commitId);
    expect(reverted.revertsCommitId).toBe(receipt.commitId);
    expect(await readFile(path.join(root, 'A.tsx'), 'utf8')).toBe('before A');
    expect(await readFile(path.join(root, 'B.tsx'), 'utf8')).toBe('before B');
  });

  it('rejects a stale member before changing any file', async () => {
    const { root, port, plan } = await setup();
    await writeFile(path.join(root, 'B.tsx'), 'external');
    await expect(port.applyTransaction(plan)).rejects.toMatchObject({ code: 'STALE_SOURCE' });
    expect(await readFile(path.join(root, 'A.tsx'), 'utf8')).toBe('before A');
    expect(await readFile(path.join(root, 'B.tsx'), 'utf8')).toBe('external');
  });

  it('recovers a prepared journal by rolling back already-replaced files', async () => {
    const { root, port } = await setup();
    const id = 'a'.repeat(64), before = 'before A', after = 'after A';
    const temporary = path.join(await realpath(root), 'A.tsx.' + 'b'.repeat(36) + '.stage');
    await writeFile(path.join(root, 'A.tsx'), after);
    const control = path.join(root, '.nativemason'); await mkdir(control, { recursive: true });
    await writeFile(path.join(control, `${id}.journal.json`), JSON.stringify({
      id, state: 'prepared', files: [{ path: 'A.tsx', before, after, mode: 0o644, temporary }],
      receipt: { commitId: id, files: [], nativeStatus: 'pending' },
    }));
    await port.recover();
    expect(await readFile(path.join(root, 'A.tsx'), 'utf8')).toBe(before);
    expect((await readdir(control)).filter(name => name.endsWith('.journal.json'))).toEqual([]);
  });

  it('preserves external content and reports a recovery conflict', async () => {
    const { root, port } = await setup();
    const id = 'c'.repeat(64), control = path.join(root, '.nativemason'); await mkdir(control, { recursive: true });
    await writeFile(path.join(root, 'A.tsx'), 'external');
    await writeFile(path.join(control, `${id}.journal.json`), JSON.stringify({ id, state: 'prepared', files: [{ path: 'A.tsx', before: 'before A', after: 'after A', mode: 0o644, temporary: path.join(await realpath(root), 'A.tsx.' + 'd'.repeat(36) + '.stage') }], receipt: {} }));
    await expect(port.recover()).rejects.toMatchObject({ code: 'STALE_SOURCE' });
    expect(await readFile(path.join(root, 'A.tsx'), 'utf8')).toBe('external');
  });
});
