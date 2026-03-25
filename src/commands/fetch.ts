import {
  detectInputType,
  parsePackageSpec,
  resolvePackage,
} from "../lib/registries/index.ts";
import { parseRepoSpec, resolveRepo } from "../lib/repo.ts";
import { detectInstalledVersion } from "../lib/version.ts";
import {
  fetchSource,
  fetchRepoSource,
  repoExists,
  packageRepoExists,
  listSources,
  getPackageInfo,
  getRepoInfo,
  getRepoRelativePath,
  getRepoDisplayName,
  type PackageEntry,
  type RepoEntry,
} from "../lib/git.ts";
import { ensureGitignore } from "../lib/gitignore.ts";
import { ensureTsconfigExclude } from "../lib/tsconfig-exclude.ts";
import { updateSourcesJson } from "../lib/sources.ts";
import {
  getFileModificationPermission,
  setFileModificationPermission,
} from "../lib/settings.ts";
import { confirm } from "../lib/prompt.ts";
import type { FetchResult, Registry } from "../types.ts";

export interface FetchOptions {
  cwd?: string;
  /** Override file modification permission: true = allow, false = deny, undefined = prompt */
  allowModifications?: boolean;
}

async function checkFileModificationPermission(
  cwd: string,
  cliOverride?: boolean,
): Promise<boolean> {
  if (cliOverride !== undefined) {
    await setFileModificationPermission(cliOverride, cwd);
    if (cliOverride) {
      console.log("✓ File modifications enabled (--modify)");
    } else {
      console.log("✗ File modifications disabled (--modify=false)");
    }
    return cliOverride;
  }

  const storedPermission = await getFileModificationPermission(cwd);
  if (storedPermission !== undefined) {
    return storedPermission;
  }

  console.log(
    "\ngitchamber can update the following files for better integration:",
  );
  console.log("  • .gitignore - add opensrc/ to ignore list");
  console.log("  • tsconfig.json - exclude opensrc/ from compilation\n");

  const allowed = await confirm("Allow gitchamber to modify these files?");

  await setFileModificationPermission(allowed, cwd);

  if (allowed) {
    console.log("✓ Permission granted - saved to opensrc/settings.json\n");
  } else {
    console.log("✗ Permission denied - saved to opensrc/settings.json\n");
  }

  return allowed;
}

function getRegistryLabel(registry: Registry): string {
  switch (registry) {
    case "npm":
      return "npm";
    case "pypi":
      return "PyPI";
    case "crates":
      return "crates.io";
  }
}

async function fetchRepoInput(
  spec: string,
  cwd: string,
): Promise<FetchResult> {
  const repoSpec = parseRepoSpec(spec);

  if (!repoSpec) {
    return {
      package: spec,
      version: "",
      path: "",
      success: false,
      error: `Invalid repository format: ${spec}`,
    };
  }

  const displayName = `${repoSpec.host}/${repoSpec.owner}/${repoSpec.repo}`;
  console.log(
    `\nFetching ${repoSpec.owner}/${repoSpec.repo} from ${repoSpec.host}...`,
  );

  try {
    if (repoExists(displayName, cwd)) {
      const existing = await getRepoInfo(displayName, cwd);
      if (existing && repoSpec.ref && existing.version === repoSpec.ref) {
        console.log(`  ✓ Already up to date (${repoSpec.ref})`);
        return {
          package: displayName,
          version: existing.version,
          path: getRepoRelativePath(displayName),
          success: true,
        };
      } else if (existing) {
        console.log(
          `  → Updating ${existing.version} → ${repoSpec.ref || "default branch"}`,
        );
      }
    }

    console.log(`  → Resolving repository...`);
    const resolved = await resolveRepo(repoSpec);
    console.log(`  → Found: ${resolved.repoUrl}`);
    console.log(`  → Ref: ${resolved.ref}`);

    console.log(`  → Cloning at ${resolved.ref}...`);
    const result = await fetchRepoSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: displayName,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
    };
  }
}

async function fetchPackageInput(
  spec: string,
  cwd: string,
): Promise<FetchResult> {
  const packageSpec = parsePackageSpec(spec);
  const { registry, name } = packageSpec;
  let { version } = packageSpec;

  const registryLabel = getRegistryLabel(registry);
  console.log(`\nFetching ${name} from ${registryLabel}...`);

  try {
    if (!version && registry === "npm") {
      const installedVersion = await detectInstalledVersion(name, cwd);
      if (installedVersion) {
        version = installedVersion;
        console.log(`  → Detected installed version: ${version}`);
      } else {
        console.log(`  → No installed version found, using latest`);
      }
    } else if (!version) {
      console.log(`  → Using latest version`);
    } else {
      console.log(`  → Using specified version: ${version}`);
    }

    const existingPkg = await getPackageInfo(name, cwd, registry);
    if (existingPkg && existingPkg.version === version) {
      console.log(`  ✓ Already up to date (${version})`);
      return {
        package: name,
        version: existingPkg.version,
        path: existingPkg.path,
        success: true,
        registry,
      };
    } else if (existingPkg) {
      console.log(
        `  → Updating ${existingPkg.version} → ${version || "latest"}`,
      );
    }

    console.log(`  → Resolving repository...`);
    const resolved = await resolvePackage({ registry, name, version });

    console.log(`  → Found: ${resolved.repoUrl}`);

    if (resolved.repoDirectory) {
      console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
    }

    if (packageRepoExists(resolved.repoUrl, cwd)) {
      console.log(`  → Repo already cloned, checking version...`);
    }

    console.log(`  → Cloning at ${resolved.gitTag}...`);
    const result = await fetchSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: name,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
      registry,
    };
  }
}

function mergeResults(
  existing: { packages: PackageEntry[]; repos: RepoEntry[] },
  results: FetchResult[],
): { packages: PackageEntry[]; repos: RepoEntry[] } {
  const now = new Date().toISOString();

  for (const result of results) {
    if (!result.success) continue;

    if (result.registry) {
      const idx = existing.packages.findIndex(
        (p) => p.name === result.package && p.registry === result.registry,
      );
      const entry: PackageEntry = {
        name: result.package,
        version: result.version,
        registry: result.registry,
        path: result.path,
        fetchedAt: now,
      };

      if (idx >= 0) {
        existing.packages[idx] = entry;
      } else {
        existing.packages.push(entry);
      }
    } else {
      const idx = existing.repos.findIndex((r) => r.name === result.package);
      const entry: RepoEntry = {
        name: result.package,
        version: result.version,
        path: result.path,
        fetchedAt: now,
      };

      if (idx >= 0) {
        existing.repos[idx] = entry;
      } else {
        existing.repos.push(entry);
      }
    }
  }

  return existing;
}

/**
 * Fetch source code for one or more packages or repositories
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const results: FetchResult[] = [];

  const canModifyFiles = await checkFileModificationPermission(
    cwd,
    options.allowModifications,
  );

  if (canModifyFiles) {
    const gitignoreUpdated = await ensureGitignore(cwd);
    if (gitignoreUpdated) {
      console.log("✓ Added opensrc/ to .gitignore");
    }

    const tsconfigUpdated = await ensureTsconfigExclude(cwd);
    if (tsconfigUpdated) {
      console.log("✓ Added opensrc/ to tsconfig.json exclude");
    }
  }

  for (const spec of packages) {
    const inputType = detectInputType(spec);

    if (inputType === "repo") {
      const result = await fetchRepoInput(spec, cwd);
      results.push(result);
    } else {
      const result = await fetchPackageInput(spec, cwd);
      results.push(result);
    }
  }

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(
    `\nDone: ${successful.length} succeeded, ${failed.length} failed`,
  );

  if (successful.length > 0) {
    console.log("\nSource code available at:");
    for (const result of successful) {
      console.log(`  ${result.package} → opensrc/${result.path}`);
    }
  }

  if (successful.length > 0) {
    const existingSources = await listSources(cwd);
    const mergedSources = mergeResults(existingSources, results);
    await updateSourcesJson(mergedSources, cwd);
  }

  return results;
}
