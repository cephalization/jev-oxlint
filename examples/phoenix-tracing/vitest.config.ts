import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { exclude: ["dist/**", "node_modules/**", "fixtures/**"], testTimeout: 60_000 },
});
