# Phoenix tracing experiment

The Phoenix example is a worked evaluation target, not a claim that the tool is production-ready.
It currently contains six checks, seventeen fixtures, and guidance copied from Phoenix commit
`82532e83f2cd5f0e215ea306acb40a65661b12eb`.

## What the offline demo shows

The demo runs the real Oxlint binary and plugin in mock mode. The committed answer key supplies the
responses, so it exercises the complete lint path without calling Jev. It is a manual demonstration,
not an automated regression test or a measurement of a live Jev model.

```bash
pnpm install
pnpm build
OXLINT_JEV_MODE=mock \
OXLINT_JEV_MOCK_FILE=examples/phoenix-tracing/answer-key.json \
pnpm --filter @jev-oxlint/example-phoenix-tracing demo
```

## Latest committed live calibration

The latest committed calibration compared 22 recorded answers with the human answer key. Twenty-one
were within tolerance; one routing answer for `production-typescript` was outside tolerance. The
full result, including the model scores, token count, and miss, is in
[`annotation-identifier-collision.calibration.md`](../examples/phoenix-tracing/proposals/annotation-identifier-collision.calibration.md).

This replaces the earlier, incorrect summary that Jev agreed with every answer. Routing and broad
hints remain the least precise part of the experiment.

## Reproduce live calibration

Live runs require a TypeSafe API key and can incur usage charges. The model identifier is explicit
so a later default-model change does not silently alter the comparison.

```bash
pnpm install && pnpm build

TYPESAFE_API_KEY=… \
OXLINT_JEV_MODEL=jev-1.13.0 \
node packages/author/dist/cli.js calibrate \
  --plugin examples/phoenix-tracing/dist/index.js \
  --key examples/phoenix-tracing/answer-key.json \
  --out /tmp/jev-oxlint-calibration.md \
  examples/phoenix-tracing/fixtures
```

The authoring CLI uses a fresh temporary cache for each calibration, fails if Oxlint fails, and
rejects a run that compares zero answers.

## External Phoenix applications

Earlier development notes referenced a 41-file scan of Phoenix example applications, a discovered
flush-path issue, and point-in-time costs. The repository does not contain the external checkout or
raw records needed to reproduce those numbers, so they are not presented as current results.

To run a new survey against a Phoenix checkout and retain a report, record the Phoenix commit, Jev
model, date, command, and generated request/response artifacts with the result. A survey command is:

```bash
TYPESAFE_API_KEY=… \
OXLINT_JEV_MODEL=jev-1.13.0 \
node packages/author/dist/cli.js survey \
  --plugin examples/phoenix-tracing/dist/index.js \
  /absolute/path/to/phoenix/js/examples/apps
```
