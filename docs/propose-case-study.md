# `propose` case study

`jev-lint propose` was run against Phoenix's `references/annotations-typescript.md`, which no
existing precise check covered. The provider received the generic proposal instructions, the
guidance, redacted samples selected by the survey, the engine contract, and a worked example. It
did not receive check-specific instructions.

The resulting `annotation-identifier-collision` draft identified that structured annotations share
a compound identity and can overwrite one another when repeated writes omit a distinct identifier.
It produced one check and four fixtures, including traps for an idempotent evaluator rerun and
append-only notes.

The case is useful because it shows the intended review loop, not autonomous correctness:

1. Survey finds relevant guidance without a precise check.
2. A provider drafts a typed proposal bundle.
3. A person reviews questions, thresholds, source, and fixtures.
4. Live calibration compares model answers with the human answer key.

The committed artifacts are:

- [generated check](../examples/phoenix-tracing/src/checks/annotationIdentifierCollision.ts)
- [proposal and review note](../examples/phoenix-tracing/proposals/annotation-identifier-collision.md)
- [live calibration](../examples/phoenix-tracing/proposals/annotation-identifier-collision.calibration.md)

The heading previously described the draft as “unprompted.” That was imprecise: the provider was
explicitly prompted to produce a check bundle, but selected and implemented this particular rule
without check-specific instructions.
