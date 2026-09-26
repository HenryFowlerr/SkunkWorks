import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assembleReleaseQuestionInput } from "../../../src/server/api/question-context";
import { ids, openFlag, release, releaseContext, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const bytes = new Uint8Array(await readFile(resolve(process.cwd(), "public/demo/sensor-mount-alpha.drawing.pdf")));
const drawing = {
  ...sourceAsset,
  byteSize: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const request = { context: releaseContext, question: "What does this bend require?" };

describe("published question context", () => {
  it("uses only the immutable release source and approved step with confirmed machine notes", async () => {
    const readSource = vi.fn(async () => bytes);
    const input = await assembleReleaseQuestionInput({
      request,
      release,
      assets: [drawing, { ...drawing, id: ids.generation }],
      workshop: workshopSnapshot,
      readSource,
    });
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(readSource).toHaveBeenCalledWith(drawing);
    expect(input.pdfs.map((pdf) => pdf.assetId)).toEqual([drawing.id]);
    expect(input.sources.some((source) => source.kind === "document")).toBe(true);
    expect(input.sources.some((source) => source.kind === "workshop_note" && source.machineId === ids.machine)).toBe(true);
    expect(input.approvedContext).toEqual({
      releaseId: ids.release,
      revisionNumber: 1,
      machineId: ids.machine,
      selectedStep: {
        id: ids.step,
        bendId: "B1",
        instruction: release.snapshot.steps[0].instruction,
        guidanceDecision: "include",
      },
    });
  });

  it("rejects a step that is not in the requested release before reading storage", async () => {
    const readSource = vi.fn(async () => bytes);
    await expect(assembleReleaseQuestionInput({
      request: { ...request, context: { ...releaseContext, stepId: ids.generation } },
      release, assets: [drawing], workshop: workshopSnapshot, readSource,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(readSource).not.toHaveBeenCalled();
  });

  it("rejects unavailable or changed approved source bytes", async () => {
    await expect(assembleReleaseQuestionInput({
      request, release, assets: [], workshop: workshopSnapshot, readSource: async () => bytes,
    })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(assembleReleaseQuestionInput({
      request, release, assets: [drawing], workshop: workshopSnapshot,
      readSource: async () => new Uint8Array(bytes.byteLength),
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("rejects a draft or mismatched release context", async () => {
    const common = { release, assets: [drawing], workshop: workshopSnapshot, readSource: async () => bytes };
    await expect(assembleReleaseQuestionInput({
      ...common,
      request: { ...request, context: { ...releaseContext, releaseId: null, draftId: ids.draft, draftVersion: 1 } },
    })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(assembleReleaseQuestionInput({
      ...common,
      request: { ...request, context: { ...releaseContext, releaseId: ids.generation } },
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds only an engineer response for this release and operation to the knowledge packet", async () => {
    const approved = {
      ...openFlag,
      status: "responded" as const,
      version: 2,
      response: {
        text: "For B1, use the orientation marked on drawing A.",
        authorId: ids.member,
        at: "2026-09-26T01:00:00.000Z",
        kind: "explanation" as const,
        replacementReleaseId: null,
      },
    };
    const input = await assembleReleaseQuestionInput({
      request, release, assets: [drawing], workshop: workshopSnapshot,
      flags: [openFlag, approved, { ...approved, id: ids.review, context: { ...releaseContext, bendId: "B2" } }],
      readSource: async () => bytes,
    });
    expect(input.approvedClarifications).toEqual([{ recordId: ids.flag, text: approved.response.text }]);
    expect(input.sources.filter((source) => source.kind === "human_clarification"))
      .toEqual([{ kind: "human_clarification", recordId: ids.flag, text: approved.response.text }]);
  });
});
