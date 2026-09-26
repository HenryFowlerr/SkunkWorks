import { DecideProposalInputSchema, DraftSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const { id, proposalId } = await context.params;
    const jobId = parseRouteId(id);
    const parsedProposalId = parseRouteId(proposalId);
    const input = await parseApiBody(request, DecideProposalInputSchema.omit({ jobId: true, proposalId: true }));
    const { repository } = await getJobApiContext(jobId, ["fabricator"]);
    return DraftSchema.parse(await repository.decideProposal({ jobId, proposalId: parsedProposalId, ...input }));
  });
}
