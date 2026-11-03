import { RnStylePatchSchema, LayoutMutationSchema, type BrowserRuntime } from '@nativemason/contracts';
import { runScenarioHook } from './scenario-hooks.js';
import { captureWeb } from './capture.web.js';
import { LayoutRegistry, settleReact } from './registry/index.js';
export function createBrowserRuntime(registry: LayoutRegistry): BrowserRuntime {
  return {
    runHook: async (name, value) => { await runScenarioHook(name, value); await settleReact(); },
    configure: input => registry.configure(input),
    capture: () => captureWeb(registry),
    getDiagnosticTargets: () => [...registry.entries.values()].flatMap(entry => {
      const element = entry.host as unknown;
      return element && typeof element === 'object' && 'nodeType' in element ? [{ id: entry.id, element }] : [];
    }),
    applyTrialBatch: async mutations => { const parsed = mutations.map(mutation => LayoutMutationSchema.parse(mutation)); registry.setTrialBatch(parsed); await settleReact(); },
    applyTrial: async (id, patch) => { registry.setTrial(id, RnStylePatchSchema.parse(patch)); await settleReact(); },
    resetTrial: async () => { registry.resetTrial(); await settleReact(); },
  };
}
