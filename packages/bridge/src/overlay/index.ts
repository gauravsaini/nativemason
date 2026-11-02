import sharp from 'sharp';
import { BridgeFault, OverlaySceneSchema, type OverlayScene } from '@rn-layout/contracts';

function xml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

/** Draws logical-coordinate scene geometry over an existing screenshot without touching page layout. */
export async function renderOverlay(png: Uint8Array, input: OverlayScene, pixelRatio?: number): Promise<Uint8Array> {
  const parsed = OverlaySceneSchema.safeParse(input);
  if (!parsed.success) throw new BridgeFault('INVALID_INPUT', 'Invalid overlay scene', parsed.error.flatten());
  const scene = parsed.data;
  if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0) throw new BridgeFault('INVALID_INPUT', 'Overlay dimensions must be finite and positive');
  if (scene.marks.some(mark => !Number.isInteger(mark.label) || mark.label < 1)) throw new BridgeFault('INVALID_INPUT', 'Overlay marks must have positive integer labels');
  const image = sharp(png);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new BridgeFault('INVALID_INPUT', 'Screenshot has no dimensions');
  const scaleX = metadata.width / scene.width;
  const scaleY = metadata.height / scene.height;
  if (pixelRatio !== undefined && (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || Math.abs(scaleX - pixelRatio) > 1 / scene.width || Math.abs(scaleY - pixelRatio) > 1 / scene.height)) {
    throw new BridgeFault('INVALID_INPUT', 'Screenshot dimensions do not match the requested pixel ratio');
  }
  if (Math.abs(scaleX - scaleY) > Math.max(1 / scene.width, 1 / scene.height)) throw new BridgeFault('INVALID_INPUT', 'Screenshot and overlay scene have different aspect ratios');
  const targets = scene.targets.map(target => `<g><title>${xml(target.id)}</title><rect x="${target.rect.x}" y="${target.rect.y}" width="${target.rect.width}" height="${target.rect.height}" fill="#22c55e" fill-opacity="0.18" stroke="#16a34a" stroke-width="1" stroke-dasharray="4 3"/></g>`).join('');
  const marks = scene.marks.map(mark => {
    const x = Math.min(Math.max(mark.rect.x, 0), Math.max(0, scene.width - 28));
    const y = Math.min(Math.max(mark.rect.y, 0), Math.max(0, scene.height - 20));
    return `<g><title>${xml(mark.id)}</title><rect x="${mark.rect.x}" y="${mark.rect.y}" width="${mark.rect.width}" height="${mark.rect.height}" fill="none" stroke="#ef4444" stroke-width="1"/><rect x="${x}" y="${y}" width="28" height="20" rx="3" fill="#b91c1c"/><text x="${x + 14}" y="${y + 14}" font-family="sans-serif" font-size="12" text-anchor="middle" fill="white">${xml(String(mark.label))}</text></g>`;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}" viewBox="0 0 ${scene.width} ${scene.height}">${targets}${marks}</svg>`);
  return image.composite([{ input: svg }]).png().toBuffer();
}
