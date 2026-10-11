import "server-only";

import sharp from "sharp";
import { AVATAR_OUTPUT_SIZE } from "@/lib/validation/limits";

export class UnsupportedImageError extends Error {
  constructor() {
    super("unsupported_image");
    this.name = "UnsupportedImageError";
  }
}

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * Re-encodes an uploaded photo as a square WebP.
 *
 * This is the safety step for profile photos:
 *   * the bytes are decoded as an image — a file that only claims to be an
 *     image (wrong extension, script payload, polyglot) is rejected;
 *   * the output is a brand-new file, so EXIF data (GPS position, device,
 *     timestamps) and any trailing data are gone;
 *   * very large images are refused before decoding (decompression bombs).
 *
 * The declared MIME type and file name from the browser are never trusted.
 */
export async function toAvatarWebp(input) {
  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    if (!ALLOWED_FORMATS.has(metadata.format)) throw new UnsupportedImageError();

    return await image
      .rotate() // apply the EXIF orientation before the metadata is dropped
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new UnsupportedImageError();
  }
}
