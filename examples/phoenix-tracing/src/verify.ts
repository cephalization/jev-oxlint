import { verifyGuidance } from "@jev-oxlint/engine";

import { linter } from "./linter.js";

const { checks, files } = verifyGuidance(linter);
process.stdout.write(`verify-guidance: ${checks} checks cite ${files} files, all present\n`);
