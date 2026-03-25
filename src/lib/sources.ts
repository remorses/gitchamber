import { writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Registry } from "../types.ts";

const OPENSRC_DIR = "opensrc";
const SOURCES_FILE = "sources.json";

export interface PackageEntry {
  name: string;
  version: string;
  registry: Registry;
  path: string;
  fetchedAt: string;
}

export interface RepoEntry {
  name: string;
  version: string;
  path: string;
  fetchedAt: string;
}

export interface SourcesIndex {
  packages?: PackageEntry[];
  repos?: RepoEntry[];
  updatedAt: string;
}

/**
 * Update the sources.json file in opensrc/
 */
export async function updateSourcesJson(
  sources: {
    packages: PackageEntry[];
    repos: RepoEntry[];
  },
  cwd: string = process.cwd(),
): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  const sourcesPath = join(opensrcDir, SOURCES_FILE);

  if (sources.packages.length === 0 && sources.repos.length === 0) {
    if (existsSync(sourcesPath)) {
      const { rm } = await import("fs/promises");
      await rm(sourcesPath, { force: true });
    }
    return;
  }

  const index: SourcesIndex = {
    updatedAt: new Date().toISOString(),
  };

  if (sources.packages.length > 0) {
    index.packages = sources.packages.map((p) => ({
      name: p.name,
      version: p.version,
      registry: p.registry,
      path: p.path,
      fetchedAt: p.fetchedAt,
    }));
  }

  if (sources.repos.length > 0) {
    index.repos = sources.repos.map((r) => ({
      name: r.name,
      version: r.version,
      path: r.path,
      fetchedAt: r.fetchedAt,
    }));
  }

  await writeFile(sourcesPath, JSON.stringify(index, null, 2), "utf-8");
}
