import { FlagReplySuggestionSchema, SuggestFlagReplyBodySchema } from "@/contracts/ai";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { loadQuestionInput } from "@/server/api/load-question-input";
import { createAiAdapter } from "@/server/ai";
import { AI_PROMPT_VERSIONS } from "@/server/ai/prompts";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

/** Read-only proposal. Only the separate engineer response action persists knowledge. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, SuggestFlagReplyBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const flags = await repository.listFlags({ jobId });
    const flag = flags.find((item) => item.id === input.flagId && item.context.jobId === jobId);
    if (!flag) throw new ApiFault("NOT_FOUND", "Issue not found for this part.");
    if (flag.version !== input.expectedVersion || flag.status !== "open") {
      throw new ApiFault("VERSION_CONFLICT", "This issue changed. Reload it before requesting a draft reply.");
    }
    const aiInput = await loadQuestionInput(repository, { context: flag.context, question: flag.question });
    const { model: _model, ...answer } = await createAiAdapter().suggestEngineerReply(aiInput);
    void _model;
    // Reject a stale proposal when someone responded while the model was running.
    const current = (await repository.listFlags({ jobId })).find((item) => item.id === flag.id);
    if (!current || current.version !== flag.version || current.status !== "open") {
      throw new ApiFault("VERSION_CONFLICT", "This issue changed while the draft reply was prepared. Reload it.");
    }
    return FlagReplySuggestionSchema.parse({
      flagId: flag.id, flagVersion: flag.version, approvalState: "draft",
      promptVersion: AI_PROMPT_VERSIONS.engineerReply, answer,
    });
  });
}
