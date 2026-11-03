import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { DeviceProfile } from '@nativemason/contracts';
import { createBrowserBridge } from './index.js';

const profile: DeviceProfile = {
  window: { width: 200, height: 160 }, pixelRatio: 2, fontScale: 1,
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  root: { x: 0, y: 0, width: 200, height: 160 }, orientation: 'landscape',
};

function html(mode: string): string {
  return `<!doctype html><html><body style="margin:0"><div id="target" style="width:50px;height:30px;background:blue"></div><script>
    let config, generation=1, seq=0, style={};
    const mode=${JSON.stringify(mode)};
    const target=document.getElementById('target');
    function draw(){target.style.width=(style.width??50)+'px';target.style.height=(style.height??30)+'px';}
    window.__RN_LAYOUT_BRIDGE__={
      configure(c){config=c},
      async capture(){if(mode==='/runtime-error')throw Object.assign(new Error('Registry duplicate'),{code:'DUPLICATE_ELEMENT'});if(mode==='/hanging')await new Promise(()=>{});const r=target.getBoundingClientRect();const node={id:'target',parentId:null,kind:'View',role:null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},styles:style,source:null,editable:false,editReason:'harness'};return {schemaVersion:1,sessionId:config.sessionId,snapshotId:'s'+seq++,platform:'web',scenarioId:config.scenarioId,profile:config.profile,revisions:{},nodes:mode==='/duplicate'?[node,node]:[node],status:mode==='/unstable'?'unstable':'stable',generation}},
      async applyTrial(id,p){style=p;draw();if(mode==='/apply-fails')throw Object.assign(new Error('Trial failed after applying'),{code:'INTERNAL_ERROR'});if(p.width===777)generation++},
      async resetTrial(){style={};draw()}
    };
  </script></body></html>`;
}

let server: Server;
let origin: string;
beforeAll(async () => {
  server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/missing-runtime' ? '<html></html>' : html(req.url ?? '/')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

const open = (path = '/', timeoutMs = 2000) => createBrowserBridge({ webUrl: origin + path, sessionId: 'test-session', scenarioId: 'harness', profile, timeoutMs });

describe('Chromium browser adapter', () => {
  it('captures, replaces trials against baseline, resets, and renders a device-scale screenshot', async () => {
    const browser = await open();
    try {
      const baseline = await browser.capture();
      expect(baseline.nodes[0].rect.width).toBe(50);
      expect((await browser.trial('target', { width: 80, height: 60 })).nodes[0].rect).toMatchObject({ width: 80, height: 60 });
      expect((await browser.trial('target', { width: 90 })).nodes[0].rect).toMatchObject({ width: 90, height: 30 });
      await browser.resetTrial();
      expect((await browser.capture()).nodes[0].rect).toEqual(baseline.nodes[0].rect);
      const metadata = await sharp(await browser.screenshot()).metadata();
      expect(metadata).toMatchObject({ width: 400, height: 320, format: 'png' });
      expect(browser.timings().trialMs).toHaveLength(2);
      const timings = browser.timings();
      timings.trialMs.push(-1);
      expect(browser.timings().trialMs).toHaveLength(2);
    } finally { await browser.close(); }
    await browser.close();
    await expect(browser.capture()).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('rejects duplicate IDs, unsupported patches, and absent mutation targets', async () => {
    const duplicate = await open('/duplicate');
    try { await expect(duplicate.capture()).rejects.toMatchObject({ code: 'DUPLICATE_ELEMENT' }); }
    finally { await duplicate.close(); }
    const browser = await open();
    try {
      await expect(browser.trial('target', { width: 20 })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
      await browser.capture();
      await expect(browser.trial('missing', { width: 20 })).rejects.toMatchObject({ code: 'MISSING_ELEMENT' });
      await expect(browser.trial('target', { width: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally { await browser.close(); }
  });

  it('rejects generation changes during a trial and clears the candidate', async () => {
    const browser = await open();
    try {
      await browser.capture();
      await expect(browser.trial('target', { width: 777 })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
      expect((await browser.capture()).nodes[0].rect.width).toBe(50);
    } finally { await browser.close(); }
  });

  it('clears a candidate when the runtime throws after applying it', async () => {
    const browser = await open('/apply-fails');
    try {
      const baseline = await browser.capture();
      await expect(browser.trial('target', { width: 80 })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect((await browser.capture()).nodes[0].rect).toEqual(baseline.nodes[0].rect);
    } finally { await browser.close(); }
  });

  it('times out unstable screens and missing runtimes without leaving an open session', async () => {
    const browser = await open('/unstable', 150);
    try { await expect(browser.capture()).rejects.toMatchObject({ code: 'UNSTABLE_LAYOUT' }); }
    finally { await browser.close(); }
    await expect(open('/missing-runtime', 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('preserves typed runtime errors and bounds hanging capture calls', async () => {
    const broken = await open('/runtime-error');
    try { await expect(broken.capture()).rejects.toMatchObject({ code: 'DUPLICATE_ELEMENT', message: 'Registry duplicate' }); }
    finally { await broken.close(); }
    const hanging = await open('/hanging', 150);
    try { await expect(hanging.capture()).rejects.toMatchObject({ code: 'TIMEOUT' }); }
    finally { await hanging.close(); }
  });
});
