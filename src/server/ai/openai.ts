import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AnswerSchema, ContextRefSchema } from "../../contracts/domain";
import { GenerationJsonSchema, GenerationOutputSchema, QuestionJsonSchema, QuestionOutputSchema } from "./schemas";
import { GENERATION_INSTRUCTIONS, QUESTION_INSTRUCTIONS, generationUserPrompt, questionUserPrompt, ENGINEER_REPLY_INSTRUCTIONS, engineerReplyUserPrompt } from "./prompts";
import {
  prepareGenerationEvidence,
  prepareQuestionEvidence,
} from "./grounding";
import { retrieveQuestionKnowledge } from "./knowledge-base";
import { parseGenerationOutput, parseQuestionOutput } from "./validate-output";
import { AiProviderError, type AskResult, type DraftProposal, type GenerationInput, type QuestionInput } from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 50_000;

export type AiAdapter = {
  generateDraft(input: GenerationInput): Promise<DraftProposal>;
  answerQuestion(input: QuestionInput): Promise<AskResult>;
  suggestEngineerReply(input: QuestionInput): Promise<AskResult>;
};

type Environment = Record<string, string | undefined>;

type AdapterOptions = {
  /** Test seam only; production construction uses the real OpenAI SDK client. */
  client?: OpenAI;
  environment?: Environment;
};

/** Server-only OpenAI Responses adapter. There is no mock or fallback provider. */
export class OpenAiResponsesAdapter implements AiAdapter {
  private readonly injectedClient?: OpenAI;
  private readonly environment: Environment;
  private realClient?: OpenAI;

  constructor(options: AdapterOptions = {}) {
    this.injectedClient = options.client;
    this.environment = options.environment ?? process.env;
  }

  async generateDraft(input: GenerationInput): Promise<DraftProposal> {
    const model = this.configuredModel();
    const evidence = prepareGenerationEvidence(input);
    const response = await this.request({
      model,
      instructions: GENERATION_INSTRUCTIONS,
      userText: generationUserPrompt(input, evidence),
      pdfs: input.pdfs,
      formatName: "skunkworks_bend_draft_v1",
      schema: GenerationJsonSchema,
      maxOutputTokens: 6_000,
    });
    const structured = parseStructuredOutput(response, GenerationOutputSchema);
    return parseGenerationOutput(structured, input, evidence, model);
  }

  async answerQuestion(input: QuestionInput): Promise<AskResult> {
    return this.answerWithEvidence(input, "question");
  }

  async suggestEngineerReply(input: QuestionInput): Promise<AskResult> {
    return this.answerWithEvidence(input, "engineer_reply");
  }

  private async answerWithEvidence(input: QuestionInput, purpose: "question" | "engineer_reply"): Promise<AskResult> {
    const context = ContextRefSchema.parse(input.context);
    const checkedInput = { ...input, context };
    const verified = prepareQuestionEvidence(checkedInput);
    const knowledge = retrieveQuestionKnowledge(checkedInput, verified);
    if (knowledge.evidence.length === 0) {
      return {
        ...AnswerSchema.parse({
          id: randomUUID(),
          context,
          evidenceState: "not_found",
          text: "I cannot find source-backed guidance for this point. Hold the affected operation and ask engineering to clarify it.",
          evidence: [],
          suggestedFlag: "Ask engineering to clarify this operation before continuing.",
        }),
        model: "retrieval-only",
      };
    }
    const model = this.configuredModel();
    const response = await this.request({
      model,
      instructions: purpose === "engineer_reply" ? ENGINEER_REPLY_INSTRUCTIONS : QUESTION_INSTRUCTIONS,
      userText: purpose === "engineer_reply" ? engineerReplyUserPrompt(checkedInput, knowledge) : questionUserPrompt(checkedInput, knowledge),
      // The server-selected text snippets are the complete model-visible knowledge
      // for Q&A. Do not attach whole private PDFs and invite uncited answers.
      pdfs: [],
      formatName: "skunkworks_context_answer_v1",
      schema: QuestionJsonSchema,
      maxOutputTokens: 1_500,
    });
    const parsed = parseStructuredOutput(response, QuestionOutputSchema);
    return parseQuestionOutput(parsed, checkedInput, knowledge.evidence, model);
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
    if (!this.realClient) {
      this.realClient = new OpenAI({
        apiKey,
        timeout: readTimeout(this.environment.OPENAI_TIMEOUT_MS),
        maxRetries: 0,
      });
    }
    return this.realClient;
  }

  private async request(options: {
    model: string;
    instructions: string;
    userText: string;
    pdfs: GenerationInput["pdfs"];
    formatName: string;
    schema: object;
    maxOutputTokens: number;
  }): Promise<OpenAI.Responses.Response> {
    const client = this.configuredClient();
    const content = [
      ...options.pdfs.map((pdf) => ({
        type: "input_file" as const,
        filename: pdf.filename,
        file_data: `data:application/pdf;base64,${Buffer.from(pdf.bytes.buffer, pdf.bytes.byteOffset, pdf.bytes.byteLength).toString("base64")}`,
        detail: readPdfDetail(this.environment.OPENAI_PDF_DETAIL),
      })),
      { type: "input_text" as const, text: options.userText },
    ];
    try {
      return await client.responses.create({
        model: options.model,
        instructions: options.instructions,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: options.formatName,
            strict: true,
            schema: options.schema as never,
          },
        },
        max_output_tokens: options.maxOutputTokens,
        store: false,
      });
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}

export function createAiAdapter(): AiAdapter {
  return new OpenAiResponsesAdapter();
}

function parseStructuredOutput<T>(
  response: OpenAI.Responses.Response,
  schema: z.ZodType<T>,
): T {
  const refusal = response.output.some((item) => item.type === "message" &&
    item.content.some((part) => part.type === "refusal"));
  if (refusal) throw new AiProviderError("PROVIDER_REFUSAL");
  if (response.status !== "completed") {
    if (response.status === "failed") throw new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
    throw new AiProviderError("MALFORMED_OUTPUT");
  }
  const outputText = response.output_text;
  if (typeof outputText !== "string" || outputText.length === 0) throw new AiProviderError("MALFORMED_OUTPUT");
  let decoded: unknown;
  try {
    decoded = JSON.parse(outputText);
  } catch {
    throw new AiProviderError("MALFORMED_OUTPUT");
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) throw new AiProviderError("MALFORMED_OUTPUT");
  return parsed.data;
}

function mapProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const name = error instanceof Error ? error.name : "";
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (/timeout|timed.?out/i.test(name) || /ETIMEDOUT|ESOCKETTIMEDOUT/i.test(code)) {
    return new AiProviderError("PROVIDER_TIMEOUT", { retryable: true });
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === 408 || status === 504) return new AiProviderError("PROVIDER_TIMEOUT", { retryable: true });
    if (status === 400 || status === 404 || status === 422) {
      return new AiProviderError("MODEL_OR_FEATURE_UNAVAILABLE");
    }
    if (status === 429 || (status !== undefined && status >= 500)) {
      return new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
    }
    return new AiProviderError("PROVIDER_UNAVAILABLE");
  }
  return new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true });
}

function readTimeout(raw: string | undefined): number {
  const parsed = raw ? Number(raw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > MAX_TIMEOUT_MS) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

function readPdfDetail(raw: string | undefined): "auto" | "low" | "high" {
  return raw === "auto" || raw === "low" || raw === "high" ? raw : "high";
}
