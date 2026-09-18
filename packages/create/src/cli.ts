#!/usr/bin/env node
/**
 * create-jev-linter <dir> --skills <path-to-skills-dir> --skill <name> --targets <regex> [--name <plugin-name>] [--workspace]
 *
 * Scaffolds a linter package that depends on @jev-oxlint/engine. It ships
 * with zero checks and works immediately in hint mode: routing over the
 * skill's reference files plus coarse hints. Add checks under src/checks/.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const opt = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const skillsDir = opt("--skills");
const skill = opt("--skill");
const targets = opt("--targets");
const name = opt("--name") ?? skill ?? "jev";
// --workspace: emit workspace:* deps (for scaffolding inside the jev-oxlint monorepo itself).
const dep = argv.includes("--workspace") ? "workspace:*" : "^0.1.0";

if (!dir || !skillsDir || !skill || !targets) {
  console.log(
    "usage: create-jev-linter <dir> --skills <skills-dir> --skill <skill-folder> --targets <import-regex> [--name <plugin-name>]",
  );
  process.exit(2);
}
if (existsSync(dir)) {
  console.error(`create-jev-linter: ${dir} already exists`);
  process.exit(1);
}
const skillSource = path.join(skillsDir, skill);
if (!existsSync(path.join(skillSource, "SKILL.md"))) {
  console.error(`create-jev-linter: ${skillSource}/SKILL.md not found`);
  process.exit(1);
}

const write = (rel: string, text: string) => {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const pkgName = path.basename(dir);

write(
  "package.json",
  JSON.stringify(
    {
      name: pkgName,
      version: "0.0.0",
      private: true,
      type: "module",
      main: "dist/index.js",
      scripts: {
        build: "tsc -p tsconfig.json && node dist/verify.js",
        "sync-skills": "node dist/sync.js",
        survey: "jev-lint survey --plugin dist/index.js",
        calibrate: "jev-lint calibrate --plugin dist/index.js --key answer-key.json fixtures",
        test: "vitest run --passWithNoTests",
      },
      dependencies: { "@jev-oxlint/engine": dep },
      devDependencies: {
        "@jev-oxlint/author": dep,
        "@types/estree": "^1.0.9",
        "@types/node": "^26.5.1",
        oxlint: "~1.79.0",
        typescript: "^7.0.2",
        vitest: "^5.0.0",
      },
    },
    null,
    2,
  ),
);
write(
  "tsconfig.json",
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noUncheckedIndexedAccess: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: true,
        outDir: "dist",
        rootDir: "src",
        types: ["node"],
      },
      include: ["src/**/*"],
    },
    null,
    2,
  ),
);
write(".gitignore", "node_modules\ndist\n");
write(
  "src/linter.ts",
  `import { fileURLToPath } from "node:url";

import { defineLinter } from "@jev-oxlint/engine";

// Add checks here as you write them (see src/checks/README.md).
const checks = [] as const;

export const linter = defineLinter({
  name: ${JSON.stringify(name)},
  packageRoot: fileURLToPath(new URL("..", import.meta.url)),
  skills: {
    dir: "skills",
    skill: ${JSON.stringify(skill)},
    // Where \`pnpm sync-skills\` copies from. Files are copied, never symlinked.
    source: { dir: ${JSON.stringify(path.resolve(skillSource))} },
  },
  facts: {
    // Import specifiers that put a file in scope. Nothing else is analysed or sent.
    targets: new RegExp(${JSON.stringify(targets)}),
    // Uncomment and tune as checks need them:
    // contextImports: /^(openai|ai)$/,
    // trackMemberCalls: ["shutdown"],
    // trackProcessEvents: true,
    // flagProperties: ["hideInputs"],
  },
  checks,
});
`,
);
write(
  "src/index.ts",
  `import type { Plugin } from "@jev-oxlint/engine";
import { createPlugin } from "@jev-oxlint/engine";

import { linter } from "./linter.js";

const plugin: Plugin = createPlugin(linter);
export default plugin;
export { linter };
`,
);
write(
  "src/verify.ts",
  `import { verifyGuidance } from "@jev-oxlint/engine";\nimport { linter } from "./linter.js";\nconst r = verifyGuidance(linter);\nprocess.stdout.write(\`verify-guidance: \${r.checks} checks, \${r.files} files\\n\`);\n`,
);
write(
  "src/sync.ts",
  `import { syncSkills } from "@jev-oxlint/engine";\nimport { linter } from "./linter.js";\nconst r = syncSkills(linter);\nprocess.stdout.write(\`sync-skills: \${r.copied.length} files from \${r.sourceCommit.slice(0, 10)}\\n\`);\n`,
);
write(
  "src/checks/README.md",
  `# Checks

Each file exports one \`Check\` (see \`@jev-oxlint/engine\`). Start from \`jev-lint survey\`:
the guidance files with many relevant files and no check are the ones to write.
\`jev-lint propose --guidance skills/${skill}/references/<file>.md\` assembles the context
packet for drafting one. Put questions and thresholds first; they are what reviewers read.
`,
);
write("answer-key.json", "{}\n");
write("fixtures/.gitkeep", "");
write(
  ".oxlintrc.json",
  JSON.stringify(
    {
      jsPlugins: [{ name, specifier: "./dist/index.js" }],
      rules: { [`${name}/guidance`]: "warn" },
      ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    },
    null,
    2,
  ),
);
write(
  "README.md",
  `# ${pkgName}

A jev-powered oxlint linter built from the \`${skill}\` skill.

\`\`\`bash
pnpm install && pnpm build          # copies nothing yet; run sync-skills first
pnpm sync-skills && pnpm build      # copy skill files in, verify citations
TYPESAFE_API_KEY=… pnpm survey ./src   # which guidance applies to your code?
\`\`\`

With zero checks the linter already runs in **hint mode**: for each in-scope file it asks jev which
reference files apply and reports coarse deviations. Write checks under \`src/checks/\` to turn a hint
into a precise finding.
`,
);
// Copy the skill in now so the scaffold builds on first try.
cpSync(skillSource, path.join(dir, "skills", skill), { recursive: true });
console.log(
  `created ${dir} (skill ${skill} copied from ${skillSource})\n\n  cd ${dir} && pnpm install && pnpm build\n`,
);
