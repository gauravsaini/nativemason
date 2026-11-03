import { BridgeFault } from '@nativemason/contracts';
const handlers = new Map<string, (value?: unknown) => void | Promise<void>>();
/** Register an explicitly named development action; returns an ownership-safe cleanup. */
export function registerScenarioHook(name: string, handler: (value?: unknown) => void | Promise<void>): () => void {
  if (typeof __DEV__ !== 'undefined' ? !__DEV__ : process.env.NODE_ENV === 'production') return () => {};
  if (!name || handlers.has(name)) throw new BridgeFault('INVALID_INPUT', `Duplicate or empty scenario hook: ${name}`);
  handlers.set(name, handler);
  return () => { if (handlers.get(name) === handler) handlers.delete(name); };
}
export async function runScenarioHook(name: string, value?: unknown): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) throw new BridgeFault('INVALID_INPUT', `Scenario hook is not registered: ${name}`);
  await handler(value);
}
declare const __DEV__: boolean;
