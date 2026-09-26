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
      instructions: PITCH_CAPABILITY_INSTRUCTIONS,
      userText: capabilityPrompt(input),
      formatName: "chappe_capability_scan_v1",
      schema: PitchCapabilityJsonSchema,
      outputSchema: PitchCapabilityCheckSchema,
      maxOutputTokens: 2_500,
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
      instructions: PITCH_KNOWLEDGE_BASE_INSTRUCTIONS,
      userText: knowledgeBasePrompt(input),
      formatName: "chappe_part_knowledge_base_v1",
      schema: PitchKnowledgeBaseJsonSchema,
      outputSchema: PitchKnowledgeBaseSchema,
      maxOutputTokens: 4_000,
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
      instructions: PITCH_ISSUE_TRIAGE_INSTRUCTIONS,
      userText: issueTriagePrompt(input),
      formatName: "chappe_floor_issue_triage_v1",
      schema: PitchIssueTriageJsonSchema,
      outputSchema: PitchIssueTriageSchema,
      maxOutputTokens: 2_000,
    });
    try {
      assertPitchIssueTriageForInput(output, input);
    } catch {
      throw new AiProviderError("UNSUPPORTED_CLAIM");
    }
    return output;
  }

  private configuredModel(): string {
    const model = this.environment.OPENAI_MODEL?.trim();
    if (!model) throw new AiProviderError("MISSING_MODEL_CONFIGURATION");
    return model;
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
    instructions: string;
    userText: string;
    formatName: string;
    schema: object;
    outputSchema: z.ZodType<T>;
    maxOutputTokens: number;
  }): Promise<T> {
    let response: OpenAI.Responses.Response;
    try {
      response = await this.configuredClient().responses.create({
        model: this.configuredModel(),
        instructions: input.instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: input.userText }] }],
        text: { format: { type: "json_schema", name: input.formatName, strict: true, schema: input.schema as never } },
        max_output_tokens: input.maxOutputTokens,
        store: false,
      });
    } catch (error) {
      throw mapProviderError(error);
    }
    const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
    if (refused) throw new AiProviderError("PROVIDER_REFUSAL");
    if (response.status !== "completed" || !response.output_text) throw new AiProviderError("MALFORMED_OUTPUT");
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
