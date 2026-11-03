import React, { createRef } from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => ReactModule.forwardRef((props: Record<string, unknown>, ref) => ReactModule.createElement(name, { ...props, ref }));
  return {
    Platform: { OS: 'android' },
    View: host('View'), Text: host('Text'), TextInput: host('TextInput'), Image: host('Image'), ScrollView: host('ScrollView'), Pressable: host('Pressable'),
    StyleSheet: { flatten: (style: unknown): Record<string, unknown> | undefined => Array.isArray(style) ? Object.assign({}, ...style.map(item => typeof item === 'object' && item ? item : {})) : style && typeof style === 'object' ? style as Record<string, unknown> : undefined },
    useWindowDimensions: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const ReactModule = await import('react');
  const SafeAreaInsetsContext = ReactModule.createContext({ top: 0, right: 0, bottom: 0, left: 0 });
  const SafeAreaFrameContext = ReactModule.createContext({ x: 0, y: 0, width: 400, height: 800 });
  return { SafeAreaInsetsContext, SafeAreaFrameContext, SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children };
});

import { LayoutProvider, LayoutText, LayoutView, LayoutPressable } from './index.js';
import { LayoutRegistry } from '../registry/index.js';

const profile = { window: { width: 400, height: 800 }, root: { x: 0, y: 0, width: 400, height: 800 }, pixelRatio: 1, fontScale: 1, orientation: 'portrait' as const, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const createNodeMock = ({ type }: { type: string }) => ({ type });
const mount = async (children: React.ReactNode, textProbes = false) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<LayoutProvider scenarioId="test" rootId="root" profile={profile} textProbes={textProbes}>{children}</LayoutProvider>, { createNodeMock });
  });
  return renderer;
};
const findHost = (renderer: TestRenderer.ReactTestRenderer, type: string): ReactTestInstance => renderer.root.find(instance => instance.type === type && instance.props.accessible !== false);

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('layout component contracts', () => {
  it('uses current probe evidence without requiring another limited callback and rejects a stale width probe',async()=>{
    const updates=vi.spyOn(LayoutRegistry.prototype,'updateTextFit');
    const renderer=await mount(<LayoutText layoutId="copy" numberOfLines={1} style={{fontSize:16}}>Long text</LayoutText>,true);
    const host=findHost(renderer,'Text');
    await act(async()=>host.props.onLayout({nativeEvent:{layout:{width:80,height:20,x:0,y:0}}}));
    const oldProbe=renderer.root.find(instance=>instance.type==='Text'&&instance.props.accessible===false);
    const oldCallback=oldProbe.props.onTextLayout;
    await act(async()=>oldCallback({nativeEvent:{lines:[{y:0,height:20},{y:20,height:20}]}}));
    expect(updates.mock.calls.at(-1)?.[1]).toMatchObject({status:'supported',fullLineCount:2});
    await act(async()=>host.props.onLayout({nativeEvent:{layout:{width:160,height:20,x:0,y:0}}}));
    await act(async()=>oldCallback({nativeEvent:{lines:[{y:0,height:20}]}}));
    expect(updates.mock.calls.at(-1)?.[1]).toMatchObject({status:'unavailable'});
    const currentProbe=renderer.root.find(instance=>instance.type==='Text'&&instance.props.accessible===false);
    await act(async()=>currentProbe.props.onTextLayout({nativeEvent:{lines:[{y:0,height:20}]}}));
    expect(updates.mock.calls.at(-1)?.[1]).toMatchObject({status:'supported',fullLineCount:1});
    await act(async()=>renderer.unmount());
  });
  it('composes text callbacks without changing their event and preserves object refs through cleanup', async () => {
    const forwarded = createRef<{ type: string }>();
    const onLayout = vi.fn();
    const onTextLayout = vi.fn();
    const renderer = await mount(<LayoutText layoutId="copy" ref={forwarded} onLayout={onLayout} onTextLayout={onTextLayout}>Hello</LayoutText>);
    const host = findHost(renderer, 'Text');
    const layoutEvent = { nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 24 } } } as never;
    const textEvent = { nativeEvent: { lines: [{ text: 'Hello', x: 0, y: 0, width: 30, height: 24 }] } } as never;
    expect(forwarded.current).toEqual({ type: 'Text' });
    await act(async () => { host.props.onLayout(layoutEvent); host.props.onTextLayout(textEvent); });
    expect(onLayout).toHaveBeenCalledOnce();
    expect(onLayout).toHaveBeenCalledWith(layoutEvent);
    expect(onTextLayout).toHaveBeenCalledOnce();
    expect(onTextLayout).toHaveBeenCalledWith(textEvent);
    await act(async () => renderer.unmount());
    expect(forwarded.current).toBeNull();
  });

  it('runs callback ref cleanup and forwards null when the host unmounts', async () => {
    const ref = vi.fn(() => vi.fn());
    const renderer = await mount(<LayoutView layoutId="box" ref={ref} />);
    expect(ref).toHaveBeenCalledWith({ type: 'View' });
    const cleanup = ref.mock.results[0]?.value;
    await act(async () => renderer.unmount());
    expect(cleanup).toHaveBeenCalledOnce();
    expect(ref).toHaveBeenCalledTimes(1);
  });

  it('preserves Pressable style callbacks and their state argument', async () => {
    const authoredStyle = vi.fn(state => ({ opacity: state.pressed ? 0.5 : 1 }));
    const renderer = await mount(<LayoutPressable layoutId="button" style={authoredStyle} />);
    const host = findHost(renderer, 'Pressable');
    const state = { pressed: true, hovered: false, focused: false };
    expect(host.props.style).toBe(authoredStyle);
    expect(host.props.style(state)).toEqual({ opacity: 0.5 });
    expect(authoredStyle).toHaveBeenCalledWith(state);
  });

  it('marks text fitting unavailable until an enabled native probe produces both measurements', async () => {
    const updates = vi.spyOn(LayoutRegistry.prototype, 'updateTextFit');
    const registrations = vi.spyOn(LayoutRegistry.prototype, 'register');
    const disabled = await mount(<LayoutText layoutId="off" style={{ fontSize: 16 }}>A line</LayoutText>);
    expect(updates).toHaveBeenCalledWith('off', expect.objectContaining({ status: 'unavailable' }));
    expect(disabled.root.findAll(instance => instance.type === 'Text')).toHaveLength(1);
    await act(async () => disabled.unmount());

    updates.mockClear();
    registrations.mockClear();
    const enabled = await mount(<LayoutText layoutId="on" style={{ fontSize: 16 }}>A line</LayoutText>, true);
    expect(enabled.root.findAll(instance => instance.type === 'Text')).toHaveLength(1);
    const rendered = findHost(enabled, 'Text');
    await act(async () => rendered.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 80, height: 20 } } }));
    const texts = enabled.root.findAll(instance => instance.type === 'Text');
    expect(texts).toHaveLength(2);
    const probe = texts.find(instance => instance !== rendered)!;
    expect(probe.props.accessible).toBe(false);
    expect(probe.props.accessibilityElementsHidden).toBe(true);
    expect(probe.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(probe.props.pointerEvents).toBe('none');
    expect(registrations.mock.calls.every(([entry]) => entry.id === 'on')).toBe(true);
    await act(async () => {
      rendered.props.onTextLayout({ nativeEvent: { lines: [{ y: 0, height: 20 }] } });
      probe.props.onTextLayout({ nativeEvent: { lines: [{ y: 0, height: 20 }, { y: 20, height: 20 }] } });
    });
    expect(updates).toHaveBeenCalledWith('on', expect.objectContaining({ status: 'supported', fullLineCount: 2, limitedLineCount: 1 }));
    await act(async () => enabled.unmount());
  });

  it('disables text probes in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const updates = vi.spyOn(LayoutRegistry.prototype, 'updateTextFit');
    const renderer = await mount(<LayoutText layoutId="prod" style={{ fontSize: 16 }} onTextLayout={vi.fn()}>A line</LayoutText>, true);
    const host = findHost(renderer, 'Text');
    expect(renderer.root.findAll(instance => instance.type === 'Text')).toHaveLength(1);
    expect(host.props.onTextLayout).toBeDefined();
    expect(updates).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });
});
