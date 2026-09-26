import { describe, expect, it } from "vitest";
import type { FacilityRequirement, WorkshopSnapshot } from "@/contracts";
import { checkFacilityRequirements } from "@/server/domain/facility-check";
import { ids, job, workshopSnapshot } from "../../contracts/fixtures";

const source = { assetId: ids.asset, page: 2, excerpt: "Maximum bend length 1200 mm" };
const requirementId = "00000000-0000-4000-8000-000000000018";

function length(requiredMm: number): FacilityRequirement {
  return { id: requirementId, kind: "bend_length", label: "B3", source, requiredMm };
}

describe("facility evidence comparison", () => {
  it("shows a conflict when the stated length exceeds a supported, confirmed profile value", () => {
    const result = checkFacilityRequirements({ job, workshop: workshopSnapshot, requirements: [length(1200)] });
    expect(result.summary).toEqual({ supported: 0, conflict: 1, unknown: 0 });
    expect(result.assessments[0]).toMatchObject({ status: "conflict", requirement: length(1200) });
    expect(result.assessments[0].explanation).toContain("exceeds");
    expect(result.workshopVersion).toBe(1);
  });

  it("limits a matching length or process to a documented-profile claim", () => {
    const result = checkFacilityRequirements({
      job,
      workshop: workshopSnapshot,
      requirements: [
        length(850),
        { id: "00000000-0000-4000-8000-000000000019", kind: "process", label: "B3", source, requiredProcess: "PRESS_BRAKE" },
      ],
    });
    expect(result.summary.supported).toBe(2);
    expect(result.assessments[0].explanation).toContain("does not establish tool clearance");
  });

  it("keeps absent tools and geometric reachability unknown", () => {
    const result = checkFacilityRequirements({
      job,
      workshop: workshopSnapshot,
      requirements: [
        { id: requirementId, kind: "tool", label: "Hole 2", source, requiredTool: "angled drill" },
        { id: "00000000-0000-4000-8000-000000000019", kind: "access", label: "Hole 2", source, operation: "Drill at 180 degrees then 90 degrees" },
      ],
    });
    expect(result.summary).toEqual({ supported: 0, conflict: 0, unknown: 2 });
    expect(result.assessments[1].explanation).toContain("does not infer");
  });

  it("does not mark missing or unconfirmed facility measurements as supported", () => {
    const missing: WorkshopSnapshot = structuredClone(workshopSnapshot);
    missing.machines[0].usableBendLengthMm.value = null;
    missing.machines[0].usableBendLengthMm.evidenceState = "not_found";
    const result = checkFacilityRequirements({ job, workshop: missing, requirements: [length(850)] });
    expect(result.assessments[0].status).toBe("unknown");

    const unconfirmed: WorkshopSnapshot = structuredClone(workshopSnapshot);
    unconfirmed.confirmedBy = null;
    unconfirmed.confirmedAt = null;
    const other = checkFacilityRequirements({ job, workshop: unconfirmed, requirements: [length(1200)] });
    expect(other.assessments[0].status).toBe("unknown");
  });

  it("rejects a workshop version that is not the one selected for this job", () => {
    expect(() => checkFacilityRequirements({
      job,
      workshop: { ...workshopSnapshot, id: "00000000-0000-4000-8000-000000000099" },
      requirements: [length(1200)],
    })).toThrow("does not match");
  });
});
