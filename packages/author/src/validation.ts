export function assertCommandSucceeded(
  command: string,
  result: { status: number | null; error?: Error; stdout?: string; stderr?: string },
): void {
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(
    `${command} exited with status ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
  );
}

export function assertComparedAnswers(count: number): void {
  if (count === 0)
    throw new Error(
      "calibration compared zero answers; check the paths, answer-key filenames, and recorded question keys",
    );
}
