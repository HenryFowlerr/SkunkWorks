import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractSolidWorksPreview } from '@/server/data/solidworks-preview';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
function envelope(payload = png, name = 'PreviewPNG') {
  const packed = deflateRawSync(payload);
  const path = Buffer.from(name).map(byte => ((byte & 15) << 4) | (byte >> 4));
  const header = Buffer.alloc(34);
  header.writeUInt32BE(4, 4);
  Buffer.from([0x14,0,6,0,8,0]).copy(header, 8);
  header.writeUInt32LE(crc32(payload), 18);
  header.writeUInt32LE(packed.length, 22);
  header.writeUInt32LE(payload.length, 26);
  header.writeUInt32LE(path.length, 30);
  return Buffer.concat([header, path, packed]);
}
describe('bounded cached SolidWorks PNG reader', () => {
  it('recovers a checksummed preview or drawing-sheet block without interpreting geometry', () => {
    expect(extractSolidWorksPreview(envelope())).toMatchObject({ bytes: png, width: 1, height: 1, section: 'PreviewPNG' });
    expect(extractSolidWorksPreview(envelope(png, 'Images/Sheet_0'))?.bytes).toEqual(png);
  });
  it('rejects changed, truncated, oversized and unrelated blocks', () => {
    const corrupt = envelope(); corrupt[18] ^= 1;
    expect(extractSolidWorksPreview(corrupt)).toBeNull();
    expect(extractSolidWorksPreview(envelope().subarray(0, -1))).toBeNull();
    const tooLarge = envelope(); tooLarge.writeUInt32LE(3_000_000, 26);
    expect(extractSolidWorksPreview(tooLarge)).toBeNull();
    expect(extractSolidWorksPreview(envelope(png, 'Geometry'))).toBeNull();
    expect(extractSolidWorksPreview(envelope(Buffer.from('not a PNG')))).toBeNull();
    expect(extractSolidWorksPreview(Buffer.from('not a SolidWorks document'))).toBeNull();
  });
  it('bounds pixel dimensions even when the compressed block checksum is valid', () => {
    const huge = Buffer.from(png); huge.writeUInt32BE(100_000, 16);
    expect(extractSolidWorksPreview(envelope(huge))).toBeNull();
  });
  it('rejects deflate output larger than the declared length', () => {
    const bomb = envelope(Buffer.alloc(100_000)); bomb.writeUInt32LE(40, 26);
    expect(extractSolidWorksPreview(bomb)).toBeNull();
  });
});
