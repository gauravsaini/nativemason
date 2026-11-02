import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { OverlayScene } from '@rn-layout/contracts';
import { renderOverlay } from './index.js';

const scene: OverlayScene = { width: 100, height: 80, marks: [{ id: '<button&"unsafe">', label: 1, rect: { x: 20, y: 20, width: 40, height: 30 } }], targets: [{ id: 'target', rect: { x: 20, y: 20, width: 40, height: 30 } }] };

describe('numbered screenshot overlay', () => {
  it('draws marks and targets at logical coordinates on a scaled PNG', async () => {
    const png = await sharp({ create: { width: 200, height: 160, channels: 4, background: 'white' } }).png().toBuffer();
    const result = await renderOverlay(png, scene, 2);
    const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 200, height: 160 });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(pixel(5, 5)).toEqual([255, 255, 255]);
    expect(pixel(42, 42)).not.toEqual([255, 255, 255]);
    expect(pixel(80, 90)).not.toEqual([255, 255, 255]);
  });

  it('rejects inconsistent screenshot dimensions and invalid scene sizes', async () => {
    const png = await sharp({ create: { width: 200, height: 160, channels: 4, background: 'white' } }).png().toBuffer();
    await expect(renderOverlay(png, scene, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(renderOverlay(png, { ...scene, width: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(renderOverlay(png, { ...scene, height: 50 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(renderOverlay(png, { ...scene, width: Infinity })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(renderOverlay(png, { ...scene, marks: [{ ...scene.marks[0], label: 0 }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
