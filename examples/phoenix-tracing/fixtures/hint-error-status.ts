import { SpanStatusCode, trace } from "@opentelemetry/api";

declare const riskyOperation: () => Promise<string>;

// No hand-written check covers span status handling. The production guidance
// says to recordException + set ERROR status; this swallows the error and
// leaves the span looking successful.
export async function run() {
  const tracer = trace.getTracer("hint-error-status");
  return tracer.startActiveSpan("risky", async (span) => {
    try {
      const result = await riskyOperation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch {
      return "fallback";
    } finally {
      span.end();
    }
  });
}
