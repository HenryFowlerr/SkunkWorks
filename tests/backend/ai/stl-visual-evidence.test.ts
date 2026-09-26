// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_STL_VISUAL_BYTES,
  MAX_STL_VISUAL_TRIANGLES,
  MAX_RENDERED_STL_TRIANGLES,
  StlVisualEvidenceError,
  createStlVisualEvidence,
  tryCreateStlVisualEvidence,
} from "@/server/ai/stl-visual-evidence";

type Triangle = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const cube: Triangle[] = [
  [[0, 0, 0], [1, 1, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1]], [[0, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1]], [[0, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1]], [[0, 1, 0], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 1], [0, 1, 0]],
  [[1, 0, 0], [1, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1], [1, 0, 1]],
];

function binaryStl(triangles: Triangle[]): Uint8Array {
  const result = Buffer.alloc(84 + triangles.length * 50);
  result.write("bounded preview", 0, "ascii");
  result.writeUInt32LE(triangles.length, 80);
  for (let index = 0; index < triangles.length; index += 1) {
    let offset = 84 + index * 50 + 12;
    for (const vertex of triangles[index]) {
      result.writeFloatLE(vertex[0], offset);
      result.writeFloatLE(vertex[1], offset + 4);
      result.writeFloatLE(vertex[2], offset + 8);
      offset += 12;
    }
  }
  return result;
}

function asciiTriangle(): Uint8Array {
  return Buffer.from(`solid preview
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid preview
`);
}

describe("bounded STL visual evidence", () => {
  it("creates a deterministic compact PNG montage with only visual-only provenance", () => {
    const source = binaryStl(cube);
    const first = createStlVisualEvidence(source);
    const second = createStlVisualEvidence(source);
    const png = Buffer.from(first.imageDataUrl.slice("data:image/png;base64,".length), "base64");

    expect(first).toEqual(second);
    expect(Object.keys(first)).toEqual(["mimeType", "imageDataUrl", "detail", "label"]);
    expect(first).toMatchObject({
      mimeType: "image/png",
      detail: "low",
      label: expect.stringMatching(/no declared units, scale, dimensions, tolerances, material, process, or approval state/i),
    });
    expect(first.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(first.imageDataUrl).not.toContain(Buffer.from(source).toString("base64"));
  });

  it("accepts a well-formed ASCII STL without exposing text, coordinates, or raw bytes", () => {
    const evidence = createStlVisualEvidence(asciiTriangle());
    expect(evidence.mimeType).toBe("image/png");
    expect(evidence.imageDataUrl).not.toContain("facet normal");
    expect(evidence.imageDataUrl).not.toContain("vertex");
  });

  it("fails closed for malformed, degenerate, over-budget, and over-complex source meshes", () => {
    const truncated = new Uint8Array(84);
    truncated[80] = 1;
    const degenerate = binaryStl([[[0, 0, 0], [1, 0, 0], [2, 0, 0]]]);
    const tooLarge = new Uint8Array(MAX_STL_VISUAL_BYTES + 1);
    const tooComplex = new Uint8Array(84 + (MAX_STL_VISUAL_TRIANGLES + 1) * 50);
    new DataView(tooComplex.buffer).setUint32(80, MAX_STL_VISUAL_TRIANGLES + 1, true);

    expect(() => createStlVisualEvidence(truncated)).toThrow(StlVisualEvidenceError);
    expect(() => createStlVisualEvidence(degenerate)).toThrow(/no visible triangle area/i);
    expect(() => createStlVisualEvidence(tooLarge)).toThrow(/too large/i);
    expect(() => createStlVisualEvidence(tooComplex)).toThrow(/triangle limit/i);
    expect(tryCreateStlVisualEvidence(truncated)).toBeNull();
    expect(tryCreateStlVisualEvidence(tooLarge)).toBeNull();
  });

  it("rejects an ASCII mesh with unbounded coordinates or incomplete facets", () => {
    const unbounded = Buffer.from(`solid preview
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1000000001 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid preview
`);
    const incomplete = Buffer.from("solid preview\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendsolid preview\n".padEnd(84, " "));

    expect(() => createStlVisualEvidence(unbounded)).toThrow(/unsupported vertex coordinate/i);
    expect(() => createStlVisualEvidence(incomplete)).toThrow(/incomplete facets/i);
  });

  it("keeps preview raster work bounded even when a valid mesh has more faces than the renderer uses", () => {
    const source = binaryStl(Array.from({ length: MAX_RENDERED_STL_TRIANGLES + 1 }, () => cube[0]));
    expect(createStlVisualEvidence(source).imageDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
