import React, { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type PropsWithChildren, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type PressableStateCallbackType, type PressableProps, type TextProps, type ViewProps } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { BridgeFault, NativeServerMessageSchema, type DeviceProfile, type SourceRef } from '@rn-layout/contracts';
import { captureNative } from '../capture.native.js';
import { LayoutRegistry, type HostNode, type Registration } from '../registry/index.js';
import { createBrowserRuntime } from '../trials.web.js';

declare const __DEV__: boolean;
const isDevelopment = () => typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
const RegistryContext = createContext<LayoutRegistry | null>(null);
const ParentContext = createContext<string | null>(null);
export interface LayoutProviderProps extends PropsWithChildren {
  scenarioId: string;
  rootId: string;
  profile?: DeviceProfile;
  nativeUrl?: string;
  nativeToken?: string;
}
export function LayoutProvider({ scenarioId, rootId, profile, nativeUrl, nativeToken, children }: LayoutProviderProps) {
  const dimensions = useWindowDimensions();
  const safeFrame = useContext(SafeAreaFrameContext);
  const safeInsets = useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const width = Platform.OS === 'web' ? dimensions.width : safeFrame?.width ?? dimensions.width;
  const height = Platform.OS === 'web' ? dimensions.height : safeFrame?.height ?? dimensions.height;
  const fallback: DeviceProfile = { window: { width, height }, root: { x: 0, y: 0, width, height }, pixelRatio: dimensions.scale, fontScale: dimensions.fontScale, orientation: width > height ? 'landscape' : 'portrait', insets: safeInsets };
  const registryRef = useRef<LayoutRegistry | null>(null);
  if (!registryRef.current) registryRef.current = new LayoutRegistry(scenarioId, profile ?? fallback, rootId);
  const registry = registryRef.current;
  useSyncExternalStore(registry.subscribe, registry.getRevision, registry.getRevision);
  useLayoutEffect(() => {
    if (!isDevelopment()) return;
    if (registry.rootId !== rootId) { registry.rootId = rootId; registry.generation++; registry.resetTrial(); }
    if (registry.scenarioId !== scenarioId) { registry.scenarioId = scenarioId; registry.generation++; registry.resetTrial(); }
    if (Platform.OS !== 'web') {
      registry.windowOrigin = { x: safeFrame?.x ?? 0, y: safeFrame?.y ?? 0 };
      const next = { ...fallback, insets: safeInsets };
      if (JSON.stringify(next) !== JSON.stringify(registry.profile)) { registry.profile = next; registry.generation++; }
    }
  });
  useEffect(() => {
    if (!isDevelopment() || Platform.OS !== 'web') return;
    const runtime = createBrowserRuntime(registry);
    registry.runtime = runtime;
    const target = window as Window & { __RN_LAYOUT_BRIDGE__?: typeof runtime };
    if (target.__RN_LAYOUT_BRIDGE__) throw new BridgeFault('INVALID_INPUT', 'Only one LayoutProvider is supported per page');
    target.__RN_LAYOUT_BRIDGE__ = runtime;
    return () => { if (target.__RN_LAYOUT_BRIDGE__ === runtime) delete target.__RN_LAYOUT_BRIDGE__; };
  }, [registry]);
  useEffect(() => {
    if (!isDevelopment() || Platform.OS !== 'android' || !nativeUrl || !nativeToken) return;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(nativeUrl);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token: nativeToken, scenarioId }));
      socket.onmessage = event => {
        const currentSocket = socket;
        void (async () => {
          let requestId: string | undefined;
          try {
            const request = NativeServerMessageSchema.parse(JSON.parse(String(event.data)));
            requestId = request.requestId;
            registry.sessionId = request.sessionId;
            const snapshot = await captureNative(registry);
            for (const [path, hash] of Object.entries(request.expectedRevisions)) {
              if (snapshot.revisions[path] !== hash) throw new BridgeFault('STALE_SOURCE', `Android has not loaded ${path}`);
            }
            currentSocket?.send(JSON.stringify({ type: 'snapshot', requestId, snapshot }));
          } catch (error) {
            if (requestId && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type: 'error', requestId, error: { code: error instanceof BridgeFault ? error.code : 'INVALID_INPUT', message: error instanceof Error ? error.message : String(error) } }));
          }
        })();
      };
      socket.onerror = () => { /* onclose schedules the next connection */ };
      socket.onclose = () => { if (!disposed) reconnect = setTimeout(connect, 1000); };
    };
    connect();
    return () => { disposed = true; clearTimeout(reconnect); socket?.close(); };
  }, [nativeToken, nativeUrl, registry, scenarioId]);
  const insets = Platform.OS === 'web' && registry.configured ? registry.profile.insets : safeInsets;
  return <RegistryContext.Provider value={isDevelopment() ? registry : null}><SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider></RegistryContext.Provider>;
}
export interface LayoutElementProps { layoutId: string; __bridgeSource?: SourceRef }
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
  return undefined;
}
function useRegistration(props: LayoutElementProps & { style?: unknown; accessibilityRole?: unknown }, kind: Registration['kind'], forwarded: Ref<any>) {
  const registry = useContext(RegistryContext);
  const parentId = useContext(ParentContext);
  useSyncExternalStore(registry?.subscribe ?? noSubscribe, registry?.getRevision ?? zeroRevision, registry?.getRevision ?? zeroRevision);
  const hostRef = useRef<HostNode | null>(null);
  const forwardedCleanup = useRef<(() => void) | undefined>(undefined);
  const registration = useRef<Omit<Registration, 'host'>>({} as Omit<Registration, 'host'>);
  const dynamicStyle = typeof props.style === 'function';
  registration.current = { id: props.layoutId, parentId, kind, role: typeof props.accessibilityRole === 'string' ? props.accessibilityRole : kind === 'Pressable' ? 'button' : null, styles: dynamicStyle ? {} : StyleSheet.flatten(props.style as any) ?? {}, source: props.__bridgeSource ?? null, dynamicStyle };
  const ref = useCallback((host: HostNode | null) => {
    if (hostRef.current && registry) registry.unregister(props.layoutId, hostRef.current);
    hostRef.current = host;
    if (host && registry) registry.register({ ...registration.current, host });
    if (forwardedCleanup.current) { forwardedCleanup.current(); forwardedCleanup.current = undefined; }
    else if (!host) assignRef(forwarded, null);
    if (host) { const cleanup = assignRef(forwarded, host); if (typeof cleanup === 'function') forwardedCleanup.current = cleanup; }
  }, [forwarded, props.layoutId, registry]);
  useLayoutEffect(() => { if (registry && hostRef.current) registry.register({ ...registration.current, host: hostRef.current }); });
  return { ref, override: registry?.overrides.get(props.layoutId) };
}
const noSubscribe = () => () => {};
const zeroRevision = () => 0;
export const LayoutView = forwardRef<View, ViewProps & LayoutElementProps>(function LayoutView({ layoutId, __bridgeSource, children, ...props }, forwarded) {
  const { ref, override } = useRegistration({ ...props, layoutId, __bridgeSource }, 'View', forwarded);
  return <ParentContext.Provider value={layoutId}><View {...props} collapsable={isDevelopment() ? false : props.collapsable} ref={ref} style={override ? [props.style, override] : props.style}>{children}</View></ParentContext.Provider>;
});
export const LayoutText = forwardRef<Text, TextProps & LayoutElementProps>(function LayoutText({ layoutId, __bridgeSource, children, ...props }, forwarded) {
  const { ref, override } = useRegistration({ ...props, layoutId, __bridgeSource }, 'Text', forwarded);
  return <ParentContext.Provider value={layoutId}><Text {...props} ref={ref} style={override ? [props.style, override] : props.style}>{children}</Text></ParentContext.Provider>;
});
export const LayoutPressable = forwardRef<View, PressableProps & LayoutElementProps>(function LayoutPressable({ layoutId, __bridgeSource, children, ...props }, forwarded) {
  const { ref, override } = useRegistration({ ...props, layoutId, __bridgeSource }, 'Pressable', forwarded);
  const style = typeof props.style === 'function' ? (state: PressableStateCallbackType) => [typeof props.style === 'function' ? props.style(state) : props.style, override] : override ? [props.style, override] : props.style;
  return <ParentContext.Provider value={layoutId}><Pressable {...props} ref={ref} style={style}>{children}</Pressable></ParentContext.Provider>;
});
