/* -----------------------------------------------------------------------
   Cloudflare Worker + Durable Object (SQLite) in one file
   -------------------------------------------------------------------- */

import { parseTar } from "@mjackson/tar-parser";
import { DurableObject } from "cloudflare:workers";

/* ---------- ENV interface ---------------------------- */

interface Env {
  REPO_CACHE: DurableObjectNamespace;
  GITHUB_TOKEN?: string;
  CACHE_TTL_MS?: string; // e.g. "21600000" (6 h)
}

/* ======================================================================
   Durable Object: per‑repo cache
   ==================================================================== */
export class RepoCache extends DurableObject {
  private sql: SqlStorage;
  private ttl: number;
  private owner?: string;
  private repo?: string;
  private branch?: string;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.ttl = Number(env.CACHE_TTL_MS ?? 21_600_000); // 6 h default

    /* one‑time schema */
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path          TEXT PRIMARY KEY,
        content       TEXT,
        firstFetched  INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts
        USING fts5(path, content, tokenize = 'porter');
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, val TEXT);
    `);
  }

  async getFiles(params: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<Response> {
    this.owner = params.owner;
    this.repo = params.repo;
    this.branch = params.branch;

    await this.ensureFresh();
    const rows = [...this.sql.exec("SELECT path FROM files ORDER BY path")];
    return json(rows.map((r) => r.path));
  }

  async getFile(params: {
    owner: string;
    repo: string;
    branch: string;
    filePath: string;
    showLineNumbers?: boolean;
    start?: number;
    end?: number;
  }): Promise<Response> {
    this.owner = params.owner;
    this.repo = params.repo;
    this.branch = params.branch;

    await this.ensureFresh();
    const results = [
      ...this.sql.exec(
        "SELECT content FROM files WHERE path = ?",
        params.filePath,
      ),
    ];
    const row = results.length > 0 ? results[0] : null;

    if (!row) {
      return notFound();
    }

    const content = row.content as string;

    // Apply line formatting if any formatting options are specified
    if (
      params.showLineNumbers ||
      params.start !== undefined ||
      params.end !== undefined
    ) {
      const formatted = formatFileWithLines(
        content,
        params.showLineNumbers || false,
        params.start,
        params.end,
      );
      return new Response(formatted, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // Return raw text content
    return new Response(content, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  async searchFiles(params: {
    owner: string;
    repo: string;
    branch: string;
    query: string;
  }): Promise<Response> {
    this.owner = params.owner;
    this.repo = params.repo;
    this.branch = params.branch;

    await this.ensureFresh();
    const searchQuery = decodeURIComponent(params.query);

    // Get both snippet and full content to find line numbers
    // SQLite snippet() extracts text around matches: snippet(table, column, start_mark, end_mark, ellipsis, max_tokens)
    // -1 means use all columns, '' for no highlighting marks, '...' as ellipsis, 64 max tokens
    const rows = [
      ...this.sql.exec(
        `SELECT
          files.path,
          files.content,
          snippet(files_fts, -1, '', '', '...', 64) as snippet
        FROM files_fts
        JOIN files ON files.path = files_fts.path
        WHERE files_fts MATCH ?
        ORDER BY rank`,
        searchQuery,
      ),
    ];

    return json(
      rows.map((r) => {
        const content = r.content as string;
        // Remove HTML markup and clean up snippet
        const snippet = (r.snippet as string).replace(/<\/?mark>/g, "");

        // Remove ... only from start/end of snippet before searching for line numbers
        const cleanSnippet = snippet.replace(/^\.\.\.|\.\.\.$/, "");
        const lineNumber = findLineNumberInContent(content, cleanSnippet);

        // Create gitchamber.com URL
        const url = `https://gitchamber.com/repos/${params.owner}/${params.repo}/${params.branch}/file/${r.path}${lineNumber ? `?start=${lineNumber}` : ""}`;

        return {
          snippet,
          url,
          lineNumber,
        };
      }),
    );
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh() {
    const results = [
      ...this.sql.exec("SELECT val FROM meta WHERE key = 'lastFetched'"),
    ];
    const meta = results.length > 0 ? results[0] : null;
    const last = meta ? Number(meta.val) : 0;
    if (Date.now() - last < this.ttl) return; // still fresh

    await this.ctx.blockConcurrencyWhile(() => this.populate());
  }

  private async populate() {
    if (!this.owner || !this.repo || !this.branch) {
      throw new Error(
        "Repository parameters (owner, repo, branch) are required for populate",
      );
    }

    // Use direct GitHub archive URL - no authentication required
    const url = `https://github.com/${this.owner}/${this.repo}/archive/${this.branch}.tar.gz`;
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error(
        `GitHub archive fetch failed (${r.status}) for ${this.owner}/${this.repo}/${this.branch}. URL: ${url}`,
      );
    }

    /* freshen: clear existing rows to avoid orphans */
    this.sql.exec("DELETE FROM files");
    this.sql.exec("DELETE FROM files_fts");

    const startTime = Date.now();

    const gz = r.body!.pipeThrough(new DecompressionStream("gzip"));
    await parseTar(gz, async (ent) => {
      if (ent.header.type !== "file") return;
      const rel = ent.name.split("/").slice(1).join("/");
      const buf = await ent.arrayBuffer();

      /* only store text files under 1MB */
      if (buf.byteLength < 1_000_000) {
        try {
          const txt = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: false,
          }).decode(buf);
          // Store as text
          this.sql.exec(
            "INSERT INTO files VALUES (?,?,?)",
            rel,
            txt,
            Date.now(),
          );
          // Index for FTS
          this.sql.exec(
            "INSERT INTO files_fts(path,content) VALUES (?,?)",
            rel,
            txt,
          );
        } catch {
          // Skip binary files
        }
      }
      // Skip large files
    });

    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;

    console.log(`Data save completed in ${durationSeconds} seconds`);

    this.sql.exec(
      "INSERT OR REPLACE INTO meta VALUES ('lastFetched',?)",
      Date.now(),
    );
  }
}

/* ======================================================================
   Main Worker: route to the correct Durable Object
   ==================================================================== */

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse route: /repos/:owner/:repo/:branch/...
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts.length < 4 || pathParts[0] !== "repos") {
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  const [, owner, repo, branch, ...rest] = pathParts;
  const id = env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
  const stub = env.REPO_CACHE.get(id) as any as RepoCache;

  try {
    if (rest.length === 1 && rest[0] === "files") {
      // /repos/:owner/:repo/:branch/files
      return addCorsHeaders(
        await stub.getFiles({ owner, repo, branch }),
        corsHeaders,
      );
    } else if (rest.length >= 2 && rest[0] === "file") {
      // /repos/:owner/:repo/:branch/file/*
      const filePath = rest.slice(1).join("/");
      const showLineNumbers =
        url.searchParams.get("showLineNumbers") === "true";
      const start = url.searchParams.get("start")
        ? parseInt(url.searchParams.get("start")!)
        : undefined;
      const end = url.searchParams.get("end")
        ? parseInt(url.searchParams.get("end")!)
        : undefined;

      // If only start is provided, default to showing 50 lines
      const finalEnd =
        start !== undefined && end === undefined ? start + 49 : end;

      return addCorsHeaders(
        await stub.getFile({
          owner,
          repo,
          branch,
          filePath,
          showLineNumbers,
          start,
          end: finalEnd,
        }),
        corsHeaders,
      );
    } else if (rest.length >= 2 && rest[0] === "search") {
      // /repos/:owner/:repo/:branch/search/:query
      const query = rest.slice(1).join("/");
      return addCorsHeaders(
        await stub.searchFiles({ owner, repo, branch, query }),
        corsHeaders,
      );
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error("Error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: corsHeaders,
    });
  }
}

function addCorsHeaders(
  response: Response,
  corsHeaders: Record<string, string>,
): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  fetch: handleRequest,
};

/* ---------- tiny helpers ------------------ */
const json = (x: unknown) =>
  new Response(JSON.stringify(x, null, 2), {
    headers: { "content-type": "application/json" },
  });
const notFound = () => new Response("Not found", { status: 404 });

function findLineNumberInContent(
  content: string,
  searchSnippet: string,
): number | null {
  try {
    if (!content) {
      throw new Error("Content to search snippet is empty");
    }
    // Find the snippet in the content (case-sensitive, multi-line matching)
    const index = content.indexOf(searchSnippet);

    if (index === -1) {
      return null;
    }

    // Count newlines before the found index to determine line number
    const beforeMatch = content.substring(0, index);
    const lineNumber = beforeMatch.split('\n').length;

    return lineNumber;
  } catch(e) {
    console.error("Error finding line number:", e);
    return null;
  }
}

function formatFileWithLines(
  contents: string,
  showLineNumbers: boolean,
  startLine?: number,
  endLine?: number,
): string {
  const lines = contents.split("\n");

  // Filter lines by range if specified
  const filteredLines = (() => {
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine ? Math.max(0, startLine - 1) : 0; // Convert to 0-based index, ensure non-negative
      const end = endLine ? Math.min(endLine, lines.length) : lines.length; // Don't exceed file length
      return lines.slice(start, end);
    }
    return lines;
  })();

  // Check if content is truncated
  const actualStart = startLine ? Math.max(0, startLine - 1) : 0;
  const actualEnd = endLine ? Math.min(endLine, lines.length) : lines.length;
  const hasContentAbove = actualStart > 0;
  const hasContentBelow = actualEnd < lines.length;

  // Show line numbers if requested or if line ranges are specified
  const shouldShowLineNumbers =
    showLineNumbers || startLine !== undefined || endLine !== undefined;

  // Add line numbers if requested
  if (shouldShowLineNumbers) {
    const startLineNumber = startLine || 1;
    const maxLineNumber = startLineNumber + filteredLines.length - 1;
    const padding = maxLineNumber.toString().length;

    const formattedLines = filteredLines.map((line, index) => {
      const lineNumber = startLineNumber + index;
      const paddedNumber = lineNumber.toString().padStart(padding, " ");
      return `${paddedNumber}  ${line}`;
    });

    // Add end of file indicator if at the end
    const result: string[] = [];
    result.push(...formattedLines);
    if (!hasContentBelow) {
      result.push("end of file");
    }

    return result.join("\n");
  }

  // For non-line-numbered output, also add end of file indicator
  const result: string[] = [];
  result.push(...filteredLines);
  if (!hasContentBelow) {
    result.push("end of file");
  }

  return result.join("\n");
}
