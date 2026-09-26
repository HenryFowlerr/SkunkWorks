import { expect, test } from "@playwright/test";

import { ids, releaseContext, releaseView, sourceAsset } from "../contracts/fixtures";

const meta = { requestId: "operator-floor-e2e", contractVersion: "1.0" as const };

function success(data: unknown) {
  return { data, meta };
}

function triangleGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const totalLength = 12 + 8 + jsonChunk.length + 8 + positions.length;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryOffset = 20 + jsonChunk.length;
  output.writeUInt32LE(positions.length, binaryOffset);
  output.writeUInt32LE(0x004e4942, binaryOffset + 4);
  positions.copy(output, binaryOffset + 8);
  return output;
}

test("the operator guide joins an authorised model with release-bound quick assist", async ({ page }) => {
  const view = structuredClone(releaseView);
  const modelId = ids.proposal;
  view.job.sourceAssetIds = [...view.job.sourceAssetIds, modelId];
  view.release.snapshot.sourceAssetIds = [...view.release.snapshot.sourceAssetIds, modelId];
  view.sourceAssets = [
    ...view.sourceAssets,
    {
      ...sourceAsset,
      id: modelId,
      kind: "model_glb",
      filename: "engineering-test-block.glb",
      mimeType: "model/gltf-binary",
      byteSize: 512,
      sha256: "b".repeat(64),
    },
  ];
  const answer = {
    id: ids.review,
    context: releaseContext,
    evidenceState: "supported",
    text: "The released drawing identifies the outside face as the reference side.",
    evidence: [],
    suggestedFlag: null,
  };
  let askedBody: unknown = null;

  await page.route(`**/api/releases/${ids.release}`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(success(view)) }));
  await page.route(`**/api/assets/${modelId}/link`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(success({ url: "http://127.0.0.1:3000/e2e-model.glb", expiresAt: "2026-10-01T00:00:00.000Z" })),
  }));
  await page.route("**/e2e-model.glb", (route) => route.fulfill({ contentType: "model/gltf-binary", body: triangleGlb() }));
  await page.route("**/api/questions", (route) => {
    askedBody = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(success(answer)) });
  });
  await page.route("**/api/flags?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(success([])) }));

  await page.goto(`/floor/${ids.release}`);

  await expect(page.getByRole("heading", { name: "engineering-test-block.glb" })).toBeVisible();
  await expect(page.getByLabel("Interactive supplied visual model. Drag to orbit; use the camera buttons to change view.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quick assist" })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth! + 1);

  await page.getByLabel("Ask Chappe about this operation").fill("Which face is the reference side?");
  await page.getByRole("button", { name: "Ask Chappe" }).click();
  await expect(page.getByText(answer.text)).toBeVisible();
  expect(askedBody).toEqual({ context: releaseContext, question: "Which face is the reference side?" });

  await page.getByRole("button", { name: "Flag this answer" }).click();
  await expect(page.getByRole("tab", { name: "Flags" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("What needs the designer's attention?")).toHaveValue("Which face is the reference side?");
});
