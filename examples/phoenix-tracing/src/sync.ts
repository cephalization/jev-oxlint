import { syncSkills } from "@jev-oxlint/engine";

import { linter } from "./linter.js";

const { copied, sourceCommit } = syncSkills(linter);
process.stdout.write(
  `sync-skills: copied ${copied.length} files from ${sourceCommit.slice(0, 10)}\n`,
);
