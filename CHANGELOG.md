# Changelog

## 0.1.1

1. **Flatter directory structure** — source code is now stored at `node_modules/.gitchamber/<host>/<owner>/<repo>/` instead of the previous `node_modules/.gitchamber/repos/<host>/<owner>/<repo>/`

2. **Backward-compatible cleanup** — `remove` and `clean` correctly handle sources fetched with older versions that used the `repos/` prefix

## 0.1.0

1. **Initial release** — fetch source code for npm, PyPI, and crates.io packages into `node_modules/.gitchamber/` for agent context:

   ```bash
   gitchamber zod
   gitchamber pypi:requests
   gitchamber crates:serde
   gitchamber vercel/ai
   ```

2. **Automatic version detection** — for npm packages, detects the installed version from `node_modules`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, or `package.json` so fetched source matches what's actually installed

3. **Multi-registry support** — `npm:` (default), `pypi:`, `pip:`, `crates:`, `cargo:`, `rust:` prefixes

4. **GitHub and GitLab repos** — fetch any public repo by `owner/repo`, URL, or with a specific ref (`owner/repo#branch`, `owner/repo@tag`)

5. **Monorepo-aware** — reads `repository.directory` from npm package metadata to point directly at the package subdirectory

6. **`list`, `remove`, `clean` commands** — manage fetched sources tracked in `node_modules/.gitchamber/sources.json`

7. **Zero configuration** — stores everything in `node_modules/.gitchamber/` so git, vitest, tsc, and all other tools ignore it automatically without any `.gitignore` or `tsconfig.json` changes
