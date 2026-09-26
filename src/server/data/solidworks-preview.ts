import { crc32, inflateRawSync } from 'node:zlib';

// Framing informed by cadmpeg's original format research (CC BY 4.0):
// https://github.com/cadmpeg/cadmpeg/blob/main/docs/formats/sldprt.md
// This bounded reader extracts a cached PNG only. It does not interpret CAD geometry.
const MARKER = Buffer.from([0x14, 0, 6, 0, 8, 0]);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export type SolidWorksPreview = { bytes: Buffer; section: string; width: number; height: number };

export function extractSolidWorksPreview(bytes: Uint8Array): SolidWorksPreview | null {
  if (bytes.byteLength < 8 || bytes.byteLength > 50 * 1024 * 1024) return null;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.readUInt32BE(4) !== 4) return null;
  let offset = 8;
  let inflated = 0;
  for (let attempts = 0; attempts < 512; attempts++) {
    const block = data.indexOf(MARKER, offset);
    if (block < 0 || block + 26 > data.length) return null;
    offset = block + MARKER.length;
    const checksum = data.readUInt32LE(block + 10);
    const compressedSize = data.readUInt32LE(block + 14);
    const size = data.readUInt32LE(block + 18);
    const pathSize = data.readUInt32LE(block + 22);
    if (pathSize === 0 || pathSize > 128 || block + 26 + pathSize > data.length) continue;
    const name = Buffer.from(data.subarray(block + 26, block + 26 + pathSize).map((byte) => ((byte & 15) << 4) | (byte >> 4))).toString('utf8');
    if (name !== 'PreviewPNG' && name !== 'Images/Sheet_0') continue;
    const start = block + 26 + pathSize;
    if (size < 33 || size > MAX_IMAGE_BYTES || compressedSize === 0 || compressedSize > MAX_IMAGE_BYTES || start + compressedSize > data.length) continue;
    if (++inflated > 8) return null;
    try {
      const result = inflateRawSync(data.subarray(start, start + compressedSize), { maxOutputLength: size, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      const image = result.buffer;
      if (result.engine.bytesWritten !== compressedSize || image.length !== size || crc32(image) !== checksum || !image.subarray(0, 8).equals(PNG)) continue;
      if (image.readUInt32BE(8) !== 13 || image.toString('ascii', 12, 16) !== 'IHDR') continue;
      const width = image.readUInt32BE(16); const height = image.readUInt32BE(20);
      if (width === 0 || height === 0 || width > 4096 || height > 4096 || width * height > 8_000_000) continue;
      return { bytes: image, section: name, width, height };
    } catch {
      // Unsupported/corrupt blocks never become successful conversions.
    }
  }
  return null;
}
