import sharp from 'sharp';
import { AppError } from '../errors/index.js';

// Upload rules for images (06 §4, API-027): png/jpeg/webp only, max 2 MB, type sniffed from the
// bytes (the client's Content-Type is ignored), re-encoded so EXIF/GPS and other metadata are
// dropped, and stored under a random name chosen by the caller.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Rejects decompression bombs: a tiny file that decodes to a huge bitmap.
const MAX_INPUT_PIXELS = 40_000_000;

const FORMATS = {
  png: { ext: 'png', contentType: 'image/png' },
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  webp: { ext: 'webp', contentType: 'image/webp' },
} as const;

type AllowedFormat = keyof typeof FORMATS;

export interface ProcessedImage {
  buffer: Buffer;
  ext: string;
  contentType: string;
}

export class InvalidFileError extends AppError {
  constructor(message: string, statusCode: 400 | 413 = 400) {
    super(statusCode, 'INVALID_FILE', message);
  }
}

const isAllowed = (format: string | undefined): format is AllowedFormat =>
  format !== undefined && Object.hasOwn(FORMATS, format);

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_IMAGE_BYTES) {
    throw new InvalidFileError('Images must be 2 MB or smaller.', 413);
  }
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new InvalidFileError('The file is not a readable image.');
  }
  if (!isAllowed(format)) {
    throw new InvalidFileError('Only PNG, JPEG and WebP images are accepted.');
  }
  try {
    // rotate() applies the EXIF orientation before the metadata is dropped (sharp strips all
    // metadata on output unless asked to keep it).
    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .toFormat(format)
      .toBuffer();
    return { buffer, ...FORMATS[format] };
  } catch {
    throw new InvalidFileError('The image could not be processed.');
  }
}
