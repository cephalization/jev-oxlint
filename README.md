# jev-oxlint

Build an [Oxlint JavaScript plugin](https://oxc.rs/docs/guide/usage/linter/js-plugins) from an agent
skill. Deterministic AST checks handle structural rules, while
[Jev](https://docs.typesafe.ai/introduction) answers narrow, typed questions that require contextual
judgment.

The result is a project-specific linter that can:

- limit analysis to files that import selected packages;
- route relevant skill guidance to each file;
- report broad guidance hints before precise checks exist;
- combine AST prechecks, model answers, and deterministic thresholds; and
- calibrate model-backed checks against a human answer key.

> **Experimental:** Oxlint JavaScript plugins are alpha. Live cache misses make synchronous network
> requests, so this project is best suited to evaluation and targeted workflows. The packages are
> not yet published; use a local clone as described below.

## Quick start

Requirements: Node.js 22 or later, pnpm 12, and a project skill containing `SKILL.md` with optional
`references/*.md` files.

Build the toolkit, then scaffold a linter next to the project that it will inspect:

```bash
git clone <repository-url> /absolute/path/to/jev-oxlint
cd /absolute/path/to/jev-oxlint
pnpm install
pnpm build

node packages/create/dist/cli.js ../my-linter \
  --skills /absolute/path/to/project/.agents/skills \
  --skill my-skill \
  --targets '^@my/(sdk|client)(/.*)?$' \
  --local-repo /absolute/path/to/jev-oxlint

cd ../my-linter
pnpm install
pnpm build
```

The generated linter initially has no precise checks. It uses the skill as a hint tier, identifying
which guidance applies to each in-scope file and reporting likely deviations. Survey a codebase to
find guidance that should become a precise check:

```bash
TYPESAFE_API_KEY=… pnpm survey /absolute/path/to/project/src
```

Run the generated Oxlint plugin directly with its configuration:

```bash
TYPESAFE_API_KEY=… pnpm exec oxlint \
  -c /absolute/path/to/my-linter/.oxlintrc.json \
  /absolute/path/to/project/src
```

The scaffold defaults to published `@jev-oxlint/engine` and `@jev-oxlint/author` dependencies. Until
those packages are available, `--local-repo` links them from a clone. Use `--workspace` when the new
linter is inside this pnpm workspace.

## Author a precise check

`jev-lint propose` creates a redacted context packet from a guidance file and source samples. A
proposal provider returns a draft check, realistic fixtures, answer-key entries, and review notes.

Anthropic is the default proposal provider:

```bash
TYPESAFE_API_KEY=… ANTHROPIC_API_KEY=… pnpm exec jev-lint propose \
  --plugin dist/index.js \
  --guidance skills/my-skill/references/topic.md \
  --calibrate /absolute/path/to/project/src
```

The [Codex SDK](https://developers.openai.com/codex/sdk) is also supported:

```bash
pnpm add -D @openai/codex-sdk

TYPESAFE_API_KEY=… pnpm exec jev-lint propose \
  --provider codex \
  --plugin dist/index.js \
  --guidance skills/my-skill/references/topic.md \
  --calibrate /absolute/path/to/project/src
```

The Codex provider uses an existing Codex login or `CODEX_API_KEY`.

Use `--model <id>` to select a model or `--dry-run` to write only the context packet. Treat all
generated code as a draft. Review `proposals/<check>.md`, the questions and thresholds, the check
source, and its fixtures before use.

## How linting works

```text
target import gate
  -> deterministic AST facts and prechecks
  -> guidance-routing request
  -> one detailed request containing applicable checks and hints
  -> deterministic probability thresholds and Oxlint diagnostics
```

The design follows three rules:

1. Code decides everything it can: import gates, facts, triggers, prechecks, and thresholds.
2. Policy stays in the request state: checks cite complete guidance files instead of parsing
   Markdown sections.
3. Questions remain atomic: each check owns reviewable questions and deterministic decisions.

Each stage sends all of its questions in one request. The cache key covers the model, redacted code,
extracted facts, guidance, and questions. An unchanged request reuses its stored response.

## Data handling

Live mode sends the following data to TypeSafe:

- the relative file path;
- source with ordinary string literals, template text, and long numbers replaced by length
  placeholders;
- extracted imports, calls, object keys, member calls, handlers, exports, and flags; and
- applicable guidance files and questions.

Identifiers, comments, property keys, import sources, directives, type-level literals, and selected
structural option values remain visible. Redaction reduces accidental disclosure of literal data;
it is not a secrecy boundary. Inspect a request in `record` mode before using live mode with a
sensitive repository.

Request records default to `node_modules/.cache/oxlint-jev`. Set `OXLINT_JEV_CACHE_DIR` to use
another location. If no `node_modules` directory is available, the engine uses the system temporary
directory. Records contain redacted source and complete guidance text and should receive the same
access controls as the repository.

Jev reads `TYPESAFE_API_KEY`. Anthropic and Codex credentials are only used by `jev-lint propose`;
proposal providers are not part of the lint path.

## Runtime modes

Set `OXLINT_JEV_MODE` to one of the following values:

- `live` calls Jev and caches the response.
- `record` writes request bodies without calling Jev.
- `mock` reads answers from `OXLINT_JEV_MOCK_FILE`.
- `off` skips Jev-backed checks.

The default is `live` when `TYPESAFE_API_KEY` is set and `off` otherwise. On a cache miss, an
in-scope file can make one routing request and one detailed request. Because Oxlint rule visitors
are synchronous, network latency affects uncached live runs.

## Example

[`examples/phoenix-tracing`](examples/phoenix-tracing) is a worked linter with six checks, seventeen
fixtures, and a human answer key. Its [experiment notes](docs/phoenix-experiment.md) document the
live calibration result and reproduction commands. The [`propose` case study](docs/propose-case-study.md)
shows the output of the check-authoring workflow.

## Repository layout

| Path                                                   | Purpose                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`packages/engine`](packages/engine)                   | Oxlint runtime, fact extraction, redaction, guidance routing, cache, synchronous Jev bridge, and check contract. |
| [`packages/create`](packages/create)                   | `create-jev-linter` scaffolding for registry, workspace, and local-clone dependency modes.                       |
| [`packages/author`](packages/author)                   | `jev-lint survey`, `calibrate`, and `propose`, with Anthropic and Codex proposal providers.                      |
| [`examples/phoenix-tracing`](examples/phoenix-tracing) | Worked example and calibration material.                                                                         |

## Development

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm fmt:check
```
