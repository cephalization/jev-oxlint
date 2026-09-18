# jev-oxlint

Build your own [jev](https://docs.typesafe.ai/introduction)-powered [oxlint](https://oxc.rs/docs/guide/usage/linter.html)
linter from a directory of agent skills.

A skill (a `SKILL.md` index plus `references/*.md`) is guidance written for people and
coding agents. This repo turns it into a linter for the class of mistakes a regex or a
type checker cannot see but a person who read the docs would: flushing spans only on the
happy path, a `CHAIN` span around what is really a retriever, a patient's diagnosis in a
span attribute. jev, a calibrated classifier rather than a text generator, answers narrow
questions about each file against the shipped guidance; code decides everything else.

> Status: experiment. Nothing is published. The Phoenix example is real and validated live.

## What's here

| Package                                                | What it is                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/engine`](packages/engine)                   | `@jev-oxlint/engine` — the runtime. Redaction, the sync bridge (oxlint rules are synchronous; jev is HTTP), the content-hash cache, generic AST fact extraction, guidance routing and the hint tier, and the `Check` contract. Knows nothing about any particular SDK. |
| [`packages/create`](packages/create)                   | `create-jev-linter` — scaffolds a linter package from a skills directory. It works immediately with zero checks, in hint mode.                                                                                                                                         |
| [`packages/author`](packages/author)                   | `jev-lint` — `survey` (which guidance applies to a codebase?), `calibrate` (do jev's answers match the human answer key?), `propose` (assemble the packet for drafting a new check).                                                                                   |
| [`examples/phoenix-tracing`](examples/phoenix-tracing) | A complete linter for Phoenix's `phoenix-tracing` skill: five checks, thirteen fixtures, an answer key. This is what `propose` is meant to produce, one check at a time.                                                                                               |

## How a linter works

```
file ──► ImportDeclaration scan ──► imports none of the target packages? ──► done (free)
              ▼
        generic fact extraction (redacted): calls to imported symbols with their
        object-literal args broken into key/value-expression pairs, tracked member
        calls, process handlers, exports, flag properties
              ▼
        per-check precheck ──► clear-cut? report or skip without jev
              ▼
        routing request: one Noul per reference file, "does this apply?", SKILL.md as index
              ▼
        ONE detailed request per file
          state     = { file, code: { redaction, text, calls[] }, facts, guidance: <whole files> }
          questions = every applicable check's Noul/Choice questions + one coarse hint question
                      per relevant guidance file no check covers
              │  sha256(request) → cache; worker thread + Atomics.wait bridge
              ▼
        decide() ──► context.report() citing guidance files;  hints name the doc to read
```

Three rules, all borrowed from TypeSafe's own
[how-to-build guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one):

1. **Code decides everything it can.** Triggers, facts and prechecks are plain AST work.
2. **The policy goes in `state`.** Guidance files are copied whole into the request and
   cited by path. Nothing inside the markdown is parsed; the file path is the only coupling,
   verified at build time.
3. **Questions are atomic and reviewable.** One check file per check; questions and
   thresholds are what a reviewer reads first.

### What leaves the machine

Before any request is built, the source is rewritten from the AST: string literal values
become `"<str:N>"`, template quasis `<str:N>`, long numbers `<num:N>`. Property keys,
import sources, directives and the `kind`/`name`/`type` option values are kept. Identifiers,
member expressions and comments are kept. Hardcoded values in span attributes are decided in
code and never sent. Every request body is recorded under `node_modules/.cache/oxlint-jev`
as an audit trail. The API key comes only from `TYPESAFE_API_KEY` in the process environment.

## Building a linter

```bash
pnpm install && pnpm build

# 1. scaffold: works immediately in hint mode, zero checks
node packages/create/dist/cli.js my-lint --skills ~/proj/.agents/skills --skill my-skill \
  --targets '^@my/(sdk|client)(/.*)?$'

# 2. look: which guidance applies to this codebase, and how often?
TYPESAFE_API_KEY=… jev-lint survey --plugin my-lint/dist/index.js ~/proj/src

# 3. propose: assemble the packet for drafting one check (guidance + relevant files + contract)
jev-lint propose --plugin my-lint/dist/index.js --guidance my-lint/skills/my-skill/references/x.md ~/proj/src

# 4. write the check + fixtures + answer key (or have a model draft them from the packet), then
jev-lint calibrate --plugin my-lint/dist/index.js --key my-lint/answer-key.json my-lint/fixtures

# 5. ship: add to any .oxlintrc.json
#   { "jsPlugins": [{ "name": "my", "specifier": "my-lint" }], "rules": { "my/guidance": "warn" } }
```

Where a generative model sits: only in step 4, drafting from the `propose` packet, and only
when calibration drifts after a skill edit. jev runs on every lint, cached by content.
Nothing generative is in the lint path, and nothing generative sees unredacted code.

## Running the example

```bash
pnpm --filter @jev-oxlint/example-phoenix-tracing build
TYPESAFE_API_KEY=… OXLINT_JEV_MODE=live pnpm --filter @jev-oxlint/example-phoenix-tracing demo
pnpm --filter @jev-oxlint/example-phoenix-tracing test    # answer key via OXLINT_JEV_MODE=mock
```

Modes (`OXLINT_JEV_MODE`): `live`, `record` (write requests, no network), `mock` (answers from
`OXLINT_JEV_MOCK_FILE`), `off`. Default is live when the key is set, else off with one notice.

## What the Phoenix experiment showed

Measured against jev-1.13.0 on the fixtures and every app in Phoenix's `js/examples/apps`.

- **jev agrees with the human answer key on every fixture, with wide margins.** Per-attribute
  PII: `token_count` 0.04, `patient_dob` 0.98, `chief_complaint` 0.98 in one request, where a
  keyword denylist is wrong in both directions.
- **It found a real bug in a shipped example**: the langchain quickstart flushes only on the
  success path (noul 0.07 for "flushed on every exit path?").
- **Guidance in `state` steers the model, measurably.** Every misfire during development was
  fixed by adding a sentence of true guidance or splitting a question, never by moving a
  threshold. Mentioning a candidate answer in the question text acts as an anchor even when
  redundant with state.
- **Routing is sharp; the coarse hint question is not.** Relevance separated 0.80–0.94 from
  below 0.50 across 41 files. "Does the code follow this whole file?" is diffuse, as TypeSafe
  predicts for broad questions, so hints gate at 0.80 and are labelled coarse. The precise
  version of a hint is a check.
- **A one-sentence docs edit changed what the linter finds.** Adding "span error handling" to
  one `SKILL.md` blurb moved a reference's relevance from below 0.50 to 0.90 and fired the
  hint at 1.00, with no plugin change. Hint recall is bounded by the index's blurbs.
- **Cost.** ~$0.002 for the fixtures; ~$0.015 for 41 files with routing. Second run: zero requests.
