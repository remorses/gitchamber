#!/usr/bin/env node

import { goke } from "goke";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { fetchCommand } from "./commands/fetch.ts";
import { listCommand } from "./commands/list.ts";
import { removeCommand } from "./commands/remove.ts";
import { cleanCommand } from "./commands/clean.ts";
import type { Registry } from "./types.ts";

const cli = goke("gitchamber");

cli.option("--cwd <path>", z.string().describe("Working directory"));

cli
  .command("[...packages]", "Fetch source code for packages to give coding agents deeper context")
  .example("# Fetch an npm package")
  .example("gitchamber zod")
  .example("# Fetch a PyPI package")
  .example("gitchamber pypi:requests")
  .example("# Fetch a crates.io crate")
  .example("gitchamber crates:serde")
  .example("# Fetch a GitHub repo")
  .example("gitchamber vercel/ai")
  .action(async (packages, options) => {
    if (packages.length === 0) {
      cli.outputHelp();
      return;
    }

    await fetchCommand(packages, { cwd: options.cwd });
  });

cli
  .command("list", "List all fetched package sources")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    await listCommand({ json: options.json, cwd: options.cwd });
  });

cli
  .command("remove <...packages>", "Remove fetched source code for packages or repos")
  .alias("rm")
  .action(async (packages, options) => {
    await removeCommand(packages, { cwd: options.cwd });
  });

cli
  .command("clean", "Remove all fetched packages and/or repos")
  .option("--packages", "Only remove packages from all registries")
  .option("--repos", "Only remove repos")
  .option("--npm", "Only remove npm packages")
  .option("--pypi", "Only remove PyPI packages")
  .option("--crates", "Only remove crates.io packages")
  .action(async (options) => {
    let registry: Registry | undefined;
    if (options.npm) registry = "npm";
    else if (options.pypi) registry = "pypi";
    else if (options.crates) registry = "crates";

    await cleanCommand({
      packages: options.packages || !!registry,
      repos: options.repos,
      registry,
      cwd: options.cwd,
    });
  });

cli.help();
cli.version(pkg.version);
cli.parse();
