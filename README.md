# gitchamber

Fetch source code for packages to give coding agents deeper context.

Downloads the full repository source for npm, PyPI, or crates.io packages (and GitHub/GitLab repos) into `node_modules/.gitchamber/` so agents can read the actual implementation, not just type declarations.

## Install

```bash
npm install -g gitchamber
```

## Usage

```bash
# npm packages
gitchamber zod
gitchamber @babel/core
gitchamber react@18.2.0

# PyPI packages
gitchamber pypi:requests
gitchamber pypi:flask==3.0.0

# crates.io
gitchamber crates:serde
gitchamber crates:tokio@1.35.0

# GitHub repos
gitchamber vercel/ai
gitchamber facebook/react#main
gitchamber https://github.com/denoland/deno
```

Source code ends up in `node_modules/.gitchamber/<host>/<owner>/<repo>/`.

## Commands

```bash
# Fetch one or more packages/repos
gitchamber zod react vercel/ai

# List everything that's been fetched
gitchamber list
gitchamber list --json

# Remove specific packages or repos
gitchamber remove zod
gitchamber rm vercel/ai

# Remove everything
gitchamber clean
gitchamber clean --npm      # only npm packages
gitchamber clean --repos    # only repos
```

## How it works

1. Resolves the package through its registry API (npm registry, PyPI JSON API, crates.io API)
2. Extracts the `repository` URL from the package metadata
3. Shallow-clones (`git clone --depth 1`) the repo at the matching version tag
4. Strips the `.git` directory to save space
5. Tracks everything in `node_modules/.gitchamber/sources.json`

For npm packages, gitchamber detects the installed version from `node_modules`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), or `package.json` -- so the source matches what you actually have installed.

## Why `node_modules/.gitchamber/`

Fork of [opensrc](https://github.com/vercel-labs/opensrc) that stores source code in `node_modules/.gitchamber/` instead of `opensrc/`.

Storing inside `node_modules/` is better because:

- **Already gitignored.** Every project already ignores `node_modules/`. No need to modify `.gitignore` or prompt the user for permission.
- **Vitest ignores it.** Vitest skips `node_modules/` by default. With `opensrc/`, test runners could pick up test files from fetched source code and try to run them.
- **TypeScript ignores it.** `tsc` skips `node_modules/` by default. No need to add `opensrc` to `tsconfig.json` exclude.
- **Other tools ignore it too.** Linters, formatters, bundlers, search indexers -- nearly every tool in the ecosystem already knows to skip `node_modules/`. Fetched source code is invisible to your toolchain by default.
- **No accidental commits.** You can't accidentally `git add` fetched source code because `node_modules/` is always ignored.

The `opensrc/` approach requires modifying `.gitignore`, `tsconfig.json`, and potentially other tool configs. `node_modules/.gitchamber/` needs zero configuration.

### Other changes from opensrc

- Removed all file modification logic (`.gitignore`, `tsconfig.json`, `AGENTS.md` editing)
- Removed the `--modify` flag and permission prompt
- Uses [goke](https://github.com/nicepkg/goke) instead of commander for the CLI framework
