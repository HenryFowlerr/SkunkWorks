import { DecideProposalInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

const ProposalDecisionBodySchema = DecideProposalInputSchema.omit({ jobId: true, proposalId: true });

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; proposalId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId, proposalId: rawProposalId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const proposalId = parseRouteId(rawProposalId);
    const body = await parseApiBody(request, ProposalDecisionBodySchema);
    const { repository } = await getJobApiContext(jobId, ["fabricator"]);
    return repository.decideMachineProposal({ jobId, proposalId, ...body });
  });
}
