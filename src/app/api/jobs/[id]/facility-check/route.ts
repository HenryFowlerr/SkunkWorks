import { FacilityCheckBodySchema, FacilityCheckResultSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { checkFacilityRequirements } from "@/server/domain/facility-check";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, FacilityCheckBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const { job, assets } = await repository.getJobBundle(jobId);
    if (job.version !== input.expectedJobVersion) {
      throw new ApiFault("VERSION_CONFLICT", "The job inputs changed. Reload before checking the facility.");
    }
    if (!job.workshopSnapshotId || !job.machineId) {
      throw new ApiFault("REVIEW_REQUIRED", "Select a workshop version and machine first.");
    }

    const readyDrawings = new Set(assets
      .filter((asset) => asset.kind === "drawing_pdf" && asset.status === "ready" && job.sourceAssetIds.includes(asset.id))
      .map((asset) => asset.id));
    if (input.requirements.some((requirement) => !readyDrawings.has(requirement.source.assetId))) {
      throw new ApiFault("VALIDATION_FAILED", "Each requirement must cite an attached, ready drawing PDF.", {
        fieldErrors: { requirements: ["Select a ready drawing attached to this job."] },
      });
    }

    const workshop = await repository.getWorkshopSnapshot(job.workshopSnapshotId);
    return FacilityCheckResultSchema.parse(checkFacilityRequirements({
      job,
      workshop,
      requirements: input.requirements,
    }));
  });
}
