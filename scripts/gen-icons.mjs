/**
 * Rasterises the PWA icons from scripts/*.svg into public/.
 * Run with: node scripts/gen-icons.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const jobs = [
  { src: 'icon.svg', out: 'pwa-192.png', size: 192 },
  { src: 'icon.svg', out: 'pwa-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'pwa-maskable-512.png', size: 512 },
  { src: 'icon.svg', out: 'apple-touch-icon.png', size: 180 },
];

for (const { src, out, size } of jobs) {
  const svg = readFileSync(join(here, src));
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    // Palette quantisation: the artwork is flat enough that 128 colours is
    // visually identical and roughly a quarter of the size. These icons are
    // precached by the service worker, so the saving is worth having.
    .png({ compressionLevel: 9, palette: true, colours: 48, dither: 1 })
    .toFile(join(publicDir, out));
  console.log(`wrote public/${out} (${size}x${size})`);
}
