import React, { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren, type Ref } from 'react';
import { Platform, Image, ScrollView, TextInput, Pressable, StyleSheet, Text, View, useWindowDimensions, type PressableStateCallbackType, type PressableProps, type TextProps, type ViewProps, type ImageProps, type ScrollViewProps, type TextInputProps } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext, SafeAreaProvider } from 'react-native-safe-area-context';
import { BridgeFault, NativeServerMessageSchema, type DeviceProfile, type SourceRef, type NativeTarget } from '@nativemason/contracts';
import { runScenarioHook } from '../scenario-hooks.js';
import { captureNative } from '../capture.native.js';
import { LayoutRegistry, type HostNode, type Registration } from '../registry/index.js';
import { createBrowserRuntime } from '../trials.web.js';

declare const __DEV__: boolean;
const isDevelopment = () => typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
const RegistryContext = createContext<LayoutRegistry | null>(null);
const ParentContext = createContext<string | null>(null);
const TextNestingContext = createContext(false);
export interface LayoutProviderProps extends PropsWithChildren {
  scenarioId: string;
  rootId: string;
  profile?: DeviceProfile;
  nativeUrl?: string;
  nativeToken?: string;
  nativeTarget?: NativeTarget;
  textProbes?: boolean;
}
export function LayoutProvider({ scenarioId, rootId, profile, nativeUrl, nativeToken, nativeTarget, textProbes = false, children }: LayoutProviderProps) {
  const dimensions = useWindowDimensions();
  const safeFrame = useContext(SafeAreaFrameContext);
  const safeInsets = useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const width = Platform.OS === 'web' ? dimensions.width : safeFrame?.width ?? dimensions.width;
  const height = Platform.OS === 'web' ? dimensions.height : safeFrame?.height ?? dimensions.height;
  const fallback: DeviceProfile = { window: { width, height }, root: { x: 0, y: 0, width, height }, pixelRatio: dimensions.scale, fontScale: dimensions.fontScale, orientation: width > height ? 'landscape' : 'portrait', insets: safeInsets };
  const registryRef = useRef<LayoutRegistry | null>(null);
  if (!registryRef.current) registryRef.current = new LayoutRegistry(scenarioId, profile ?? fallback, rootId);
  const registry = registryRef.current;
  const configuredTarget = nativeTarget ?? ((Platform.OS === 'android' || Platform.OS === 'ios') && process.env.EXPO_PUBLIC_LAYOUT_TARGET_ID ? { targetId: process.env.EXPO_PUBLIC_LAYOUT_TARGET_ID, platform: Platform.OS, kind: process.env.EXPO_PUBLIC_LAYOUT_TARGET_KIND === 'emulator' ? 'emulator' as const : process.env.EXPO_PUBLIC_LAYOUT_TARGET_KIND === 'simulator' ? 'simulator' as const : 'physical' as const } : undefined);
  registry.nativeTarget = configuredTarget;
  registry.textProbes = textProbes;
  registry.autoRoot = rootId === "__nativemason_auto_root";
  useSyncExternalStore(registry.subscribe, registry.getRevision, registry.getRevision);
  useLayoutEffect(() => {
    if (!isDevelopment()) return;
    if (!registry.autoRoot && registry.rootId !== rootId) { registry.rootId = rootId; registry.generation++; registry.resetTrial(); }
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
    if (!isDevelopment() || (Platform.OS !== 'android' && Platform.OS !== 'ios') || !nativeUrl || !nativeToken) return;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(nativeUrl);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'hello', protocolVersion: 2, token: nativeToken, scenarioId, platform: Platform.OS, targetId: configuredTarget?.targetId ?? Platform.OS, capabilities: { textFits: textProbes, scenarioActions: true } }));
      socket.onmessage = event => {
        const currentSocket = socket;
        void (async () => {
          let requestId: string | undefined;
          try {
            const request = NativeServerMessageSchema.parse(JSON.parse(String(event.data)));
            requestId = request.requestId;
            registry.sessionId = request.sessionId;
            if (request.type === 'action') {
              await runScenarioHook(request.name, request.value);
              currentSocket?.send(JSON.stringify({ type: 'action_result', requestId }));
              return;
            }
            const snapshot = await captureNative(registry);
            for (const [path, hash] of Object.entries(request.expectedRevisions)) {
              if (snapshot.revisions[path] !== hash) throw new BridgeFault('STALE_SOURCE', `Native runtime has not loaded ${path}`);
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
  }, [nativeToken, nativeUrl, configuredTarget?.targetId, textProbes, registry, scenarioId]);
  const insets = Platform.OS === 'web' && registry.configured ? registry.profile.insets : safeInsets;
  return <RegistryContext.Provider value={isDevelopment() ? registry : null}><SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider></RegistryContext.Provider>;
}
export interface LayoutElementProps { layoutId?: string; __bridgeSource?: SourceRef; __bridgeId?: string }
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
  return undefined;
}
function useRegistration(props: LayoutElementProps & { style?: unknown; accessibilityRole?: unknown; testID?: string }, kind: Registration['kind'], forwarded: Ref<any>, authoredTextProps?: Registration['authoredTextProps'], textSignature?: string) {
  const registry = useContext(RegistryContext);
  const parentId = useContext(ParentContext);
  const instanceId = useId();
  const sourceId = props.__bridgeId ?? (props.__bridgeSource ? `${props.__bridgeSource.path}:${props.__bridgeSource.start}` : "unmapped");
  const baseId = parentId ? `${parentId}/${sourceId}` : sourceId;
  const id = props.layoutId ?? props.testID ?? registry?.claimAutoId(baseId, instanceId) ?? `${baseId}#${instanceId}`;
  useSyncExternalStore(registry?.subscribe ?? noSubscribe, registry?.getRevision ?? zeroRevision, registry?.getRevision ?? zeroRevision);
  const hostRef = useRef<HostNode | null>(null);
  const forwardedCleanup = useRef<(() => void) | undefined>(undefined);
  const registration = useRef<Omit<Registration, 'host'>>({} as Omit<Registration, 'host'>);
  const dynamicStyle = typeof props.style === 'function';
  registration.current = { id, parentId, kind, role: typeof props.accessibilityRole === 'string' ? props.accessibilityRole : kind === 'Pressable' ? 'button' : null, styles: dynamicStyle ? {} : StyleSheet.flatten(props.style as any) ?? {}, source: props.__bridgeSource ?? null, dynamicStyle, ...(textSignature ? { measurementSignature: textSignature + JSON.stringify(registry?.overrides.get(id)) } : {}), ...(authoredTextProps ? { authoredTextProps } : {}) };
  const ref = useCallback((host: HostNode | null) => {
    if (hostRef.current && registry) registry.unregister(id, hostRef.current);
    hostRef.current = host;
    if (host && registry) registry.register({ ...registration.current, host });
    if (forwardedCleanup.current) { forwardedCleanup.current(); forwardedCleanup.current = undefined; }
    else if (!host) assignRef(forwarded, null);
    if (host) { const cleanup = assignRef(forwarded, host); if (typeof cleanup === 'function') forwardedCleanup.current = cleanup; }
  }, [forwarded, id, registry]);
  useLayoutEffect(() => { if (registry && hostRef.current) registry.register({ ...registration.current, host: hostRef.current }); });
  return { ref, id, override: registry?.overrides.get(id), registry };
}
const noSubscribe = () => () => {};
const zeroRevision = () => 0;
export const LayoutView = forwardRef<View, ViewProps & LayoutElementProps>(function LayoutView({ layoutId, __bridgeSource, __bridgeId, children, ...props }, forwarded) {
  const { ref, id, override } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'View', forwarded);
  return <ParentContext.Provider value={id}><View {...props} collapsable={isDevelopment() ? false : props.collapsable} ref={ref} style={override ? [props.style, override] : props.style}>{children}</View></ParentContext.Provider>;
});
export const LayoutText = forwardRef<Text, TextProps & LayoutElementProps>(function LayoutText({ layoutId, __bridgeSource, __bridgeId, children, ...props }, forwarded) {
  const nestedText = useContext(TextNestingContext);
  const flattened = StyleSheet.flatten(props.style) ?? {};
  const authoredTextProps: Registration['authoredTextProps'] = {
    ...(typeof flattened.fontSize === 'number' ? { fontSize: flattened.fontSize } : {}),
    ...(typeof flattened.lineHeight === 'number' ? { lineHeight: flattened.lineHeight } : {}),
    ...(typeof props.numberOfLines === 'number' && props.numberOfLines > 0 ? { numberOfLines: props.numberOfLines } : {}),
    ...(typeof props.allowFontScaling === 'boolean' ? { allowFontScaling: props.allowFontScaling } : {}),
    ...(props.ellipsizeMode ? { ellipsizeMode: props.ellipsizeMode } : {}),
  };
  const { ref, id, override, registry } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'Text', forwarded, authoredTextProps, JSON.stringify([typeof children === 'string' || typeof children === 'number' ? children : 'unsupported', flattened, authoredTextProps]));
  const effectiveTextStyle = StyleSheet.flatten([props.style, override]) ?? {};
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [full, setFull] = useState<{ lineCount: number; height: number } | null>(null);
  const [limited, setLimited] = useState<number | undefined>();
  const plain = typeof children === 'string' || typeof children === 'number';
  const comparableText = !props.adjustsFontSizeToFit && props.minimumFontScale === undefined;
  const signature = JSON.stringify([plain ? children : null, flattened, box.width, props.numberOfLines, props.allowFontScaling, props.maxFontSizeMultiplier, props.textBreakStrategy, props.android_hyphenationFrequency, props.lineBreakStrategyIOS, props.dynamicTypeRamp, comparableText, override]);
  const previousSignature = useRef(signature);
  useLayoutEffect(() => {
    if (previousSignature.current !== signature) { previousSignature.current = signature; setFull(null); setLimited(undefined); }
  }, [signature]);
  useLayoutEffect(() => {
    if (!registry?.textProbes || Platform.OS === 'web' || nestedText || !plain || !comparableText || typeof effectiveTextStyle.fontSize !== 'number' || !box.width || !full || limited === undefined) {
      registry?.updateTextFit(id, { status: 'unavailable', reason: 'Requires an enabled probe, plain non-nested text, explicit fontSize, supported sizing props, and settled native measurements' });
      return;
    }
    registry.updateTextFit(id, { status: 'supported', fullLineCount: full.lineCount, limitedLineCount: limited, fullHeight: full.height, availableHeight: Math.max(0, box.height - (typeof effectiveTextStyle.paddingBottom === "number" ? effectiveTextStyle.paddingBottom : typeof effectiveTextStyle.paddingVertical === "number" ? effectiveTextStyle.paddingVertical : typeof effectiveTextStyle.padding === "number" ? effectiveTextStyle.padding : 0)) });
  }, [registry, id, plain, comparableText, nestedText, effectiveTextStyle.fontSize, box.width, box.height, full, limited, signature]);
  const onTextLayout: TextProps['onTextLayout'] = event => {
    registry?.updateTextMetrics(id, event.nativeEvent.lines.length);
    setLimited(event.nativeEvent.lines.length);
    props.onTextLayout?.(event);
  };
  const onLayout: TextProps['onLayout'] = event => {
    const { width, height } = event.nativeEvent.layout;
    setBox(current => current.width === width && current.height === height ? current : { width, height });
    props.onLayout?.(event);
  };
  const probe = isDevelopment() && Platform.OS !== 'web' && registry?.textProbes && !nestedText && plain && comparableText && typeof effectiveTextStyle.fontSize === 'number' && box.width > 0;
  return <ParentContext.Provider value={id}><TextNestingContext.Provider value={true}><Text {...props} onLayout={isDevelopment() ? onLayout : props.onLayout} onTextLayout={isDevelopment() ? onTextLayout : props.onTextLayout} ref={ref} style={override ? [props.style, override] : props.style}>{children}</Text>{probe ? <Text key={signature} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" allowFontScaling={props.allowFontScaling} maxFontSizeMultiplier={props.maxFontSizeMultiplier} textBreakStrategy={props.textBreakStrategy} android_hyphenationFrequency={props.android_hyphenationFrequency} lineBreakStrategyIOS={props.lineBreakStrategyIOS} dynamicTypeRamp={props.dynamicTypeRamp} style={[props.style, override, { position: 'absolute', opacity: 0, width: box.width, height: undefined, minHeight: undefined, maxHeight: undefined, flex: 0 }]} onTextLayout={event => { const lines = event.nativeEvent.lines; const height = lines.reduce((max, line) => Math.max(max, line.y + line.height), 0); setFull({ lineCount: lines.length, height }); }}>{children}</Text> : null}</TextNestingContext.Provider></ParentContext.Provider>;
});
export const LayoutPressable = forwardRef<View, PressableProps & LayoutElementProps>(function LayoutPressable({ layoutId, __bridgeSource, __bridgeId, children, ...props }, forwarded) {
  const { ref, id, override } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'Pressable', forwarded);
  let style: PressableProps['style'] = props.style;
  if (override) {
    const originalStyle = props.style;
    style = typeof originalStyle === 'function' ? (state: PressableStateCallbackType) => [originalStyle(state), override] : [originalStyle, override];
  }
  return <ParentContext.Provider value={id}><Pressable {...props} ref={ref} style={style}>{children}</Pressable></ParentContext.Provider>;
});

export const LayoutTextInput = forwardRef<TextInput, TextInputProps & LayoutElementProps>(function LayoutTextInput({ layoutId, __bridgeSource, __bridgeId, ...props }, forwarded) {
  const { ref, override } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'TextInput', forwarded);
  return <TextInput {...props} ref={ref} style={override ? [props.style, override] : props.style} />;
});
export const LayoutScrollView = forwardRef<ScrollView, ScrollViewProps & LayoutElementProps>(function LayoutScrollView({ layoutId, __bridgeSource, __bridgeId, children, ...props }, forwarded) {
  const { ref, id, override } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'ScrollView', forwarded);
  return <ParentContext.Provider value={id}><ScrollView {...props} ref={ref} style={override ? [props.style, override] : props.style}>{children}</ScrollView></ParentContext.Provider>;
});
export const LayoutImage = forwardRef<Image, ImageProps & LayoutElementProps>(function LayoutImage({ layoutId, __bridgeSource, __bridgeId, ...props }, forwarded) {
  const { ref, override } = useRegistration({ ...props, layoutId, __bridgeSource, __bridgeId }, 'Image', forwarded);
  return <Image {...props} ref={ref} style={override ? [props.style, override] : props.style} />;
});
/** Development root transform with safe-area and bridge providers. */
export function withLayoutRoot<P extends object>(Component: React.ComponentType<P>, options: Partial<LayoutProviderProps> = {}) {
  if (!isDevelopment()) return Component;
  function InstrumentedRoot(props: P) {
    return <SafeAreaProvider><LayoutProvider {...options} rootId="__nativemason_auto_root" scenarioId={options.scenarioId ?? process.env.EXPO_PUBLIC_LAYOUT_SCENARIO ?? 'default'} nativeUrl={options.nativeUrl ?? process.env.EXPO_PUBLIC_LAYOUT_NATIVE_URL} nativeToken={options.nativeToken ?? process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN}><Component {...props} /></LayoutProvider></SafeAreaProvider>;
  }
  InstrumentedRoot.displayName = 'NativeMasonRoot';
  return InstrumentedRoot;
}
