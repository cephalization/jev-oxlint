import path from "node:path";

export interface DependencyOptions {
  workspace: boolean;
  localRepo?: string;
}

export function dependencySpecs(options: DependencyOptions): { engine: string; author: string } {
  if (options.workspace && options.localRepo)
    throw new Error("use either --workspace or --local-repo, not both");
  if (options.workspace) return { engine: "workspace:*", author: "workspace:*" };
  if (options.localRepo) {
    const repo = path.resolve(options.localRepo);
    return {
      engine: `link:${path.join(repo, "packages", "engine")}`,
      author: `link:${path.join(repo, "packages", "author")}`,
    };
  }
  return { engine: "^0.1.0", author: "^0.1.0" };
}
