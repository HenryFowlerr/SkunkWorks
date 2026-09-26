import { z } from "zod";
import { RespondToFlagInputSchema } from "@/contracts";
import { parseRouteId } from "@/server/api/context";
import { getFlagResponseApiContext } from "@/server/api/feedback-context";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

/** Only a human engineer's explicit submission promotes a report to a clarification. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const flagId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, z.object({
      ...RespondToFlagInputSchema.shape,
      text: RespondToFlagInputSchema.shape.text.max(10000),
      flagId: RespondToFlagInputSchema.shape.flagId.default(flagId),
    }).strict().pipe(RespondToFlagInputSchema));
    if (input.flagId !== flagId) throw new ApiFault("VALIDATION_FAILED", "The flag ID must match the URL.");
    const { repository } = await getFlagResponseApiContext(flagId);
    return repository.respondToFlag(input);
  });
}
