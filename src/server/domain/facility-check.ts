import {
  FacilityCheckResultSchema,
  type FacilityAssessment,
  type FacilityCheckResult,
  type FacilityRequirement,
  type Job,
  type Machine,
  type WorkshopSnapshot,
} from "@/contracts";

function sameLabel(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ").toLocaleLowerCase("en") ===
    b.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function assess(requirement: FacilityRequirement, machine: Machine, confirmed: boolean): FacilityAssessment {
  if (!confirmed) {
    return {
      requirement,
      status: "unknown",
      explanation: "The selected workshop version is not confirmed by the facility.",
      facilityBasis: [],
    };
  }

  switch (requirement.kind) {
    case "bend_length": {
      const capacity = machine.usableBendLengthMm;
      if (capacity.evidenceState !== "supported" || capacity.value === null) {
        return {
          requirement,
          status: "unknown",
          explanation: "The confirmed machine profile has no usable bend length that can be compared.",
          facilityBasis: [],
        };
      }
      const conflict = requirement.requiredMm > capacity.value;
      return {
        requirement,
        status: conflict ? "conflict" : "supported",
        explanation: conflict
          ? `The stated ${requirement.requiredMm} mm bend exceeds the machine's documented ${capacity.value} mm usable length.`
          : `The stated ${requirement.requiredMm} mm bend is within the machine's documented ${capacity.value} mm usable length. This does not establish tool clearance or physical feasibility.`,
        facilityBasis: [`${machine.name}: usable bend length ${capacity.value} mm (confirmed profile)`],
      };
    }
    case "process": {
      if (!sameLabel(requirement.requiredProcess, machine.process)) {
        return {
          requirement,
          status: "unknown",
          explanation: `The selected machine lists “${machine.process}”, not the stated process. The profile does not prove the process is unavailable elsewhere in the facility.`,
          facilityBasis: [`${machine.name}: ${machine.process} (confirmed profile)`],
        };
      }
      return {
        requirement,
        status: "supported",
        explanation: "The stated process matches the selected machine's confirmed profile. Setup and geometry still need review.",
        facilityBasis: [`${machine.name}: ${machine.process} (confirmed profile)`],
      };
    }
    case "tool": {
      const matchingTool = machine.tools.find((tool) => sameLabel(tool.name, requirement.requiredTool));
      if (!matchingTool) {
        return {
          requirement,
          status: "unknown",
          explanation: "This tool is not listed for the selected machine. An incomplete profile does not prove the facility lacks it.",
          facilityBasis: [],
        };
      }
      return {
        requirement,
        status: "supported",
        explanation: "The named tool is listed on the selected machine's confirmed profile. Suitability for this operation still needs review.",
        facilityBasis: [`${machine.name}: ${matchingTool.name}${matchingTool.specification ? ` — ${matchingTool.specification}` : ""} (confirmed profile)`],
      };
    }
    case "access":
      return {
        requirement,
        status: "unknown",
        explanation: "Reachability, collisions, and the order of angled operations need a reviewed setup or fixture plan. This check does not infer them from a drawing or 3D model.",
        facilityBasis: [],
      };
  }
}

/** Compares engineer-transcribed drawing requirements with one selected, versioned facility profile. */
export function checkFacilityRequirements(input: {
  job: Job;
  workshop: WorkshopSnapshot;
  requirements: FacilityRequirement[];
}): FacilityCheckResult {
  const { job, workshop, requirements } = input;
  if (job.workshopSnapshotId !== workshop.id || job.workspaceId !== workshop.workspaceId || !job.machineId) {
    throw new Error("The selected workshop version does not match the job.");
  }
  const machine = workshop.machines.find((item) => item.id === job.machineId);
  if (!machine) throw new Error("The selected machine is not in this workshop version.");

  const confirmed = workshop.confirmedBy !== null && workshop.confirmedAt !== null;
  const assessments = requirements.map((requirement) => assess(requirement, machine, confirmed));
  return FacilityCheckResultSchema.parse({
    jobVersion: job.version,
    workshopSnapshotId: workshop.id,
    workshopName: workshop.name,
    workshopVersion: workshop.version,
    machineId: machine.id,
    machineName: machine.name,
    assessments,
    summary: {
      supported: assessments.filter((item) => item.status === "supported").length,
      conflict: assessments.filter((item) => item.status === "conflict").length,
      unknown: assessments.filter((item) => item.status === "unknown").length,
    },
  });
}
