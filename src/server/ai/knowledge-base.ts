import type { PreparedEvidence, QuestionInput } from "./types";

// The present job packet is small. Keep every verified excerpt when it fits;
// retrieve bounded chunks only when a future job grows beyond the prompt budget.
const CHUNK_CHARS = 1_600;
const CHUNK_OVERLAP = 180;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_CHUNKS = 10;
const STOP_WORDS = new Set([
  "about", "after", "before", "could", "does", "from", "have", "into", "should",
  "that", "the", "their", "there", "this", "what", "when", "where", "which",
  "with", "would", "your", "you", "and", "are", "can", "for", "how", "is",
]);

export type QuestionKnowledge = {
  evidence: PreparedEvidence[];
  catalogChunks: number;
  selection: "complete_packet" | "retrieved_excerpts" | "no_match";
};

/**
 * Build a request-local knowledge catalogue from already authorised, hash-checked
 * source pages and confirmed workshop notes. No model or uploaded document chooses
 * the job, release, source list, or citation target.
 */
export function retrieveQuestionKnowledge(
  input: QuestionInput,
  verifiedEvidence: PreparedEvidence[],
): QuestionKnowledge {
  const chunks = verifiedEvidence.flatMap(chunkEvidence);
  if (chunks.length === 0) return { evidence: [], catalogChunks: 0, selection: "no_match" };
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (chunks.length <= MAX_CHUNKS && totalChars <= MAX_CONTEXT_CHARS) {
    return { evidence: chunks, catalogChunks: chunks.length, selection: "complete_packet" };
  }

  const queryTerms = terms([
    input.question.slice(0, 1_000),
    input.context.bendId ?? "",
    input.approvedContext?.selectedStep?.guidanceDecision === "include"
      ? input.approvedContext.selectedStep.instruction.slice(0, 400) : "",
  ].join(" "));
  const ranked = chunks.map((chunk, index) => ({
    chunk,
    index,
    score: relevance(chunk, queryTerms, input.context.bendId),
  })).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: PreparedEvidence[] = [];
  let selectedChars = 0;
  for (const item of ranked) {
    if (selected.length >= MAX_CHUNKS || selectedChars + item.chunk.text.length > MAX_CONTEXT_CHARS) continue;
    selected.push(item.chunk);
    selectedChars += item.chunk.text.length;
  }
  return {
    evidence: selected,
    catalogChunks: chunks.length,
    selection: selected.length ? "retrieved_excerpts" : "no_match",
  };
}

function chunkEvidence(source: PreparedEvidence): PreparedEvidence[] {
  const text = source.text;
  if (text.length <= CHUNK_CHARS) return [source];
  const chunks: PreparedEvidence[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + CHUNK_CHARS / 2) end = boundary;
    }
    const excerpt = text.slice(start, end).trim();
    if (excerpt) chunks.push({ ...source, sourceKey: `${source.sourceKey}#${chunks.length + 1}`, text: excerpt });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function relevance(source: PreparedEvidence, queryTerms: Set<string>, selectedBendId: string | null): number {
  const haystack = source.text.normalize("NFKC").toLocaleLowerCase();
  let score = selectedBendId && haystack.includes(selectedBendId.toLocaleLowerCase()) ? 6 : 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function terms(value: string): Set<string> {
  return new Set(value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)) ?? []);
}
