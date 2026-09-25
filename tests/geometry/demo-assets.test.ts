import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BendSchema, PanelModelSchema, StepSchema } from '../../src/contracts';

import type { Bend, PanelModel, Step } from '../../src/contracts';
import type { SceneData } from '../../src/features/visualization/components/signatures';
import { evaluatePose, validateSceneData } from '../../src/features/visualization/geometry/pose';

type SyntheticPacket = {
  manifestVersion: string;
  part: { partNumber: string; drawingRevision: string; name: string; partFamily: string };
  panelModel: PanelModel;
  bendMappings: Array<{ bendId: string; hingeId: string; foldRotationDeg: number; finishedAngle: { degrees: number; convention: 'internal' | 'external' | 'from_flat' } }>;
  stepOrder: string[];
  provenance: { source: string; authorship: string; intendedUse: string; coordinateConvention: string };
};

function readPacket(variant: 'alpha' | 'bravo'): SyntheticPacket {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo/sensor-mount-' + variant + '.bend.json'), 'utf8')) as SyntheticPacket;
}

function sourced<T>(value: T) {
  return { value, evidence: [], evidenceState: 'supported' as const, originalText: null };
}

function sceneData(packet: SyntheticPacket): SceneData {
  const bends: Bend[] = packet.bendMappings.map((mapping) => ({
    bendId: mapping.bendId,
    hingeId: mapping.hingeId,
    finishedAngle: sourced(mapping.finishedAngle),
    foldRotationDeg: sourced(mapping.foldRotationDeg),
    insideRadiusMm: sourced(1.2),
    directionText: sourced('Synthetic demonstration fold'),
  }));
  const idByBend = new Map(bends.map((bend, index) => [bend.bendId, '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')]));
  const steps: Step[] = packet.stepOrder.map((bendId) => ({
    id: idByBend.get(bendId) ?? '',
    bendId,
    instruction: 'Fold ' + bendId,
    evidence: [],
    camera: null,
  }));
  PanelModelSchema.parse(packet.panelModel);
  bends.forEach((bend) => BendSchema.parse(bend));
  steps.forEach((step) => StepSchema.parse(step));
  return { panelModel: packet.panelModel, bends, steps };
}

function readGlbDocument(path: string): Record<string, unknown> {
  const buffer = readFileSync(path);
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(buffer.readUInt32LE(4)).toBe(2);
  expect(buffer.readUInt32LE(8)).toBe(buffer.byteLength);
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const size = buffer.readUInt32LE(offset);
    const kind = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const start = offset + 8;
    if (kind === 'JSON') return JSON.parse(buffer.subarray(start, start + size).toString('utf8')) as Record<string, unknown>;
    offset = start + size;
  }
  throw new Error('The GLB has no JSON chunk');
}

describe('original synthetic demonstration packet', () => {
  it('validates and evaluates both distinct source manifests', () => {
    const alphaPacket = readPacket('alpha');
    const bravoPacket = readPacket('bravo');
    const alpha = sceneData(alphaPacket);
    const bravo = sceneData(bravoPacket);
    validateSceneData(alpha);
    validateSceneData(bravo);

    expect(alphaPacket.provenance.intendedUse).toContain('not for production');
    expect(bravoPacket.provenance.intendedUse).toContain('not for production');
    expect(alphaPacket.stepOrder).not.toEqual(bravoPacket.stepOrder);
    expect(alphaPacket.panelModel.thicknessMm).not.toBe(bravoPacket.panelModel.thicknessMm);
    expect(evaluatePose(alpha, alpha.steps.length, 0)['right-flange']).not.toEqual(
      evaluatePose(bravo, bravo.steps.length, 0)['right-flange'],
    );
  });

  it.each(['alpha', 'bravo'] as const)('ships a self-contained GLB and one-page PDF for %s', (variant) => {
    const prefix = resolve(process.cwd(), 'public/demo/sensor-mount-' + variant);
    const glb = readGlbDocument(prefix + '.final.glb');
    const asset = glb.asset as { version?: string; generator?: string };
    const buffers = glb.buffers as Array<{ uri?: string }>;
    expect(asset.version).toBe('2.0');
    expect(asset.generator).toContain('SkunkWorks');
    expect(buffers).toHaveLength(1);
    expect(buffers[0].uri).toBeUndefined();
    expect(readFileSync(prefix + '.drawing.pdf').subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(readFileSync(prefix + '.drawing.pdf').toString('latin1')).toContain('/Count 1');
  });

  it.each(['alpha', 'bravo'] as const)('parses the complete GLB scene for %s', async (variant) => {
    const bytes = readFileSync(resolve(process.cwd(), 'public/demo/sensor-mount-' + variant + '.final.glb'));
    const arrayBuffer = Uint8Array.from(bytes).buffer;
    const gltf = await new Promise<GLTF>((resolveScene, reject) => {
      new GLTFLoader().parse(arrayBuffer, '', resolveScene, reject);
    });
    let meshCount = 0;
    gltf.scene.traverse((object) => { if (object instanceof Mesh) meshCount += 1; });
    expect(gltf.scene.children.length).toBeGreaterThan(0);
    expect(meshCount).toBeGreaterThan(0);
  });
});
