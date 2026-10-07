import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const ART_DIR = join(import.meta.dirname, "..", "vendor", "art");
// Widths of the WebP thumbnails served to the lists (the second one is for high-density screens).
export const THUMB_WIDTHS: ReadonlySet<number> = new Set([160, 320]);

const thumbsDir = () => process.env.ART_THUMBS_DIR ?? join(ART_DIR, "thumbs");
export const thumbFile = (code: number, width: number) => join(thumbsDir(), `${code}-${width}.webp`);
const pending = new Map<string, Promise<void>>();

async function resize(source: string, file: string, width: number) {
  mkdirSync(thumbsDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
  renameSync(tmp, file);
}

// Creates the thumbnail of an artwork on first request, then keeps it on disk next to the artworks.
export async function ensureThumb(source: string, code: number, width: number): Promise<string> {
  const file = thumbFile(code, width);
  if (existsSync(file)) return file;
  let job = pending.get(file);
  if (!job) {
    job = resize(source, file, width).finally(() => pending.delete(file));
    pending.set(file, job);
  }
  await job;
  return file;
}
