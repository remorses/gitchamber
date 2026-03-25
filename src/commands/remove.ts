import {
  removePackageSource,
  removeRepoSource,
  repoExists,
  listSources,
  getPackageInfo,
} from "../lib/git.ts";
import {
  updateSourcesJson,
  type PackageEntry,
  type RepoEntry,
} from "../lib/sources.ts";
import { isRepoSpec } from "../lib/repo.ts";
import { detectRegistry } from "../lib/registries/index.ts";
import type { Registry } from "../types.ts";

export interface RemoveOptions {
  cwd?: string;
}

export async function removeCommand(
  items: string[],
  options: RemoveOptions = {},
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  let removed = 0;
  let notFound = 0;

  const removedPackages: Array<{ name: string; registry: Registry }> = [];
  const removedRepos: string[] = [];

  for (const item of items) {
    const isRepo =
      isRepoSpec(item) || (item.includes("/") && !item.includes(":"));

    if (isRepo) {
      let displayName = item;
      if (item.split("/").length === 2 && !item.startsWith("http")) {
        displayName = `github.com/${item}`;
      }

      if (!repoExists(displayName, cwd)) {
        if (repoExists(item, cwd)) {
          displayName = item;
        } else {
          console.log(`  ⚠ ${item} not found`);
          notFound++;
          continue;
        }
      }

      const success = await removeRepoSource(displayName, cwd);

      if (success) {
        console.log(`  ✓ Removed ${displayName}`);
        removed++;
        removedRepos.push(displayName);
      } else {
        console.log(`  ✗ Failed to remove ${displayName}`);
      }
    } else {
      const { registry, cleanSpec } = detectRegistry(item);

      let pkgInfo = await getPackageInfo(cleanSpec, cwd, registry);
      let actualRegistry = registry;

      if (!pkgInfo) {
        const registries: Registry[] = ["npm", "pypi", "crates"];
        for (const reg of registries) {
          if (reg !== registry) {
            pkgInfo = await getPackageInfo(cleanSpec, cwd, reg);
            if (pkgInfo) {
              actualRegistry = reg;
              break;
            }
          }
        }
      }

      if (!pkgInfo) {
        console.log(`  ⚠ ${cleanSpec} not found`);
        notFound++;
        continue;
      }

      const result = await removePackageSource(cleanSpec, cwd, actualRegistry);

      if (result.removed) {
        console.log(`  ✓ Removed ${cleanSpec} (${actualRegistry})`);
        if (result.repoRemoved) {
          console.log(`    → Also removed repo (no other packages use it)`);
        }
        removed++;
        removedPackages.push({ name: cleanSpec, registry: actualRegistry });
      } else {
        console.log(`  ✗ Failed to remove ${cleanSpec}`);
      }
    }
  }

  console.log(
    `\nRemoved ${removed} source(s)${notFound > 0 ? `, ${notFound} not found` : ""}`,
  );

  if (removed > 0) {
    const sources = await listSources(cwd);

    const remainingPackages: PackageEntry[] = sources.packages.filter(
      (p) =>
        !removedPackages.some(
          (rp) => rp.name === p.name && rp.registry === p.registry,
        ),
    );

    const remainingRepos: RepoEntry[] = sources.repos.filter(
      (r) => !removedRepos.includes(r.name),
    );

    await updateSourcesJson(
      { packages: remainingPackages, repos: remainingRepos },
      cwd,
    );
  }
}
