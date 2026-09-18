import type { Plugin } from "@jev-oxlint/engine";
import { createPlugin } from "@jev-oxlint/engine";

import { linter } from "./linter.js";

const plugin: Plugin = createPlugin(linter);

export default plugin;
export { linter };
