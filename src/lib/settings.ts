import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const OPENSRC_DIR = "opensrc";
const SETTINGS_FILE = "settings.json";

export interface OpensrcSettings {
  allowFileModifications?: boolean;
}

function getSettingsPath(cwd: string): string {
  return join(cwd, OPENSRC_DIR, SETTINGS_FILE);
}

async function ensureOpensrcDir(cwd: string): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  if (!existsSync(opensrcDir)) {
    await mkdir(opensrcDir, { recursive: true });
  }
}

export async function readSettings(
  cwd: string = process.cwd(),
): Promise<OpensrcSettings> {
  const settingsPath = getSettingsPath(cwd);

  if (!existsSync(settingsPath)) return {};

  try {
    const content = await readFile(settingsPath, "utf-8");
    return JSON.parse(content) as OpensrcSettings;
  } catch {
    return {};
  }
}

export async function writeSettings(
  settings: OpensrcSettings,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureOpensrcDir(cwd);
  const settingsPath = getSettingsPath(cwd);
  await writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8",
  );
}

export async function getFileModificationPermission(
  cwd: string = process.cwd(),
): Promise<boolean | undefined> {
  const settings = await readSettings(cwd);
  return settings.allowFileModifications;
}

export async function setFileModificationPermission(
  allowed: boolean,
  cwd: string = process.cwd(),
): Promise<void> {
  const settings = await readSettings(cwd);
  settings.allowFileModifications = allowed;
  await writeSettings(settings, cwd);
}
