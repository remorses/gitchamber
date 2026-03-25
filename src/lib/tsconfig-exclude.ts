import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const OPENSRC_DIR = "opensrc";

interface TsConfig {
  exclude?: string[];
  [key: string]: unknown;
}

export function hasTsConfig(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, "tsconfig.json"));
}

export async function hasOpensrcExclude(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const tsconfigPath = join(cwd, "tsconfig.json");

  if (!existsSync(tsconfigPath)) return false;

  try {
    const content = await readFile(tsconfigPath, "utf-8");
    const config = JSON.parse(content) as TsConfig;

    if (!config.exclude) return false;

    return config.exclude.some(
      (entry) =>
        entry === OPENSRC_DIR ||
        entry === `${OPENSRC_DIR}/` ||
        entry === `./${OPENSRC_DIR}`,
    );
  } catch {
    return false;
  }
}

export async function ensureTsconfigExclude(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const tsconfigPath = join(cwd, "tsconfig.json");

  if (!existsSync(tsconfigPath)) return false;

  if (await hasOpensrcExclude(cwd)) return false;

  try {
    const content = await readFile(tsconfigPath, "utf-8");
    const config = JSON.parse(content) as TsConfig;

    if (!config.exclude) {
      config.exclude = [];
    }

    config.exclude.push(OPENSRC_DIR);

    await writeFile(
      tsconfigPath,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
    return true;
  } catch {
    return false;
  }
}
