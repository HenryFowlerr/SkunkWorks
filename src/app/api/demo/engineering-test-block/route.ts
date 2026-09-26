import { PitchDemoPackageSchema } from "@/contracts";
import { engineeringTestBlockDemo } from "@/server/demo/engineering-test-block";
import { handleApiOperation } from "@/server/http/api";

/** The prepared pitch package used in the five-minute Engineering Test Block demo. */
export async function GET(): Promise<Response> {
  return handleApiOperation(async () => PitchDemoPackageSchema.parse({
    id: engineeringTestBlockDemo.id,
    partName: engineeringTestBlockDemo.partName,
    partNumber: engineeringTestBlockDemo.partNumber,
    inputFiles: engineeringTestBlockDemo.inputFiles,
    capability: engineeringTestBlockDemo.capability,
    knowledgeBase: engineeringTestBlockDemo.knowledgeBase,
  }));
}
