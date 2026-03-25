import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const OPENSRC_ENTRY = "opensrc/";
const MARKER_COMMENT = "# opensrc - source code for packages";

export async function hasOpensrcEntry(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const gitignorePath = join(cwd, ".gitignore");

  if (!existsSync(gitignorePath)) return false;

  try {
    const content = await readFile(gitignorePath, "utf-8");
    const lines = content.split("\n");

    return lines.some((line) => {
      const trimmed = line.trim();
      return trimmed === OPENSRC_ENTRY || trimmed === "opensrc";
    });
  } catch {
    return false;
  }
}

export async function ensureGitignore(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const gitignorePath = join(cwd, ".gitignore");

  if (await hasOpensrcEntry(cwd)) return false;

  let content = "";

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, "utf-8");
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    if (content.trim().length > 0) {
      content += "\n";
    }
  }

  content += `${MARKER_COMMENT}\n${OPENSRC_ENTRY}\n`;

  await writeFile(gitignorePath, content, "utf-8");
  return true;
}

export async function removeFromGitignore(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const gitignorePath = join(cwd, ".gitignore");

  if (!existsSync(gitignorePath)) return false;

  try {
    const content = await readFile(gitignorePath, "utf-8");
    const lines = content.split("\n");

    const newLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed !== OPENSRC_ENTRY &&
        trimmed !== "opensrc" &&
        trimmed !== MARKER_COMMENT
      );
    });

    const cleanedLines: string[] = [];
    let prevWasBlank = false;
    for (const line of newLines) {
      const isBlank = line.trim() === "";
      if (isBlank && prevWasBlank) continue;
      cleanedLines.push(line);
      prevWasBlank = isBlank;
    }

    const newContent = cleanedLines.join("\n");

    if (newContent !== content) {
      await writeFile(gitignorePath, newContent, "utf-8");
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
