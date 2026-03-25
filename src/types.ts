/**
 * Supported package registries
 */
export type Registry = "npm" | "pypi" | "crates";

export interface PackageInfo {
  name: string;
  version: string;
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
}

export interface RegistryResponse {
  name: string;
  "dist-tags": {
    latest: string;
    [key: string]: string;
  };
  versions: {
    [version: string]: PackageInfo;
  };
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
}

export interface ResolvedPackage {
  registry: Registry;
  name: string;
  version: string;
  repoUrl: string;
  repoDirectory?: string;
  gitTag: string;
}

export interface FetchResult {
  package: string;
  version: string;
  path: string;
  success: boolean;
  error?: string;
  registry?: Registry;
}

export interface InstalledPackage {
  name: string;
  version: string;
}

/**
 * Parsed repository specification
 */
export interface RepoSpec {
  host: string;
  owner: string;
  repo: string;
  ref?: string;
}

/**
 * Type of input: package (with ecosystem) or git repo
 */
export type InputType = "package" | "repo";

/**
 * Parsed package specification with registry
 */
export interface PackageSpec {
  registry: Registry;
  name: string;
  version?: string;
}

/**
 * Resolved repository information (for git repos)
 */
export interface ResolvedRepo {
  host: string;
  owner: string;
  repo: string;
  ref: string;
  repoUrl: string;
  displayName: string;
}
