import { RnStylePatchSchema, type BrowserRuntime } from '@rn-layout/contracts';
import { captureWeb } from './capture.web.js';
import { LayoutRegistry, settleReact } from './registry/index.js';
export function createBrowserRuntime(registry: LayoutRegistry): BrowserRuntime {
  return {
    configure: input => registry.configure(input),
    capture: () => captureWeb(registry),
    applyTrial: async (id, patch) => { registry.setTrial(id, RnStylePatchSchema.parse(patch)); await settleReact(); },
    resetTrial: async () => { registry.resetTrial(); await settleReact(); },
  };
}
