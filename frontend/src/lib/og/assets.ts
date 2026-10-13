import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Assets for the generated share images (Open Graph, 05 §2). Next's image renderer only reads
// TTF/OTF fonts and PNG/JPEG pictures, so the fonts ship as TTF in public/fonts/og and photos
// (WebP on the site, or an uploaded image) are converted to a JPEG data URI with sharp.
// Server-only: these read the disk. The standalone server runs from the frontend folder, so
// `public/` resolves the same in dev and in Docker.

const PUBLIC_DIR = path.join(process.cwd(), 'public');

export const OG_PHOTO = { width: 520, height: 630 } as const;

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: 'normal' | 'italic';
}

let fonts: Promise<OgFont[]> | undefined;

// Read once per server process.
export function loadOgFonts(): Promise<OgFont[]> {
  const file = (name: string) => readFile(path.join(PUBLIC_DIR, 'fonts', 'og', name));
  fonts ??= Promise.all([
    file('Fraunces-SemiBold.ttf'),
    file('Fraunces-MediumItalic.ttf'),
    file('Outfit-Regular.ttf'),
    file('Outfit-Medium.ttf'),
  ]).then(([serif, serifItalic, sans, sansMedium]) => [
    { name: 'Fraunces', data: serif, weight: 600, style: 'normal' },
    { name: 'Fraunces', data: serifItalic, weight: 500, style: 'italic' },
    { name: 'Outfit', data: sans, weight: 400, style: 'normal' },
    { name: 'Outfit', data: sansMedium, weight: 500, style: 'normal' },
  ]);
  return fonts;
}

// A site path ("/salon/a.webp") as a file under public/, refusing anything that escapes it.
export function publicFile(src: string): string | null {
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(src.split('?')[0] ?? '')));
  return file.startsWith(PUBLIC_DIR + path.sep) ? file : null;
}

async function readSource(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) {
    const response = await fetch(src, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`photo ${src}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const file = publicFile(src);
  if (!file) throw new Error(`photo ${src}: outside public/`);
  return readFile(file);
}

// The photo for the right-hand panel as a cropped JPEG data URI. Tries each source in turn (a
// service's own image, then a studio photo) and gives null when none can be read, so a broken
// upload never breaks the share image.
export async function loadOgPhoto(...sources: (string | undefined)[]): Promise<string | null> {
  for (const src of sources) {
    if (!src) continue;
    try {
      const jpeg = await sharp(await readSource(src))
        .resize(OG_PHOTO.width, OG_PHOTO.height, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch {
      // Try the next source.
    }
  }
  return null;
}
