import { describe, expect, it } from 'vitest';
import { captureSourceRevisions, loadedSourceRevisions, registerSourceRevision } from './source-revisions.js';

describe('loaded source revisions', () => {
  it('captures mounted style dependencies without unrelated eagerly loaded screens',()=>{
    registerSourceRevision('unused-screen.tsx','1'.repeat(64));
    registerSourceRevision('theme.ts','2'.repeat(64));
    const result=captureSourceRevisions([{source:{path:'mounted.tsx',hash:'3'.repeat(64),dependencies:['theme.ts']}} as never]);
    expect(result).toEqual({'mounted.tsx':'3'.repeat(64),'theme.ts':'2'.repeat(64)});
    expect(()=>captureSourceRevisions([{source:{path:'mounted.tsx',hash:'3'.repeat(64),dependencies:['missing-theme.ts']}} as never])).toThrowError(expect.objectContaining({code:'STALE_SOURCE'}));
  });
  it('keeps the latest successfully registered revision per module and includes mounted revisions', () => {
    const path = 'fixtures/revision-coherence.tsx';
    registerSourceRevision(path, 'a'.repeat(64));
    expect(loadedSourceRevisions()[path]).toBe('a'.repeat(64));
    registerSourceRevision(path, 'b'.repeat(64));
    expect(captureSourceRevisions([{ source: { path, hash: 'b'.repeat(64) } } as never])).toMatchObject({ [path]: 'b'.repeat(64) });
  });
  it('rejects mounted source metadata that disagrees with the loaded module revision', () => {
    const path = 'fixtures/mixed-revision.tsx';
    registerSourceRevision(path, 'c'.repeat(64));
    expect(() => captureSourceRevisions([{ source: { path, hash: 'd'.repeat(64) } } as never])).toThrowError(expect.objectContaining({ code: 'STALE_SOURCE' }));
  });
});
