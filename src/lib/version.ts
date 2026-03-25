import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { InstalledPackage } from "../types.ts";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version: string }>;
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^[\^~>=<]+/, "");
}

async function getVersionFromNodeModules(
  packageName: string,
  cwd: string,
): Promise<string | null> {
  const packageJsonPath = join(cwd, "node_modules", packageName, "package.json");

  if (!existsSync(packageJsonPath)) return null;

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version || null;
  } catch {
    return null;
  }
}

async function getVersionFromPackageLock(
  packageName: string,
  cwd: string,
): Promise<string | null> {
  const lockPath = join(cwd, "package-lock.json");

  if (!existsSync(lockPath)) return null;

  try {
    const content = await readFile(lockPath, "utf-8");
    const lock = JSON.parse(content) as PackageLockJson;

    if (lock.packages) {
      const key = `node_modules/${packageName}`;
      if (lock.packages[key]?.version) {
        return lock.packages[key].version;
      }
    }

    if (lock.dependencies?.[packageName]?.version) {
      return lock.dependencies[packageName].version;
    }

    return null;
  } catch {
    return null;
  }
}

async function getVersionFromPnpmLock(
  packageName: string,
  cwd: string,
): Promise<string | null> {
  const lockPath = join(cwd, "pnpm-lock.yaml");

  if (!existsSync(lockPath)) return null;

  try {
    const content = await readFile(lockPath, "utf-8");
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`['"]?${escapedName}@([^(':"\\s)]+)`, "g");
    const matches = [...content.matchAll(regex)];

    if (matches.length > 0) {
      return matches[0]![1]!;
    }

    return null;
  } catch {
    return null;
  }
}

async function getVersionFromYarnLock(
  packageName: string,
  cwd: string,
): Promise<string | null> {
  const lockPath = join(cwd, "yarn.lock");

  if (!existsSync(lockPath)) return null;

  try {
    const content = await readFile(lockPath, "utf-8");
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `"?${escapedName}@[^":\\n]+[":]?\\s*\\n\\s*version\\s+["']?([^"'\\n]+)`,
      "g",
    );
    const matches = [...content.matchAll(regex)];

    if (matches.length > 0) {
      return matches[0]![1]!;
    }

    return null;
  } catch {
    return null;
  }
}

async function getVersionFromPackageJson(
  packageName: string,
  cwd: string,
): Promise<string | null> {
  const packageJsonPath = join(cwd, "package.json");

  if (!existsSync(packageJsonPath)) return null;

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as PackageJson;

    const version =
      pkg.dependencies?.[packageName] ||
      pkg.devDependencies?.[packageName] ||
      pkg.peerDependencies?.[packageName];

    if (version) {
      return stripVersionPrefix(version);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the installed version of a package.
 * Priority: node_modules > lockfile > package.json
 */
export async function detectInstalledVersion(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<string | null> {
  const nodeModulesVersion = await getVersionFromNodeModules(packageName, cwd);
  if (nodeModulesVersion) return nodeModulesVersion;

  const packageLockVersion = await getVersionFromPackageLock(packageName, cwd);
  if (packageLockVersion) return packageLockVersion;

  const pnpmLockVersion = await getVersionFromPnpmLock(packageName, cwd);
  if (pnpmLockVersion) return pnpmLockVersion;

  const yarnLockVersion = await getVersionFromYarnLock(packageName, cwd);
  if (yarnLockVersion) return yarnLockVersion;

  const packageJsonVersion = await getVersionFromPackageJson(packageName, cwd);
  if (packageJsonVersion) return packageJsonVersion;

  return null;
}

/**
 * List all dependencies from package.json
 */
export async function listDependencies(
  cwd: string = process.cwd(),
): Promise<InstalledPackage[]> {
  const packageJsonPath = join(cwd, "package.json");

  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as PackageJson;

    const deps: InstalledPackage[] = [];
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, version] of Object.entries(allDeps)) {
      deps.push({ name, version: stripVersionPrefix(version) });
    }

    return deps;
  } catch {
    return [];
  }
}
