import { rm } from "fs/promises";
import { existsSync } from "fs";
import { getReposDir, listSources } from "../lib/git.ts";
import {
  updateSourcesJson,
  type PackageEntry,
  type RepoEntry,
} from "../lib/sources.ts";
import type { Registry } from "../types.ts";

export interface CleanOptions {
  cwd?: string;
  packages?: boolean;
  repos?: boolean;
  registry?: Registry;
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const cleanPackages =
    options.packages || (!options.packages && !options.repos);
  const cleanRepos =
    options.repos || (!options.packages && !options.repos && !options.registry);

  let packagesRemoved = 0;
  let reposRemoved = 0;

  const sources = await listSources(cwd);

  let remainingPackages: PackageEntry[] = [...sources.packages];
  let remainingRepos: RepoEntry[] = [...sources.repos];

  let packagesToRemove: PackageEntry[] = [];
  if (cleanPackages) {
    if (options.registry) {
      packagesToRemove = sources.packages.filter(
        (p) => p.registry === options.registry,
      );
      remainingPackages = sources.packages.filter(
        (p) => p.registry !== options.registry,
      );
    } else {
      packagesToRemove = sources.packages;
      remainingPackages = [];
    }
    packagesRemoved = packagesToRemove.length;
  }

  let reposToRemove: RepoEntry[] = [];
  if (cleanRepos) {
    reposToRemove = sources.repos;
    remainingRepos = [];
    reposRemoved = reposToRemove.length;
  }

  const extractRepoPath = (fullPath: string): string => {
    const parts = fullPath.split("/");
    if (parts.length >= 4 && parts[0] === "repos") {
      return parts.slice(0, 4).join("/");
    }
    return fullPath;
  };

  const packageRepoPaths = new Set(
    packagesToRemove.map((p) => extractRepoPath(p.path)),
  );
  const repoRepoPaths = new Set(reposToRemove.map((r) => r.path));
  const neededRepoPaths = new Set(
    remainingPackages.map((p) => extractRepoPath(p.path)),
  );
  const allRepoPaths = new Set([...packageRepoPaths, ...repoRepoPaths]);

  for (const repoPath of allRepoPaths) {
    if (!neededRepoPaths.has(repoPath)) {
      const fullPath = `${cwd}/opensrc/${repoPath}`;
      if (existsSync(fullPath)) {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
  }

  const reposDir = getReposDir(cwd);
  if (existsSync(reposDir)) {
    await cleanupEmptyDirs(reposDir);
  }

  if (cleanPackages) {
    if (options.registry) {
      console.log(
        `✓ Removed ${packagesRemoved} ${options.registry} package(s)`,
      );
    } else if (packagesRemoved > 0) {
      console.log(`✓ Removed ${packagesRemoved} package(s)`);
    } else {
      console.log("No packages to remove");
    }
  }

  if (cleanRepos) {
    if (reposRemoved > 0) {
      console.log(`✓ Removed ${reposRemoved} repo(s)`);
    } else {
      console.log("No repos to remove");
    }
  }

  const totalRemoved = packagesRemoved + reposRemoved;

  if (totalRemoved > 0) {
    await updateSourcesJson(
      { packages: remainingPackages, repos: remainingRepos },
      cwd,
    );
  }

  console.log(`\nCleaned ${totalRemoved} source(s)`);
}

async function cleanupEmptyDirs(dir: string): Promise<boolean> {
  const { readdir, rmdir } = await import("fs/promises");

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await cleanupEmptyDirs(`${dir}/${entry.name}`);
      }
    }

    const remaining = await readdir(dir);
    if (remaining.length === 0) {
      await rmdir(dir);
      return true;
    }
  } catch {}

  return false;
}
