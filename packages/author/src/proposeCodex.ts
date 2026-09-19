import type { Codex as CodexClient, RunResult, ThreadOptions } from "@openai/codex-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  PROPOSAL_SYSTEM,
  ProposalSchema,
  type ProposeOptions,
  type ProposeResult,
} from "./propose.js";

export function codexThreadOptions(
  options: ProposeOptions,
  workingDirectory: string,
): ThreadOptions {
  return {
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { modelReasoningEffort: options.effort } : {}),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    workingDirectory,
    skipGitRepoCheck: true,
  };
}

export async function proposeWithCodex(
  packet: string,
  options: ProposeOptions = {},
): Promise<ProposeResult> {
  const status = options.onStatus ?? (() => {});
  const model = options.model;
  status(`asking Codex${model ? ` (${model})` : ""} to draft the check…`);
  const started = Date.now();
  let Codex: typeof CodexClient;
  try {
    ({ Codex } = await import("@openai/codex-sdk"));
  } catch {
    throw new Error(
      "the Codex provider requires @openai/codex-sdk; install it in the linter package",
    );
  }
  const codex = new Codex();
  const workingDirectory = mkdtempSync(path.join(os.tmpdir(), "jev-lint-codex-"));
  let turn: RunResult;
  try {
    const thread = codex.startThread(codexThreadOptions(options, workingDirectory));
    turn = await thread.run(`${PROPOSAL_SYSTEM}\n\n# Proposal packet\n\n${packet}`, {
      outputSchema: z.toJSONSchema(ProposalSchema),
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(turn.finalResponse);
  } catch (error) {
    throw new Error(
      `Codex returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const proposal = ProposalSchema.parse(decoded);
  status(`  done in ${Math.round((Date.now() - started) / 1000)}s`);
  return {
    proposal,
    model: model ?? "codex-configured-default",
    usage: {
      input: turn.usage?.input_tokens ?? 0,
      output: turn.usage?.output_tokens ?? 0,
    },
  };
}
