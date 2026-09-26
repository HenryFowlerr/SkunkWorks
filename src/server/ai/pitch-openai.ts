import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import {
  PITCH_CAPABILITY_INSTRUCTIONS,
  PITCH_KNOWLEDGE_BASE_INSTRUCTIONS,
  PITCH_ISSUE_TRIAGE_INSTRUCTIONS,
  PitchCapabilityCheckSchema,
  PitchCapabilityJsonSchema,
  PitchIssueTriageJsonSchema,
  PitchIssueTriageSchema,
  PitchKnowledgeBaseJsonSchema,
  PitchKnowledgeBaseSchema,
  assertPitchCapabilityForInput,
  assertPitchCapabilityForKnowledgeBase,
  assertPitchIssueTriageForInput,
  assertPitchOutputCitations,
  capabilityPrompt,
  issueTriagePrompt,
  knowledgeBasePrompt,
  type PitchCapabilityCheck,
  type PitchCapabilityInput,
  type PitchIssueTriage,
  type PitchIssueTriageInput,
  type PitchKnowledgeBase,
  type PitchKnowledgeBaseInput,
} from "./pitch";
import { AiProviderError } from "./types";
import { floorAssistantModel, initialAnalysisModel } from "./model-routing";
import { pitchOutputTokenLimit } from "./pitch-guardrails";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 50_000;

export type PitchAiAdapter = {
  assessCapability(input: PitchCapabilityInput): Promise<PitchCapabilityCheck>;
  createKnowledgeBase(input: PitchKnowledgeBaseInput): Promise<PitchKnowledgeBase>;
  triageIssue(input: PitchIssueTriageInput): Promise<PitchIssueTriage>;
};

type Environment = Record<string, string | undefined>;
type Options = { client?: OpenAI; environment?: Environment };

/**
 * Server-only adapter. Browser code never sees a provider key; the static
 * pitch uses a prepared fixture until this adapter is deployed behind auth.
 */
export class OpenAiPitchAdapter implements PitchAiAdapter {
  private readonly injectedClient?: OpenAI;
  private readonly environment: Environment;
  private realClient?: OpenAI;

  constructor(options: Options = {}) {
    this.injectedClient = options.client;
    this.environment = options.environment ?? process.env;
  }

  async assessCapability(input: PitchCapabilityInput): Promise<PitchCapabilityCheck> {
    const output = await this.request({
      model: initialAnalysisModel(this.environment),
      instructions: PITCH_CAPABILITY_INSTRUCTIONS,
      userText: capabilityPrompt(input),
      pdfs: input.pdfs,
      stlVisual: input.stlVisual,
      formatName: "chappe_capability_scan_v1",
      schema: PitchCapabilityJsonSchema,
      outputSchema: PitchCapabilityCheckSchema,
      maxOutputTokens: pitchOutputTokenLimit("capability", this.environment),
    });
    try {
      assertPitchCapabilityForInput(output, input);
    } catch {
      throw new AiProviderError("UNSUPPORTED_CLAIM");
    }
    return output;
  }

  async createKnowledgeBase(input: PitchKnowledgeBaseInput): Promise<PitchKnowledgeBase> {
    try {
      assertPitchCapabilityForKnowledgeBase(input.capability, input);
    } catch {
      throw new AiProviderError("UNSUPPORTED_CLAIM");
    }
    const sources = [...input.sources, ...input.supplier.sources];
    const output = await this.request({
      model: initialAnalysisModel(this.environment),
      instructions: PITCH_KNOWLEDGE_BASE_INSTRUCTIONS,
      userText: knowledgeBasePrompt(input),
      pdfs: [],
      stlVisual: null,
      formatName: "chappe_part_knowledge_base_v1",
      schema: PitchKnowledgeBaseJsonSchema,
      outputSchema: PitchKnowledgeBaseSchema,
      maxOutputTokens: pitchOutputTokenLimit("knowledge_base", this.environment),
    });
    try {
      assertPitchOutputCitations(output, sources);
    } catch {
      throw new AiProviderError("UNSUPPORTED_CLAIM");
    }
    return output;
  }

  async triageIssue(input: PitchIssueTriageInput): Promise<PitchIssueTriage> {
    const output = await this.request({
      model: floorAssistantModel(this.environment),
      instructions: PITCH_ISSUE_TRIAGE_INSTRUCTIONS,
      userText: issueTriagePrompt(input),
      pdfs: [],
      stlVisual: null,
      formatName: "chappe_floor_issue_triage_v1",
      schema: PitchIssueTriageJsonSchema,
      outputSchema: PitchIssueTriageSchema,
      maxOutputTokens: pitchOutputTokenLimit("triage", this.environment),
      // A floor report is deliberately small and structured. Luna does not
      // need a long private reasoning budget to turn a single observation
      // into a hold-preserving handoff for an engineer.
      reasoningEffort: "none",
    });
    try {
      assertPitchIssueTriageForInput(output, input);
    } catch {
      throw new AiProviderError("UNSUPPORTED_CLAIM");
    }
    return output;
  }

  private configuredClient(): OpenAI {
    const apiKey = this.environment.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new AiProviderError("MISSING_CREDENTIALS");
    if (this.injectedClient) return this.injectedClient;
    if (!this.realClient) this.realClient = new OpenAI({
      apiKey,
      timeout: readTimeout(this.environment.OPENAI_TIMEOUT_MS),
      maxRetries: 0,
    });
    return this.realClient;
  }

  private async request<T>(input: {
    model: string;
    instructions: string;
    userText: string;
    pdfs: PitchCapabilityInput["pdfs"];
    stlVisual: PitchCapabilityInput["stlVisual"];
    formatName: string;
    schema: object;
    outputSchema: z.ZodType<T>;
    maxOutputTokens: number;
    reasoningEffort?: "none" | "low";
  }): Promise<T> {
    let response: OpenAI.Responses.Response;
    try {
      response = await this.configuredClient().responses.create({
        model: input.model,
        instructions: input.instructions,
        input: [{
          role: "user",
          content: [
            ...input.pdfs.map((pdf) => ({
              type: "input_file" as const,
              filename: pdf.filename,
              file_data: `data:application/pdf;base64,${Buffer.from(pdf.bytes.buffer, pdf.bytes.byteOffset, pdf.bytes.byteLength).toString("base64")}`,
              // The first capability pass must inspect the authorised drawing
              // visually as well as use its server-extracted text/citations.
              detail: "high" as const,
            })),
            ...(input.stlVisual ? [{
              type: "input_image" as const,
              image_url: input.stlVisual.imageDataUrl,
              detail: input.stlVisual.detail,
            }] : []),
            { type: "input_text" as const, text: input.userText },
          ],
        }],
        text: { format: { type: "json_schema", name: input.formatName, strict: true, schema: input.schema as never } },
        max_output_tokens: input.maxOutputTokens,
        ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
        store: false,
      });
    } catch (error) {
      throw mapProviderError(error);
    }
    const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
    if (refused) throw new AiProviderError("PROVIDER_REFUSAL");
    if (response.status !== "completed") {
      if (response.status === "failed" || response.status === "cancelled") {
        throw new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
      }
      // An incomplete response may have consumed the bounded request but does
      // not represent malformed browser input. Do not invite an automatic
      // retry; the engineer can decide whether another bounded attempt helps.
      if (response.status === "incomplete") {
        throw new AiProviderError("PROVIDER_UNAVAILABLE");
      }
      throw new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
    }
    if (!response.output_text) throw new AiProviderError("MALFORMED_OUTPUT");
    let decoded: unknown;
    try { decoded = JSON.parse(response.output_text); } catch { throw new AiProviderError("MALFORMED_OUTPUT"); }
    const parsed = input.outputSchema.safeParse(decoded);
    if (!parsed.success) throw new AiProviderError("MALFORMED_OUTPUT");
    return parsed.data;
  }
}

export function createPitchAiAdapter(): PitchAiAdapter {
  return new OpenAiPitchAdapter();
}

function readTimeout(raw: string | undefined): number {
  const parsed = raw ? Number(raw) : DEFAULT_TIMEOUT_MS;
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= MAX_TIMEOUT_MS ? parsed : DEFAULT_TIMEOUT_MS;
}

function mapProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const name = error instanceof Error ? error.name : "";
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (/timeout|timed.?out/i.test(name) || /ETIMEDOUT|ESOCKETTIMEDOUT/i.test(code)) return new AiProviderError("PROVIDER_TIMEOUT", { retryable: true });
  if (error instanceof OpenAI.APIError) {
    if (error.status === 408 || error.status === 504) return new AiProviderError("PROVIDER_TIMEOUT", { retryable: true });
    if (error.status === 400 || error.status === 404 || error.status === 422) return new AiProviderError("MODEL_OR_FEATURE_UNAVAILABLE");
    return new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: error.status === 429 || (error.status !== undefined && error.status >= 500) });
  }
  return new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
}
