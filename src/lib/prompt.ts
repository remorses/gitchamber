/**
 * Prompt the user with a yes/no question (responds on keypress)
 */
export async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} (y/n): `);

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (data) => {
        process.stdin.pause();
        const normalized = data.toString().trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onKeypress = (key: string) => {
      if (key === "\u0003") {
        process.stdout.write("\n");
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKeypress);
        process.exit(130);
      }

      const lower = key.toLowerCase();

      if (lower === "y") {
        process.stdout.write("y\n");
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKeypress);
        resolve(true);
      } else if (lower === "n") {
        process.stdout.write("n\n");
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKeypress);
        resolve(false);
      }
    };

    process.stdin.on("data", onKeypress);
  });
}
