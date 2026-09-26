// Usage: node scripts/extract-solidworks-previews.mts /private/output/directory source.SLDPRT [source.SLDDRW ...]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { extractSolidWorksPreview } from '../src/server/data/solidworks-preview.ts';
const [out, ...sources] = process.argv.slice(2);
if (!out || !sources.length) throw new Error('Provide an output directory and native source paths.');
await mkdir(resolve(out), { recursive: true });
const manifest = [];
for (const source of sources) {
  const bytes = await readFile(source);
  const preview = extractSolidWorksPreview(bytes);
  const output = `${basename(source)}.preview.png`;
  if (preview) await writeFile(resolve(out, output), preview.bytes);
  manifest.push({ filename: basename(source), byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    preview: preview ? { filename: output, section: preview.section, width: preview.width, height: preview.height, scope: 'Cached source image, not interpreted CAD geometry or verified drawing evidence.' } : null });
}
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Inspected ${manifest.length} sources; recovered ${manifest.filter(item => item.preview).length} cached previews.`);
