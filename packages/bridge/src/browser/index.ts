import { performance } from 'node:perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import {
  BridgeFault,
  DeviceProfileSchema,
  ErrorCodeSchema,
  RnStylePatchSchema,
  SpatialSnapshotSchema,
  type BrowserPort,
  type BrowserRuntime,
  type DeviceProfile,
  type ProfileOverrides,
  type RnStylePatch,
  type SpatialSnapshot,
  type WebDiagnostics,
} from '@rn-layout/contracts';

export interface BrowserBridgeOptions {
  webUrl: string;
  sessionId: string;
  scenarioId: string;
  profile: DeviceProfile;
  timeoutMs?: number;
}

export interface BrowserBridge extends BrowserPort {
  timings(): { captureMs: number[]; trialMs: number[] };
}

type RuntimeWindow = Window & { __RN_LAYOUT_BRIDGE__?: BrowserRuntime };

function applyProfileOverrides(base: DeviceProfile, overrides?: ProfileOverrides): DeviceProfile {
  if (!overrides) return structuredClone(base);
  if (overrides.fontScale !== undefined) throw new BridgeFault('UNSUPPORTED_PROFILE', 'Chromium font-scale simulation is not supported until rendered text changes can be verified');
  if (!overrides.orientation || overrides.orientation === base.orientation) return structuredClone(base);
  const { width, height } = base.window;
  if (Math.abs(width - height) < 0.01) throw new BridgeFault('UNSUPPORTED_PROFILE', 'Cannot infer the alternate viewport dimensions from a square profile');
  const insets = overrides.orientation === 'landscape'
    ? { top: base.insets.left, right: base.insets.top, bottom: base.insets.right, left: base.insets.bottom }
    : { top: base.insets.right, right: base.insets.bottom, bottom: base.insets.left, left: base.insets.top };
  const profile: DeviceProfile = { ...base, orientation: overrides.orientation, window: { width: height, height: width }, root: { x: 0, y: 0, width: height, height: width }, insets };
  if (insets.left + insets.right >= profile.window.width || insets.top + insets.bottom >= profile.window.height) {
    throw new BridgeFault('UNSUPPORTED_PROFILE', 'Rotated safe-area insets do not fit the requested orientation');
  }
  return profile;
}

function fault(error: unknown, fallback: string): BridgeFault {
  if (error instanceof BridgeFault) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'INTERNAL_ERROR';
  return new BridgeFault(code, `${fallback}: ${message}`);
}

function validateSnapshot(value: unknown, options: BrowserBridgeOptions): SpatialSnapshot {
  const parsed = SpatialSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new BridgeFault('INVALID_INPUT', 'Browser returned an invalid snapshot', parsed.error.flatten());
  const snapshot = parsed.data;
  if (snapshot.platform !== 'web' || snapshot.sessionId !== options.sessionId || snapshot.scenarioId !== options.scenarioId) {
    throw new BridgeFault('STALE_SNAPSHOT', 'Browser snapshot belongs to another platform, session, or scenario');
  }
  if (JSON.stringify(snapshot.profile) !== JSON.stringify(options.profile)) {
    // Parse both objects first to make field insertion order irrelevant.
    if (JSON.stringify(DeviceProfileSchema.parse(snapshot.profile)) !== JSON.stringify(DeviceProfileSchema.parse(options.profile))) {
      throw new BridgeFault('STALE_SNAPSHOT', 'Browser profile differs from the configured session profile');
    }
  }
  const ids = snapshot.nodes.map(node => node.id);
  if (new Set(ids).size !== ids.length) throw new BridgeFault('DUPLICATE_ELEMENT', 'Browser snapshot contains duplicate element IDs');
  const known = new Set(ids);
  for (const node of snapshot.nodes) {
    if (node.parentId !== null && !known.has(node.parentId)) {
      throw new BridgeFault('MISSING_ELEMENT', `Missing instrumented parent ${node.parentId} for ${node.id}`);
    }
    if (node.source && snapshot.revisions[node.source.path] !== node.source.hash) {
      throw new BridgeFault('STALE_SOURCE', `Source revision mismatch for ${node.id}`);
    }
  }
  return snapshot;
}

function identity(snapshot: SpatialSnapshot): string {
  return JSON.stringify({
    generation: snapshot.generation,
    profile: snapshot.profile,
    revisions: Object.entries(snapshot.revisions).sort(([a], [b]) => a.localeCompare(b)),
    nodes: snapshot.nodes.map(node => ({ id: node.id, parentId: node.parentId, source: node.source })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function geometry(snapshot: SpatialSnapshot): string {
  return JSON.stringify(snapshot.nodes.map(node => ({ id: node.id, rect: node.rect })).sort((a, b) => a.id.localeCompare(b.id)));
}

async function waitForAssets(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => {
    const fontsReady = !document.fonts || document.fonts.status === 'loaded';
    return fontsReady && Array.from(document.images).every(image => image.complete);
  }, undefined, { timeout: timeoutMs });
  const broken = await page.evaluate(() => Array.from(document.images).filter(image => image.currentSrc && image.naturalWidth === 0).map(image => image.currentSrc));
  if (broken.length > 0) throw new BridgeFault('INVALID_INPUT', 'One or more screen images failed to load', { images: broken });
}

async function collectDiagnostics(cdp: any): Promise<WebDiagnostics> {
  const root = await cdp.send('Runtime.evaluate', {
    expression: 'Object.fromEntries(window.__RN_LAYOUT_BRIDGE__.getDiagnosticTargets().map(target => [target.id, target.element]))',
    returnByValue: false,
  });
  const objectId = root.result.objectId;
  if (!objectId) throw new BridgeFault('STALE_SNAPSHOT', 'Runtime did not expose registered DOM targets');
  const properties = await cdp.send('Runtime.getProperties', { objectId, ownProperties: true });
  const nodes: WebDiagnostics['nodes'] = {};
  const warnings: WebDiagnostics['warnings'] = [];
  let domSnapshot: any;
  try { domSnapshot = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includePaintOrder: true, includeDOMRects: true }); } catch { /* Paint order remains nullable. */ }
  for (const property of properties.result) {
    const elementObjectId = property.value?.objectId;
    if (!property.name) continue;
    if (!elementObjectId) {
      nodes[property.name] = { clipping: 'unknown', centerHitTest: 'unknown', scrollOverflow: { horizontal: false, vertical: false }, paintOrder: null, fonts: [], lineBoxCount: null };
      warnings.push({ elementId: property.name, code: 'EVIDENCE_UNAVAILABLE', severity: 'uncertain', message: 'The registered host did not resolve to a DOM element' });
      continue;
    }
    const requested = await cdp.send('DOM.requestNode', { objectId: elementObjectId });
    if (!requested.nodeId) {
      nodes[property.name] = { clipping: 'unknown', centerHitTest: 'unknown', scrollOverflow: { horizontal: false, vertical: false }, paintOrder: null, fonts: [], lineBoxCount: null };
      warnings.push({ elementId: property.name, code: 'EVIDENCE_UNAVAILABLE', severity: 'uncertain', message: 'The registered host has no CDP DOM node' });
      continue;
    }
    const described = await cdp.send('DOM.describeNode', { nodeId: requested.nodeId, depth: 0 });
    const backendNodeId = described.node.backendNodeId;
    const diagnostic = await cdp.send('Runtime.callFunctionOn', {
      objectId: elementObjectId,
      functionDeclaration: `function(){
        const r=this.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
        let clipped=false, known=true, scrollX=false, scrollY=false;
        for(let p=this;p&&p.nodeType===1;p=p.parentElement){
          const s=getComputedStyle(p), pr=p.getBoundingClientRect();
          if(s.overflowX==='hidden'||s.overflowX==='clip'||s.overflowX==='auto'||s.overflowX==='scroll'){
            scrollX=scrollX||p.scrollWidth>p.clientWidth; if(p!==this&&(r.left<pr.left||r.right>pr.right))clipped=true;
          }
          if(s.overflowY==='hidden'||s.overflowY==='clip'||s.overflowY==='auto'||s.overflowY==='scroll'){
            scrollY=scrollY||p.scrollHeight>p.clientHeight; if(p!==this&&(r.top<pr.top||r.bottom>pr.bottom))clipped=true;
          }
        }
        const style=getComputedStyle(this); const requested=style.fontFamily.split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,''));
        let lines=null; if(this.childNodes.length){const range=document.createRange();range.selectNodeContents(this);const rects=[...range.getClientRects()];lines=new Set(rects.map(x=>Math.round(x.top*100)/100)).size;}
        const failedFonts=[...document.fonts].filter(f=>f.status==='error').map(f=>f.family.replace(/^['"]|['"]$/g,''));
        return {clipped,known,scrollX,scrollY,cx,cy,requested,lines,failedFonts};
      }`, returnByValue: true,
    });
    const value = diagnostic.result?.value;
    if (!value) continue;
    const clipping: 'confirmed'|'clear'|'unknown' = value.known ? (value.clipped ? 'confirmed' : 'clear') : 'unknown';
    let centerHitTest: 'confirmed'|'clear'|'unknown' = 'unknown';
    try {
      const hit = await cdp.send('DOM.getNodeForLocation', { x: Math.round(value.cx), y: Math.round(value.cy), includeUserAgentShadowDOM: true, ignorePointerEventsNone: false });
      const hitObject = await cdp.send('DOM.resolveNode', { backendNodeId: hit.backendNodeId });
      if (hitObject.object.objectId) {
        const contains = await cdp.send('Runtime.callFunctionOn', {
          objectId: elementObjectId,
          functionDeclaration: 'function(hit){return this===hit||this.contains(hit)}',
          arguments: [{ objectId: hitObject.object.objectId }], returnByValue: true,
        });
        centerHitTest = contains.result.value === true ? 'clear' : 'confirmed';
      }
    } catch { centerHitTest = 'unknown'; }
    let paintOrder: number | null = null;
    if (domSnapshot) {
      for (const doc of domSnapshot.documents) {
        const index = doc.nodes.backendNodeId?.indexOf(backendNodeId) ?? -1;
        const layoutIndex = doc.layout.nodeIndex.indexOf(index);
        if (layoutIndex >= 0) paintOrder = doc.layout.paintOrders?.[layoutIndex] ?? null;
      }
    }
    let fonts: WebDiagnostics['nodes'][string]['fonts'] = [];
    try {
      const platformFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: requested.nodeId });
      fonts = platformFonts.fonts.map((font: any) => ({ family: font.familyName, glyphCount: font.glyphCount, isCustom: font.isCustomFont ?? null }));
    } catch { /* Font evidence can be unavailable for non-text hosts. */ }
    const lineBoxCount = value.lines ?? null;
    nodes[property.name] = { clipping, centerHitTest, scrollOverflow: { horizontal: value.scrollX, vertical: value.scrollY }, paintOrder, fonts, lineBoxCount };
    if (clipping === 'confirmed') warnings.push({ elementId: property.name, code: 'CLIPPED', severity: 'confirmed', message: 'The registered element is clipped by an ancestor' });
    if (centerHitTest === 'confirmed') warnings.push({ elementId: property.name, code: 'OCCLUDED', severity: 'confirmed', message: 'A different DOM node receives the center-point hit test' });
    const genericFamilies = new Set(['arial','sans-serif','serif','monospace','system-ui','-apple-system','blinkmacsystemfont','segoe ui','roboto','helvetica','noto sans']);
    const customRequested = value.requested.some((family: string) => !genericFamilies.has(family.toLowerCase()));
    if (customRequested && !fonts.some(font => value.requested.some((family: string) => font.family.toLowerCase() === family.toLowerCase()))) {
      const failed = value.requested.some((family: string) => value.failedFonts.some((name: string) => name.toLowerCase() === family.toLowerCase()));
      warnings.push({ elementId: property.name, code: 'FONT_LOAD_FAILED', severity: failed ? 'confirmed' : 'uncertain', message: failed ? 'The requested custom FontFace has an error status' : 'Chromium rendered glyphs with a family other than the first requested custom family' });
    }
    if (clipping === 'unknown' || centerHitTest === 'unknown') warnings.push({ elementId: property.name, code: 'EVIDENCE_UNAVAILABLE', severity: 'uncertain', message: 'One or more browser diagnostics could not be established' });
  }
  await cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
  return { nodes, warnings };
}

/** Owns one Chromium context. Runtime changes travel through React Native props, never CSS. */
export async function createBrowserBridge(options: BrowserBridgeOptions): Promise<BrowserBridge> {
  const profile = DeviceProfileSchema.parse(options.profile);
  const timeoutMs = options.timeoutMs ?? 10_000;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: Math.round(profile.window.width), height: Math.round(profile.window.height) },
      deviceScaleFactor: profile.pixelRatio,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('DOMSnapshot.enable');
    await cdp.send('CSS.enable');
    page.setDefaultTimeout(timeoutMs);
    await page.goto(options.webUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    await page.waitForFunction(() => !!(window as RuntimeWindow).__RN_LAYOUT_BRIDGE__, undefined, { timeout: timeoutMs });
    await page.evaluate(input => (window as RuntimeWindow).__RN_LAYOUT_BRIDGE__!.configure(input), {
      sessionId: options.sessionId,
      scenarioId: options.scenarioId,
      profile,
    });
    await waitForAssets(page, timeoutMs);

    const captureMs: number[] = [];
    const trialMs: number[] = [];
    let closed = false;
    let baseline: SpatialSnapshot | undefined;
    let activeTrial = false;
    let activeProfile = profile;
    let navigation = 0;
    let baselineNavigation = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigation++; });

    async function callRuntime(operation: 'capture' | 'resetTrial' | 'applyTrial', id?: string, patch?: RnStylePatch): Promise<unknown> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          page.evaluate(async input => {
            try {
              const runtime = (window as RuntimeWindow).__RN_LAYOUT_BRIDGE__;
              if (!runtime) return { ok: false as const, code: 'STALE_SNAPSHOT', message: 'Screen runtime is no longer mounted' };
              const value = input.operation === 'capture' ? await runtime.capture()
                : input.operation === 'resetTrial' ? await runtime.resetTrial()
                : await runtime.applyTrial(input.id!, input.patch!);
              return { ok: true as const, value };
            } catch (error) {
              const failure = error as { code?: unknown; message?: unknown };
              return { ok: false as const, code: failure?.code, message: String(failure?.message ?? error) };
            }
          }, { operation, id, patch }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new BridgeFault('TIMEOUT', `Browser runtime ${operation} timed out`)), timeoutMs);
          }),
        ]);
        if (!result.ok) {
          const code = ErrorCodeSchema.safeParse(result.code);
          throw new BridgeFault(code.success ? code.data : 'INTERNAL_ERROR', result.message);
        }
        return result.value;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    function ensureOpen(): void {
      if (closed || !browser!.isConnected()) throw new BridgeFault('SESSION_NOT_FOUND', 'Browser session is closed');
    }

    async function readStable(): Promise<SpatialSnapshot> {
      ensureOpen();
      const started = performance.now();
      await waitForAssets(page, timeoutMs);
      let previous: SpatialSnapshot | undefined;
      while (performance.now() - started < timeoutMs) {
        const raw = await callRuntime('capture');
        const parsed = SpatialSnapshotSchema.parse(raw);
        const snapshot = validateSnapshot({ ...parsed, webDiagnostics: await collectDiagnostics(cdp) }, { ...options, profile: activeProfile });
        if (snapshot.status === 'stable' && previous?.status === 'stable' && identity(previous) === identity(snapshot) && geometry(previous) === geometry(snapshot)) return snapshot;
        previous = snapshot;
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      }
      throw new BridgeFault('UNSTABLE_LAYOUT', 'Screen did not produce two matching stable layout captures');
    }

    async function setProfile(overrides?: ProfileOverrides): Promise<void> {
      const nextProfile = applyProfileOverrides(profile, overrides);
      const profileChanged = JSON.stringify(nextProfile) !== JSON.stringify(activeProfile);
      if (!profileChanged) return;
      {
        activeTrial = false;
        baseline = undefined;
        await callRuntime('resetTrial');
        await page.setViewportSize({ width: Math.round(nextProfile.window.width), height: Math.round(nextProfile.window.height) });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(nextProfile.window.width), height: Math.round(nextProfile.window.height), deviceScaleFactor: nextProfile.pixelRatio, mobile: true, screenOrientation: { type: nextProfile.orientation === 'landscape' ? 'landscapePrimary' : 'portraitPrimary', angle: nextProfile.orientation === 'landscape' ? 90 : 0 } });
      }
      activeProfile = nextProfile;
      await page.evaluate(input => (window as RuntimeWindow).__RN_LAYOUT_BRIDGE__!.configure(input), { sessionId: options.sessionId, scenarioId: options.scenarioId, profile: activeProfile });
    }

    return {
      async capture(overrides?: ProfileOverrides) {
        const started = performance.now();
        try {
          await setProfile(overrides);
          const snapshot = await readStable();
          if (!activeTrial) {
            baseline = snapshot;
            baselineNavigation = navigation;
          }
          return snapshot;
        } catch (error) {
          throw fault(error, 'Could not capture browser layout');
        } finally {
          captureMs.push(performance.now() - started);
        }
      },
      async trial(elementId: string, patch: RnStylePatch, overrides?: ProfileOverrides) {
        const started = performance.now();
        ensureOpen();
        const parsed = RnStylePatchSchema.safeParse(patch);
        if (!parsed.success) throw new BridgeFault('INVALID_INPUT', 'Unsupported React Native style patch', parsed.error.flatten());
        if (!baseline) throw new BridgeFault('STALE_SNAPSHOT', 'Capture a baseline before trying a layout mutation');
        try {
          await setProfile(overrides);
          const before = await readStable();
          if (navigation !== baselineNavigation || identity(before) !== identity(baseline)) {
            throw new BridgeFault('STALE_SNAPSHOT', 'Source, profile, navigation, or mounted elements changed since the baseline');
          }
          if (!before.nodes.some(node => node.id === elementId)) throw new BridgeFault('MISSING_ELEMENT', `Unknown element ${elementId}`);
          await callRuntime('resetTrial');
          activeTrial = false;
          const reset = await readStable();
          if (identity(reset) !== identity(baseline) || geometry(reset) !== geometry(baseline)) {
            throw new BridgeFault('STALE_SNAPSHOT', 'Reset layout no longer matches the captured baseline');
          }
          await callRuntime('applyTrial', elementId, parsed.data);
          activeTrial = true;
          const snapshot = await readStable();
          if (identity(snapshot) !== identity(baseline)) throw new BridgeFault('STALE_SNAPSHOT', 'The mounted screen changed while applying the trial');
          return snapshot;
        } catch (error) {
          // A failed candidate must never leave a partially applied trial behind.
          await callRuntime('resetTrial').catch(() => undefined);
          activeTrial = false;
          throw fault(error, 'Could not trial browser layout');
        } finally {
          trialMs.push(performance.now() - started);
        }
      },
      async resetTrial() {
        ensureOpen();
        try {
          await callRuntime('resetTrial');
          activeTrial = false;
        } catch (error) {
          throw fault(error, 'Could not reset browser trial');
        }
      },
      async screenshot() {
        ensureOpen();
        await readStable();
        return page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', scale: 'device' });
      },
      async close() {
        if (closed) return;
        closed = true;
        await cdp.detach().catch(() => undefined);
        await browser!.close();
      },
      timings() { return { captureMs: [...captureMs], trialMs: [...trialMs] }; },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    throw fault(error, 'Could not open Chromium session');
  }
}
