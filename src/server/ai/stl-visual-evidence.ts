import "server-only";

import { crc32, deflateSync } from "node:zlib";

/**
 * This is deliberately much smaller than the accepted upload size. The model
 * receives a compact raster preview, never the supplied mesh bytes.
 */
export const MAX_STL_VISUAL_BYTES = 5 * 1024 * 1024;
export const MAX_STL_VISUAL_TRIANGLES = 80_000;
/** Parsed meshes can be larger, but only this evenly sampled subset is rasterized. */
export const MAX_RENDERED_STL_TRIANGLES = 4_000;
/** Rectangle work is charged before rasterizing so a hostile mesh cannot monopolize a request. */
export const MAX_RASTER_PIXELS_PER_VIEW = 1_000_000;

const IMAGE_SIZE = 512;
const PANEL_SIZE = 240;
const PANEL_GAP = 8;
const PANEL_MARGIN = 10;
const MAX_COORDINATE_MAGNITUDE = 1_000_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const VISUAL_ONLY_LABEL = "Deterministic visual reference derived from the supplied STL. It has no declared units, scale, dimensions, tolerances, material, process, or approval state.";

export type StlVisualEvidence = {
  mimeType: "image/png";
  /** Base64 PNG suitable for a Responses API input_image data URL. */
  imageDataUrl: string;
  /** Kept low because this compact silhouette montage is only orientation context. */
  detail: "low";
  /** Must accompany the image in the model instruction; it is never a citation source. */
  label: typeof VISUAL_ONLY_LABEL;
};

export type StlVisualEvidenceErrorCode =
  | "STL_TOO_LARGE"
  | "STL_TOO_COMPLEX"
  | "INVALID_STL"
  | "NO_VISIBLE_GEOMETRY";

export class StlVisualEvidenceError extends Error {
  constructor(readonly code: StlVisualEvidenceErrorCode, message: string) {
    super(message);
    this.name = "StlVisualEvidenceError";
  }
}

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

type Mesh = { positions: Float64Array; bounds: Bounds };
type Vector = readonly [number, number, number];
type View = { right: Vector; up: Vector; forward: Vector };
type Tile = { x: number; y: number };
type ProjectedPoint = { x: number; y: number; depth: number };

const VIEWS: readonly View[] = [
  { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] },
  { right: [0, 0, 1], up: [0, 1, 0], forward: [1, 0, 0] },
  { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] },
  {
    right: [Math.SQRT1_2, -Math.SQRT1_2, 0],
    up: [0.4082482904638631, 0.4082482904638631, -0.8164965809277261],
    forward: [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
  },
];

const TILES: readonly Tile[] = [
  { x: PANEL_GAP, y: PANEL_GAP },
  { x: PANEL_GAP * 2 + PANEL_SIZE, y: PANEL_GAP },
  { x: PANEL_GAP, y: PANEL_GAP * 2 + PANEL_SIZE },
  { x: PANEL_GAP * 2 + PANEL_SIZE, y: PANEL_GAP * 2 + PANEL_SIZE },
];

/**
 * Creates four neutral, unlabelled orthographic/oblique views for vision
 * context. There are intentionally no axes, scales, dimensions or extracted
 * geometric claims in either the PNG or return value.
 *
 * Call this only after the uploaded STL's stored hash has been verified. It is
 * optional context: a failure should leave the PDF-only pitch assessment able
 * to continue.
 */
export function createStlVisualEvidence(bytes: Uint8Array): StlVisualEvidence {
  if (!(bytes instanceof Uint8Array)) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied model bytes are invalid.");
  }
  if (bytes.byteLength < 84) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied STL is too short.");
  }
  if (bytes.byteLength > MAX_STL_VISUAL_BYTES) {
    throw new StlVisualEvidenceError("STL_TOO_LARGE", "The supplied STL is too large for a bounded visual preview.");
  }

  const mesh = parseStl(bytes);
  const image = renderPreview(mesh);
  return {
    mimeType: "image/png",
    imageDataUrl: `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
    detail: "low",
    label: VISUAL_ONLY_LABEL,
  };
}

/** Returns null for a malformed or over-budget optional visual source. */
export function tryCreateStlVisualEvidence(bytes: Uint8Array): StlVisualEvidence | null {
  try {
    return createStlVisualEvidence(bytes);
  } catch (error) {
    if (error instanceof StlVisualEvidenceError) return null;
    throw error;
  }
}

function parseStl(bytes: Uint8Array): Mesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  const binarySize = 84 + triangleCount * 50;
  if (Number.isSafeInteger(binarySize) && binarySize === bytes.byteLength) {
    if (triangleCount === 0) {
      throw new StlVisualEvidenceError("NO_VISIBLE_GEOMETRY", "The supplied STL has no triangles.");
    }
    if (triangleCount > MAX_STL_VISUAL_TRIANGLES) {
      throw new StlVisualEvidenceError("STL_TOO_COMPLEX", "The supplied STL exceeds the visual-preview triangle limit.");
    }
    return validateMesh(readBinaryTriangles(view, triangleCount));
  }
  return validateMesh(readAsciiTriangles(bytes));
}

function readBinaryTriangles(view: DataView, triangleCount: number): Float64Array {
  const positions = new Float64Array(triangleCount * 9);
  let write = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let offset = 84 + triangle * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      positions[write++] = readCoordinate(view.getFloat32(offset, true));
      positions[write++] = readCoordinate(view.getFloat32(offset + 4, true));
      positions[write++] = readCoordinate(view.getFloat32(offset + 8, true));
      offset += 12;
    }
  }
  return positions;
}

function readAsciiTriangles(bytes: Uint8Array): Float64Array {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied model is neither a valid binary nor ASCII STL.");
  }
  if (!/^\s*solid(?:\s|$)/i.test(source) || !/^\s*endsolid(?:\s|$)/im.test(source)) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied model is not a valid ASCII STL.");
  }

  const values: number[] = [];
  let facetCount = 0;
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (/^\s*facet\s+normal(?:\s|$)/i.test(line)) facetCount += 1;
    const match = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i.exec(line);
    if (!match) continue;
    if (values.length / 9 >= MAX_STL_VISUAL_TRIANGLES) {
      throw new StlVisualEvidenceError("STL_TOO_COMPLEX", "The supplied STL exceeds the visual-preview triangle limit.");
    }
    values.push(readAsciiCoordinate(match[1]), readAsciiCoordinate(match[2]), readAsciiCoordinate(match[3]));
  }
  if (values.length === 0 || values.length % 9 !== 0 || facetCount !== values.length / 9) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied ASCII STL has incomplete facets.");
  }
  return Float64Array.from(values);
}

function readAsciiCoordinate(raw: string): number {
  if (!/^[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[-+]?\d+)?$/i.test(raw)) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied STL has an invalid vertex coordinate.");
  }
  return readCoordinate(Number(raw));
}

function readCoordinate(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE_MAGNITUDE) {
    throw new StlVisualEvidenceError("INVALID_STL", "The supplied STL has an unsupported vertex coordinate.");
  }
  return value;
}

function validateMesh(positions: Float64Array): Mesh {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const bounds = { minX, maxX, minY, maxY, minZ, maxZ };
  const span = longestSpan(bounds);
  if (!Number.isFinite(span) || span <= Number.EPSILON) {
    throw new StlVisualEvidenceError("NO_VISIBLE_GEOMETRY", "The supplied STL has no visible extent.");
  }
  if (!hasVisibleTriangle(positions, span)) {
    throw new StlVisualEvidenceError("NO_VISIBLE_GEOMETRY", "The supplied STL has no visible triangle area.");
  }
  return { positions, bounds };
}

function hasVisibleTriangle(positions: Float64Array, span: number): boolean {
  const threshold = span ** 4 * 1e-18;
  for (let index = 0; index < positions.length; index += 9) {
    const abx = positions[index + 3] - positions[index];
    const aby = positions[index + 4] - positions[index + 1];
    const abz = positions[index + 5] - positions[index + 2];
    const acx = positions[index + 6] - positions[index];
    const acy = positions[index + 7] - positions[index + 1];
    const acz = positions[index + 8] - positions[index + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ > threshold) return true;
  }
  return false;
}

function renderPreview(mesh: Mesh): Uint8Array {
  const rgba = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE * 4);
  const depth = new Float32Array(IMAGE_SIZE * IMAGE_SIZE);
  depth.fill(-Infinity);
  fill(rgba, [247, 247, 243, 255]);
  for (const tile of TILES) drawPanel(rgba, tile);

  const light: Vector = normalize([0.31, 0.57, 0.76]);
  const triangleCount = mesh.positions.length / 9;
  const renderedTriangles = Math.min(triangleCount, MAX_RENDERED_STL_TRIANGLES);
  for (let viewIndex = 0; viewIndex < VIEWS.length; viewIndex += 1) {
    const view = VIEWS[viewIndex];
    const tile = TILES[viewIndex];
    const budget = { remaining: MAX_RASTER_PIXELS_PER_VIEW };
    for (let sample = 0; sample < renderedTriangles; sample += 1) {
      const triangleIndex = Math.floor(sample * triangleCount / renderedTriangles);
      drawTriangle(rgba, depth, mesh.positions, triangleIndex * 9, mesh.bounds, view, tile, light, budget);
    }
  }
  return encodePng(rgba, IMAGE_SIZE, IMAGE_SIZE);
}

function drawPanel(rgba: Uint8Array, tile: Tile): void {
  for (let y = tile.y; y < tile.y + PANEL_SIZE; y += 1) {
    for (let x = tile.x; x < tile.x + PANEL_SIZE; x += 1) {
      const border = x === tile.x || y === tile.y || x === tile.x + PANEL_SIZE - 1 || y === tile.y + PANEL_SIZE - 1;
      setPixel(rgba, x, y, border ? [205, 214, 218, 255] : [236, 240, 242, 255]);
    }
  }
}

function drawTriangle(
  rgba: Uint8Array,
  depthBuffer: Float32Array,
  positions: Float64Array,
  index: number,
  bounds: Bounds,
  view: View,
  tile: Tile,
  light: Vector,
  budget: { remaining: number },
): void {
  const a = project(positions[index], positions[index + 1], positions[index + 2], bounds, view, tile);
  const b = project(positions[index + 3], positions[index + 4], positions[index + 5], bounds, view, tile);
  const c = project(positions[index + 6], positions[index + 7], positions[index + 8], bounds, view, tile);
  const area = edge(a, b, c.x, c.y);
  if (Math.abs(area) < 1e-9) return;

  const minX = Math.max(tile.x + PANEL_MARGIN, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(tile.x + PANEL_SIZE - PANEL_MARGIN - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(tile.y + PANEL_MARGIN, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(tile.y + PANEL_SIZE - PANEL_MARGIN - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  if (minX > maxX || minY > maxY) return;
  const rasterWork = (maxX - minX + 1) * (maxY - minY + 1);
  if (rasterWork > budget.remaining) return;
  budget.remaining -= rasterWork;

  const shade = triangleShade(positions, index, light);
  const color: readonly [number, number, number, number] = [
    Math.round(50 + 61 * shade),
    Math.round(88 + 74 * shade),
    Math.round(108 + 77 * shade),
    255,
  ];
  const positive = area > 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const first = edge(b, c, px, py);
      const second = edge(c, a, px, py);
      const third = edge(a, b, px, py);
      if (positive ? (first < 0 || second < 0 || third < 0) : (first > 0 || second > 0 || third > 0)) continue;
      const weightA = first / area;
      const weightB = second / area;
      const weightC = third / area;
      const pointDepth = weightA * a.depth + weightB * b.depth + weightC * c.depth;
      const offset = y * IMAGE_SIZE + x;
      if (pointDepth <= depthBuffer[offset]) continue;
      depthBuffer[offset] = pointDepth;
      setPixel(rgba, x, y, color);
    }
  }
}

function project(x: number, y: number, z: number, bounds: Bounds, view: View, tile: Tile): ProjectedPoint {
  const span = longestSpan(bounds);
  const center: Vector = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  const point: Vector = [(x - center[0]) / span, (y - center[1]) / span, (z - center[2]) / span];
  const drawableSize = PANEL_SIZE - PANEL_MARGIN * 2;
  return {
    x: tile.x + PANEL_SIZE / 2 + dot(point, view.right) * drawableSize,
    y: tile.y + PANEL_SIZE / 2 - dot(point, view.up) * drawableSize,
    depth: dot(point, view.forward),
  };
}

function triangleShade(positions: Float64Array, index: number, light: Vector): number {
  const ab: Vector = [
    positions[index + 3] - positions[index],
    positions[index + 4] - positions[index + 1],
    positions[index + 5] - positions[index + 2],
  ];
  const ac: Vector = [
    positions[index + 6] - positions[index],
    positions[index + 7] - positions[index + 1],
    positions[index + 8] - positions[index + 2],
  ];
  const normal = cross(ab, ac);
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length <= Number.EPSILON) return 0.2;
  return 0.28 + 0.72 * Math.abs(dot(normal, light) / length);
}

function edge(a: ProjectedPoint, b: ProjectedPoint, x: number, y: number): number {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
}

function longestSpan(bounds: Bounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
}

function dot(left: Vector, right: Vector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector, right: Vector): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector: Vector): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function fill(rgba: Uint8Array, color: readonly [number, number, number, number]): void {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
  }
}

function setPixel(rgba: Uint8Array, x: number, y: number, color: readonly [number, number, number, number]): void {
  const offset = (y * IMAGE_SIZE + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const scanlines = Buffer.allocUnsafe((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const destination = row * (width * 4 + 1);
    scanlines[destination] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(scanlines, destination + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: "IHDR" | "IDAT" | "IEND", payload: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, payload.length + 8)), payload.length + 8);
  return chunk;
}
