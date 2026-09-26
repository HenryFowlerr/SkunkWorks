import { describe, expect, it } from "vitest";
import { floorAssistantModel, initialAnalysisModel } from "@/server/ai/model-routing";

describe("AI model routing", () => {
  it("uses the dedicated Astra setting only for initial pitch analysis", () => {
    expect(initialAnalysisModel({
      OPENAI_INITIAL_MODEL: "gpt-6-astra",
      OPENAI_FLOOR_MODEL: "gpt-6-luna",
    })).toBe("gpt-6-astra");
  });

  it("uses the dedicated Luna setting for floor-facing work", () => {
    expect(floorAssistantModel({
      OPENAI_INITIAL_MODEL: "gpt-6-astra",
      OPENAI_FLOOR_MODEL: "gpt-6-luna",
    })).toBe("gpt-6-luna");
  });

  it("accepts the legacy model setting only for initial analysis", () => {
    expect(initialAnalysisModel({ OPENAI_MODEL: "legacy-initial-model" })).toBe("legacy-initial-model");
    expect(() => floorAssistantModel({ OPENAI_MODEL: "gpt-6-astra" })).toThrow();
  });
});
