import { fileURLToPath } from "node:url";

/** Absolute path of `check.ts` as shipped in `dist/`, for tools that show the contract to a model or a person. */
export function checkContractPath(): string {
  return fileURLToPath(new URL("./check.contract.ts.txt", import.meta.url));
}
