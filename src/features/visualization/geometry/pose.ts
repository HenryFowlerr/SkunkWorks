import type { Bend, Hinge, Panel, PanelModel, Step, Vec2 } from '@/contracts';
import type { SceneData } from '../components/signatures';

const MATRIX_SIZE = 16;
const EPSILON = 1e-9;
export const HINGE_EDGE_TOLERANCE_MM = 0.5;

export class GeometryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
  }
}

const fail = (code: string, message: string): never => {
  throw new GeometryError(code, message);
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('INVALID_IDENTIFIER', label + ' must be a non-empty string');
  }
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function segmentContainsBoth(axisStart: Vec2, axisEnd: Vec2, edgeStart: Vec2, edgeEnd: Vec2): boolean {
  return distanceToSegment(axisStart, edgeStart, edgeEnd) <= HINGE_EDGE_TOLERANCE_MM
    && distanceToSegment(axisEnd, edgeStart, edgeEnd) <= HINGE_EDGE_TOLERANCE_MM;
}

function liesAlongBoundary(axisStart: Vec2, axisEnd: Vec2, panel: Panel): boolean {
  const polygon = panel.polygonMm;
  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentContainsBoth(axisStart, axisEnd, polygon[index], polygon[(index + 1) % polygon.length])) {
      return true;
    }
  }
  return false;
}

function signedArea(polygon: Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
    && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
    return true;
  }
  const on = (p: Vec2, q: Vec2, r: Vec2) => Math.abs(orientation(p, q, r)) <= EPSILON
    && r[0] >= Math.min(p[0], q[0]) - EPSILON && r[0] <= Math.max(p[0], q[0]) + EPSILON
    && r[1] >= Math.min(p[1], q[1]) - EPSILON && r[1] <= Math.max(p[1], q[1]) + EPSILON;
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

function hasSelfIntersection(polygon: Vec2[]): boolean {
  const edgeCount = polygon.length;
  for (let first = 0; first < edgeCount; first += 1) {
    const firstNext = (first + 1) % edgeCount;
    for (let second = first + 1; second < edgeCount; second += 1) {
      const secondNext = (second + 1) % edgeCount;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) return true;
    }
  }
  return false;
}

/**
 * Validates the authored planar-panel tree and all step-to-bend-to-hinge links.
 * Hinge edges are expected to lie on a polygon boundary within 0.5 mm.
 */
export function validateSceneData(data: SceneData): void {
  const model: PanelModel = data.panelModel;
  if (!model || model.schemaVersion !== '1.0' || model.units !== 'mm') {
    fail('UNSUPPORTED_MANIFEST', 'The bend diagram requires a schema 1.0 millimetre panel model');
  }
  if (!isFiniteNumber(model.thicknessMm) || model.thicknessMm <= 0) {
    fail('INVALID_THICKNESS', 'Panel thickness must be a finite positive millimetre value');
  }
  assertIdentifier(model.rootPanelId, 'Root panel id');
  const panelsById = new Map<string, Panel>();
  for (const panel of model.panels) {
    assertIdentifier(panel.id, 'Panel id');
    if (panelsById.has(panel.id)) fail('DUPLICATE_PANEL', 'Panel id ' + panel.id + ' is duplicated');
    if (!Array.isArray(panel.polygonMm) || panel.polygonMm.length < 3) {
      fail('INVALID_POLYGON', 'Panel ' + panel.id + ' needs at least three polygon points');
    }
    for (const point of panel.polygonMm) {
      if (!Array.isArray(point) || point.length !== 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
        fail('INVALID_COORDINATE', 'Panel ' + panel.id + ' contains a non-finite or malformed coordinate');
      }
    }
    for (let index = 0; index < panel.polygonMm.length; index += 1) {
      const point = panel.polygonMm[index];
      const next = panel.polygonMm[(index + 1) % panel.polygonMm.length];
      if (Math.hypot(point[0] - next[0], point[1] - next[1]) <= EPSILON) {
        fail('DEGENERATE_POLYGON', 'Panel ' + panel.id + ' contains a zero-length polygon edge');
      }
    }
    if (Math.abs(signedArea(panel.polygonMm)) <= EPSILON) {
      fail('DEGENERATE_POLYGON', 'Panel ' + panel.id + ' has zero area');
    }
    if (hasSelfIntersection(panel.polygonMm)) {
      fail('SELF_INTERSECTING_POLYGON', 'Panel ' + panel.id + ' polygon must not self-intersect');
    }
    panelsById.set(panel.id, panel);
  }
  if (panelsById.size === 0 || !panelsById.has(model.rootPanelId)) {
    fail('MISSING_ROOT', 'The root panel must exist in the panel list');
  }

  const hingesById = new Map<string, Hinge>();
  const childHingeByPanel = new Map<string, Hinge>();
  for (const hinge of model.hinges) {
    assertIdentifier(hinge.id, 'Hinge id');
    if (hingesById.has(hinge.id)) fail('DUPLICATE_HINGE', 'Hinge id ' + hinge.id + ' is duplicated');
    if (!panelsById.has(hinge.parentPanelId) || !panelsById.has(hinge.childPanelId)) {
      fail('UNKNOWN_PANEL', 'Hinge ' + hinge.id + ' references an unknown panel');
    }
    if (hinge.parentPanelId === hinge.childPanelId || hinge.childPanelId === model.rootPanelId) {
      fail('INVALID_HIERARCHY', 'Hinge ' + hinge.id + ' does not connect a parent to a distinct non-root child');
    }
    const [sx, sy] = hinge.axisStartMm;
    const [ex, ey] = hinge.axisEndMm;
    if (![sx, sy, ex, ey].every(isFiniteNumber)) {
      fail('INVALID_COORDINATE', 'Hinge ' + hinge.id + ' contains a non-finite coordinate');
    }
    if (Math.hypot(ex - sx, ey - sy) <= EPSILON) {
      fail('DEGENERATE_HINGE', 'Hinge ' + hinge.id + ' has a zero-length axis');
    }
    const parent = panelsById.get(hinge.parentPanelId)!;
    const child = panelsById.get(hinge.childPanelId)!;
    if (!liesAlongBoundary(hinge.axisStartMm, hinge.axisEndMm, parent)
      || !liesAlongBoundary(hinge.axisStartMm, hinge.axisEndMm, child)) {
      fail('HINGE_NOT_ON_EDGE', 'Hinge ' + hinge.id + ' must lie on a boundary edge of both connected panels (tolerance 0.5 mm)');
    }
    if (childHingeByPanel.has(hinge.childPanelId)) {
      fail('MULTIPLE_PARENTS', 'Panel ' + hinge.childPanelId + ' has more than one parent hinge');
    }
    hingesById.set(hinge.id, hinge);
    childHingeByPanel.set(hinge.childPanelId, hinge);
  }

  if (childHingeByPanel.size !== panelsById.size - 1) {
    fail('INVALID_HIERARCHY', 'Every non-root panel must have exactly one parent hinge');
  }
  const visited = new Set<string>();
  const visit = (panelId: string, ancestors: Set<string>) => {
    if (ancestors.has(panelId)) fail('CYCLE', 'The panel hierarchy contains a cycle at ' + panelId);
    if (visited.has(panelId)) return;
    visited.add(panelId);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(panelId);
    for (const hinge of model.hinges) {
      if (hinge.parentPanelId === panelId) visit(hinge.childPanelId, nextAncestors);
    }
  };
  visit(model.rootPanelId, new Set());
  if (visited.size !== panelsById.size) {
    fail('DISCONNECTED_PANEL', 'Every panel must be connected to the root panel');
  }

  const bendsById = new Map<string, Bend>();
  const bendByHinge = new Map<string, Bend>();
  for (const bend of data.bends) {
    assertIdentifier(bend.bendId, 'Bend id');
    if (bendsById.has(bend.bendId)) fail('DUPLICATE_BEND', 'Bend id ' + bend.bendId + ' is duplicated');
    if (bend.hingeId !== null) {
      if (!hingesById.has(bend.hingeId)) fail('UNKNOWN_HINGE', 'Bend ' + bend.bendId + ' references an unknown hinge');
      if (bendByHinge.has(bend.hingeId)) fail('DUPLICATE_BEND_MAPPING', 'More than one bend is mapped to hinge ' + bend.hingeId);
      bendByHinge.set(bend.hingeId, bend);
    }
    bendsById.set(bend.bendId, bend);
  }

  const stepIds = new Set<string>();
  const stepBends = new Set<string>();
  for (const step of data.steps) {
    assertIdentifier(step.id, 'Step id');
    assertIdentifier(step.bendId, 'Step bend id');
    if (stepIds.has(step.id)) fail('DUPLICATE_STEP', 'Step id ' + step.id + ' is duplicated');
    if (stepBends.has(step.bendId)) fail('DUPLICATE_STEP_BEND', 'Bend ' + step.bendId + ' appears in more than one step');
    stepIds.add(step.id);
    stepBends.add(step.bendId);
    const bend = bendsById.get(step.bendId);
    if (bend === undefined) {
      throw new GeometryError('UNKNOWN_BEND', 'Step ' + step.id + ' references unknown bend ' + step.bendId);
    }
    if (!bend.hingeId) fail('MAPPING_REQUIRED', 'Bend ' + bend.bendId + ' must be mapped to a hinge before it can be shown');
    if (bend.foldRotationDeg.value === null || !isFiniteNumber(bend.foldRotationDeg.value)) {
      fail('ANGLE_REQUIRED', 'Bend ' + bend.bendId + ' needs a supported signed fold rotation');
    }
  }
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: number[], b: number[]): number[] {
  const result = Array(MATRIX_SIZE).fill(0) as number[];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
      }
    }
  }
  return result;
}

function rotationAboutHinge(hinge: Hinge, radians: number): number[] {
  if (Math.abs(radians) <= EPSILON) return identity();
  const dx = hinge.axisEndMm[0] - hinge.axisStartMm[0];
  const dy = hinge.axisEndMm[1] - hinge.axisStartMm[1];
  const length = Math.hypot(dx, dy);
  const x = dx / length;
  const y = dy / length;
  const z = 0;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const oneMinusCosine = 1 - cosine;
  const r00 = cosine + x * x * oneMinusCosine;
  const r01 = x * y * oneMinusCosine - z * sine;
  const r02 = x * z * oneMinusCosine + y * sine;
  const r10 = y * x * oneMinusCosine + z * sine;
  const r11 = cosine + y * y * oneMinusCosine;
  const r12 = y * z * oneMinusCosine - x * sine;
  const r20 = z * x * oneMinusCosine - y * sine;
  const r21 = z * y * oneMinusCosine + x * sine;
  const r22 = cosine + z * z * oneMinusCosine;
  const startX = hinge.axisStartMm[0];
  const startY = hinge.axisStartMm[1];
  const rotatedStartX = r00 * startX + r01 * startY;
  const rotatedStartY = r10 * startX + r11 * startY;
  const rotatedStartZ = r20 * startX + r21 * startY;
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    startX - rotatedStartX, startY - rotatedStartY, -rotatedStartZ, 1,
  ];
}

/**
 * Returns column-major 4x4 panel transforms in millimetres.
 *
 * Positive rotations use the right-hand rule about each hinge's directed
 * axisStartMm -> axisEndMm vector. A step array defines operation order:
 * earlier steps are fully folded, the next step is interpolated by progress,
 * and later steps stay flat.
 */
export function evaluatePose(
  data: SceneData,
  completedStepCount: number,
  activeStepProgress: number,
): Record<string, number[]> {
  validateSceneData(data);
  if (!Number.isInteger(completedStepCount) || completedStepCount < 0 || completedStepCount > data.steps.length) {
    fail('INVALID_PROGRESS', 'completedStepCount must be an integer from zero through the number of steps');
  }
  if (!isFiniteNumber(activeStepProgress) || activeStepProgress < 0 || activeStepProgress > 1) {
    fail('INVALID_PROGRESS', 'activeStepProgress must be between zero and one');
  }
  if (completedStepCount === data.steps.length && activeStepProgress !== 0) {
    fail('INVALID_PROGRESS', 'activeStepProgress must be zero when all steps are complete');
  }

  const angleByHinge = new Map<string, number>();
  const bendById = new Map(data.bends.map((bend) => [bend.bendId, bend]));
  for (let index = 0; index < data.steps.length; index += 1) {
    const step: Step = data.steps[index];
    const bend = bendById.get(step.bendId)!;
    const amount = index < completedStepCount ? 1 : index === completedStepCount ? activeStepProgress : 0;
    if (bend.hingeId) angleByHinge.set(bend.hingeId, (bend.foldRotationDeg.value as number) * amount * Math.PI / 180);
  }

  const model = data.panelModel;
  const hingesByParent = new Map<string, Hinge[]>();
  for (const hinge of model.hinges) {
    const siblings = hingesByParent.get(hinge.parentPanelId) ?? [];
    siblings.push(hinge);
    hingesByParent.set(hinge.parentPanelId, siblings);
  }

  const transforms: Record<string, number[]> = {};
  const traverse = (panelId: string, parentTransform: number[]) => {
    transforms[panelId] = parentTransform;
    for (const hinge of hingesByParent.get(panelId) ?? []) {
      const relative = rotationAboutHinge(hinge, angleByHinge.get(hinge.id) ?? 0);
      traverse(hinge.childPanelId, multiply(parentTransform, relative));
    }
  };
  traverse(model.rootPanelId, identity());
  return transforms;
}

/** Transforms an XYZ point by a column-major pose matrix; exported for tests and the renderer. */
export function transformPoint(matrix: number[], point: [number, number, number]): [number, number, number] {
  if (matrix.length !== MATRIX_SIZE) fail('INVALID_MATRIX', 'A panel pose must contain 16 values');
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}
