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
  type RnStylePatch,
  type SpatialSnapshot,
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
    page.setDefaultTimeout(timeoutMs);
    await page.goto(options.webUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
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
        const snapshot = validateSnapshot(await callRuntime('capture'), options);
        if (snapshot.status === 'stable' && previous?.status === 'stable' && identity(previous) === identity(snapshot) && geometry(previous) === geometry(snapshot)) return snapshot;
        previous = snapshot;
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      }
      throw new BridgeFault('UNSTABLE_LAYOUT', 'Screen did not produce two matching stable layout captures');
    }

    return {
      async capture() {
        const started = performance.now();
        try {
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
      async trial(elementId: string, patch: RnStylePatch) {
        const started = performance.now();
        ensureOpen();
        const parsed = RnStylePatchSchema.safeParse(patch);
        if (!parsed.success) throw new BridgeFault('INVALID_INPUT', 'Unsupported React Native style patch', parsed.error.flatten());
        if (!baseline) throw new BridgeFault('STALE_SNAPSHOT', 'Capture a baseline before trying a layout mutation');
        try {
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
        await browser!.close();
      },
      timings() { return { captureMs: [...captureMs], trialMs: [...trialMs] }; },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    throw fault(error, 'Could not open Chromium session');
  }
}
