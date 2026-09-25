import { describe, expect, it } from 'vitest';

import type { Bend, PanelModel, Step } from '../../src/contracts';
import type { SceneData } from '../../src/features/visualization/components/signatures';
import { evaluatePose, GeometryError, transformPoint } from '../../src/features/visualization/geometry/pose';

const value = <T,>(result: T) => ({
  value: result,
  evidence: [],
  evidenceState: 'supported' as const,
  originalText: null,
});

function bend(bendId: string, hingeId: string, foldRotationDeg = 90): Bend {
  return {
    bendId,
    hingeId,
    finishedAngle: value({ degrees: 90, convention: 'internal' as const }),
    foldRotationDeg: value(foldRotationDeg),
    insideRadiusMm: value(1.5),
    directionText: value('Fold around the directed hinge axis'),
  };
}

function step(bendId: string, id = ({
  B1: '00000000-0000-4000-8000-000000000001',
  B2: '00000000-0000-4000-8000-000000000002',
  B3: '00000000-0000-4000-8000-000000000003',
}[bendId] ?? '00000000-0000-4000-8000-000000000099')): Step {
  return { id, bendId, instruction: 'Fold bend ' + bendId, evidence: [], camera: null };
}

function rectangle(id: string, x0: number, y0: number, x1: number, y1: number) {
  return { id, polygonMm: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][] };
}

function model(): PanelModel {
  return {
    schemaVersion: '1.0',
    units: 'mm',
    thicknessMm: 2,
    rootPanelId: 'base',
    panels: [
      rectangle('base', 0, 0, 100, 50),
      rectangle('right', 100, 0, 130, 50),
      rectangle('left', -25, 0, 0, 50),
      rectangle('return', -43, 0, -25, 50),
    ],
    hinges: [
      { id: 'h-right', parentPanelId: 'base', childPanelId: 'right', axisStartMm: [100, 0], axisEndMm: [100, 50] },
      { id: 'h-left', parentPanelId: 'base', childPanelId: 'left', axisStartMm: [0, 0], axisEndMm: [0, 50] },
      { id: 'h-return', parentPanelId: 'left', childPanelId: 'return', axisStartMm: [-25, 0], axisEndMm: [-25, 50] },
    ],
    origin: 'authored_manifest',
    referenceFaceLabel: 'Top face',
    reviewed: true,
  };
}

function sample(steps: Step[] = [step('B1'), step('B2'), step('B3')]): SceneData {
  return {
    panelModel: model(),
    bends: [bend('B1', 'h-right', 90), bend('B2', 'h-left', -90), bend('B3', 'h-return', 90)],
    steps,
  };
}

function expectMatrixClose(actual: number[], expected: number[], digits = 8) {
  expect(actual).toHaveLength(16);
  actual.forEach((valueAtIndex, index) => expect(valueAtIndex).toBeCloseTo(expected[index], digits));
}

describe('evaluatePose', () => {
  it('returns the identity pose before any operation', () => {
    const poses = evaluatePose(sample(), 0, 0);
    expectMatrixClose(poses.base, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expectMatrixClose(poses.right, poses.base);
  });

  it('moves a panel and its descendants around the parent hinge', () => {
    const poses = evaluatePose(sample([step('B2'), step('B1'), step('B3')]), 1, 0);
    expectMatrixClose(poses.return, poses.left);
    const point = transformPoint(poses.return, [-35, 25, 0]);
    expect(point[2]).toBeLessThan(-24.9);
    expect(point[0]).toBeCloseTo(0, 6);
  });

  it('uses the directed hinge axis and preserves signed fold direction', () => {
    const data = sample([step('B1')]);
    const positive = evaluatePose(data, 0, 1);
    const negative = structuredClone(data);
    negative.bends[0].foldRotationDeg.value = -90;
    const negativePose = evaluatePose(negative, 0, 1);
    expect(transformPoint(positive.right, [120, 25, 0])[2]).toBeLessThan(0);
    expect(transformPoint(negativePose.right, [120, 25, 0])[2]).toBeGreaterThan(0);
  });

  it('changes intermediate poses when the step order changes without changing bend identities', () => {
    const forward = sample([step('B1'), step('B2'), step('B3')]);
    const reversed = sample([step('B2'), step('B1'), step('B3')]);
    const forwardPose = evaluatePose(forward, 1, 0);
    const reversedPose = evaluatePose(reversed, 1, 0);
    expect(forward.steps[0].bendId).toBe('B1');
    expect(reversed.steps[0].bendId).toBe('B2');
    expect(forwardPose.right).not.toEqual(reversedPose.right);
    expect(forwardPose.left).not.toEqual(reversedPose.left);
  });

  it('interpolates the active bend and validates sequence boundaries', () => {
    const data = sample([step('B1')]);
    const flat = evaluatePose(data, 0, 0);
    const half = evaluatePose(data, 0, 0.5);
    const complete = evaluatePose(data, 0, 1);
    const completed = evaluatePose(data, 1, 0);
    expectMatrixClose(complete.right, completed.right);
    expect(transformPoint(half.right, [120, 25, 0])[2]).toBeCloseTo(-20 * Math.sin(Math.PI / 4), 6);
    expect(() => evaluatePose(data, 1, 0.1)).toThrowError(GeometryError);
    expect(() => evaluatePose(data, -1, 0)).toThrowError(GeometryError);
    expect(() => evaluatePose(data, 0, 1.1)).toThrowError(GeometryError);
    expect(flat.right).not.toEqual(complete.right);
  });

  it('rejects a hinge that does not lie on both connected panel edges', () => {
    const invalid = sample([step('B1')]);
    invalid.panelModel.hinges[0].axisStartMm = [99, 0];
    expect(() => evaluatePose(invalid, 0, 0)).toThrowError(
      expect.objectContaining({ code: 'HINGE_NOT_ON_EDGE' }),
    );
  });

  it('uses the shared half-millimetre hinge-edge tolerance', () => {
    const withinTolerance = sample([step('B1')]);
    withinTolerance.panelModel.hinges[0].axisStartMm[0] = 100.4;
    withinTolerance.panelModel.hinges[0].axisEndMm[0] = 100.4;
    expect(() => evaluatePose(withinTolerance, 0, 0)).not.toThrow();

    const outsideTolerance = sample([step('B1')]);
    outsideTolerance.panelModel.hinges[0].axisStartMm[0] = 100.6;
    outsideTolerance.panelModel.hinges[0].axisEndMm[0] = 100.6;
    expect(() => evaluatePose(outsideTolerance, 0, 0)).toThrowError(
      expect.objectContaining({ code: 'HINGE_NOT_ON_EDGE' }),
    );
  });

  it('rejects disconnected or multiply parented panel trees', () => {
    const disconnected = sample([step('B1')]);
    disconnected.panelModel.hinges = disconnected.panelModel.hinges.slice(0, 1);
    expect(() => evaluatePose(disconnected, 0, 0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_HIERARCHY' }),
    );

    const multipleParents = sample([step('B1')]);
    multipleParents.panelModel.hinges.push({
      id: 'h-second-parent',
      parentPanelId: 'left',
      childPanelId: 'right',
      axisStartMm: [0, 0],
      axisEndMm: [0, 50],
    });
    expect(() => evaluatePose(multipleParents, 0, 0)).toThrowError(GeometryError);
  });

  it('does not invent a fold rotation or mapping for an active bend', () => {
    const missingMapping = sample([step('B1')]);
    missingMapping.bends[0].hingeId = null;
    expect(() => evaluatePose(missingMapping, 0, 0)).toThrowError(
      expect.objectContaining({ code: 'MAPPING_REQUIRED' }),
    );

    const missingAngle = sample([step('B1')]);
    missingAngle.bends[0].foldRotationDeg.value = null;
    expect(() => evaluatePose(missingAngle, 0, 0)).toThrowError(
      expect.objectContaining({ code: 'ANGLE_REQUIRED' }),
    );
  });
});
