/**
 * The generative step of `jev-lint propose`: hand the packet to Claude and get
 * back a typed bundle — one check module, fixtures, answer-key entries, and
 * review notes. Structured output keeps the contract explicit; the model never
 * sees unredacted code because the packet is built from what jev saw.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const DEFAULT_MODEL = "claude-opus-5";

const NoulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.array(z.object({ option: z.string(), p: z.number() })),
});

export const ProposalSchema = z.object({
  check: z.object({
    id: z.string().describe("kebab-case check id, e.g. flush-before-exit"),
    exportName: z.string().describe("camelCase name of the exported const, e.g. flushBeforeExit"),
    fileName: z.string().describe("file name under src/checks/, e.g. flushBeforeExit.ts"),
    title: z.string(),
    source: z.string().describe("Complete TypeScript ESM module source for the check"),
  }),
  fixtures: z.array(
    z.object({
      fileName: z.string().describe("file name under fixtures/, e.g. bad-no-flush.ts"),
      purpose: z.enum(["violation", "correct", "trap"]),
      source: z.string(),
    }),
  ),
  answerKey: z.array(
    z.object({
      fixture: z.string().describe("fixture fileName"),
      question: z.string().describe("question key exactly as questions() generates it"),
      answer: z.union([NoulAnswer, ChoiceAnswer]),
    }),
  ),
  review: z.object({
    summary: z
      .string()
      .describe("Two or three sentences: what the check enforces and how it decides"),
    questionsToReview: z
      .array(z.string())
      .describe("The exact question texts a reviewer should read first"),
    thresholds: z.string().describe("Which thresholds/gates the check depends on and why"),
    factsNeeded: z
      .array(z.string())
      .describe(
        "Facts the engine does not extract that would make the check better; empty if none",
      ),
  }),
});

export type Proposal = z.infer<typeof ProposalSchema>;

const SYSTEM = `You draft checks for jev-oxlint linters. A check is a TypeScript module in the \`@jev-oxlint/engine\` Check shape that a person will review and calibrate. You will receive a packet containing the guidance to enforce, sample in-scope files (with string literals redacted), the check contract, and a worked example. Produce one check, realistic fixtures, and the answer key a careful reviewer would expect, exactly in the requested structure.

Priorities, in order: the questions are atomic and precise and point into state by path; the deterministic parts (appliesTo, precheck, decide) are correct TypeScript against the contract; fixtures are realistic and include a trap for naive keyword rules; the answer key uses the exact question keys the check generates. Do not invent engine APIs: use only what the contract and the example show.`;

export interface ProposeOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  onStatus?: (line: string) => void;
}

export interface ProposeResult {
  proposal: Proposal;
  model: string;
  usage: { input: number; output: number };
}

export async function proposeWithClaude(
  packet: string,
  options: ProposeOptions = {},
): Promise<ProposeResult> {
  const client = new Anthropic();
  const model = options.model ?? DEFAULT_MODEL;
  const status = options.onStatus ?? (() => {});
  status(`asking ${model} to draft the check…`);
  const started = Date.now();
  try {
    // Streaming: adaptive thinking shares max_tokens with the answer, and a
    // full check bundle is long, so give it room and avoid HTTP timeouts.
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: options.effort ?? "high", format: zodOutputFormat(ProposalSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: packet }],
    });
    let phase = "";
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type !== phase) {
        phase = event.content_block.type;
        status(
          `  ${phase === "thinking" ? "thinking" : "writing the bundle"}… (${Math.round((Date.now() - started) / 1000)}s)`,
        );
      }
    }
    let response;
    try {
      response = await stream.finalMessage();
    } catch (parseError) {
      const partial = stream.currentMessage;
      if (partial?.stop_reason === "max_tokens") {
        throw new Error(
          `the draft was cut off at max_tokens after ${partial.usage.output_tokens} output tokens; retry with --effort medium, a shorter guidance file, or fewer samples`,
        );
      }
      if (partial?.stop_reason === "refusal") {
        throw new Error(
          `the model declined to draft this check (${partial.stop_details?.explanation ?? "no explanation"})`,
        );
      }
      throw parseError;
    }
    if (response.stop_reason === "refusal") {
      throw new Error(
        `the model declined to draft this check (${response.stop_details?.explanation ?? "no explanation"})`,
      );
    }
    if (!response.parsed_output)
      throw new Error("the model's reply did not match the proposal schema");
    status(`  done in ${Math.round((Date.now() - started) / 1000)}s`);
    return {
      proposal: response.parsed_output,
      model: response.model,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new Error(
        "Anthropic authentication failed. Set ANTHROPIC_API_KEY or run `ant auth login`.",
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new Error("Anthropic rate limit hit; retry shortly.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${error.status ?? ""}: ${error.message}`);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new Error(`could not reach the Anthropic API: ${error.message}`);
    }
    throw error;
  }
}
