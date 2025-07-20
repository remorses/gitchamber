/* -----------------------------------------------------------------------
   Cloudflare Worker + Durable Object (SQLite) in one file
   -------------------------------------------------------------------- */

import { Spiceflow } from "spiceflow";
import { cors } from "spiceflow/cors";
import { openapi } from "spiceflow/openapi";
import { parseTar } from "@mjackson/tar-parser";
import { z } from "zod";

/* ---------- ENV interface ---------------------------- */

interface Env {
  REPO_CACHE: DurableObjectNamespace;
  GITHUB_TOKEN?: string;
  CACHE_TTL_MS?: string; // e.g. "21600000" (6 h)
}

/* ======================================================================
   Durable Object: per‑repo cache
   ==================================================================== */
export class RepoCache {
  private sql: SqlStorage;
  private ctx: DurableObjectState;
  private env: Env;
  private ttl: number;
  private owner?: string;
  private repo?: string;
  private branch?: string;

  constructor(state: DurableObjectState, env: Env) {
    this.ctx = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.ttl = Number(env.CACHE_TTL_MS ?? 21_600_000); // 6 h default

    /* one‑time schema */
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path          TEXT PRIMARY KEY,
        content       BLOB,
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

    try {
      const content = new TextDecoder().decode(row.content as ArrayBuffer);
      
      // Apply line formatting if any formatting options are specified
      if (params.showLineNumbers || params.start !== undefined || params.end !== undefined) {
        const formatted = formatFileWithLines(
          content,
          params.showLineNumbers || false,
          params.start,
          params.end
        );
        return new Response(formatted, {
          headers: { "content-type": "text/plain" }
        });
      }
      
      // Return raw content
      return new Response(content, {
        headers: { "content-type": "text/plain" }
      });
    } catch {
      // Binary file - return as-is
      return new Response(row.content as BodyInit);
    }
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
    const rows = [
      ...this.sql.exec(
        `SELECT
          files.path,
          files.content,
          snippet(files_fts, -1, '<mark>', '</mark>', '...', 64) as snippet
        FROM files_fts
        JOIN files ON files.path = files_fts.path
        WHERE files_fts MATCH ?
        ORDER BY rank`,
        searchQuery,
      ),
    ];

    return json(
      rows.map((r) => {
        const content = new TextDecoder().decode(r.content as ArrayBuffer);
        const snippet = r.snippet as string;
        
        // Find line number where the match occurs
        const lineNumber = findLineNumberInContent(content, searchQuery);
        
        // Create gitchamber.com URL
        const url = `https://gitchamber.com/repos/${params.owner}/${params.repo}/${params.branch}/file/${r.path}${lineNumber ? `?start=${lineNumber}` : ''}`;
        
        return {
          path: r.path,
          snippet,
          url,
          lineNumber
        };
      }),
    );
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const owner = url.searchParams.get("owner")!;
    const repo = url.searchParams.get("repo")!;
    const branch = url.searchParams.get("branch")!;

    if (url.pathname === "/files") {
      return this.getFiles({ owner, repo, branch });
    } else if (url.pathname.startsWith("/file/")) {
      const filePath = url.pathname.slice(6); // Remove "/file/"
      const showLineNumbers = url.searchParams.get("showLineNumbers") === "true";
      const start = url.searchParams.get("start") ? parseInt(url.searchParams.get("start")!) : undefined;
      const end = url.searchParams.get("end") ? parseInt(url.searchParams.get("end")!) : undefined;
      
      // If only start is provided, default to showing 50 lines
      const finalEnd = start !== undefined && end === undefined ? start + 49 : end;
      
      return this.getFile({ 
        owner, 
        repo, 
        branch, 
        filePath, 
        showLineNumbers,
        start,
        end: finalEnd
      });
    } else if (url.pathname.startsWith("/search/")) {
      const query = url.pathname.slice(8); // Remove "/search/"
      return this.searchFiles({ owner, repo, branch, query });
    }

    return new Response("Not found", { status: 404 });
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh() {
    const results = [
      ...this.sql.exec("SELECT val FROM meta WHERE key = 'lastFetched'"),
    ];
    const meta = results.length > 0 ? results[0] : null;
    const last = meta ? Number(meta.val) : 0;
    if (Date.now() - last < this.ttl) return; // still fresh

    /* avoid duplicate concurrent populates */
    if (this.ctx.blockConcurrencyWhile)
      await this.ctx.blockConcurrencyWhile(() => this.populate());
    else await this.populate(); // older runtimes
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

      this.sql.exec("INSERT INTO files VALUES (?,?,?)", rel, buf, Date.now());

      /* index small text for FTS */
      if (buf.byteLength < 1_000_000) {
        try {
          const txt = new TextDecoder().decode(buf);
          this.sql.exec(
            "INSERT INTO files_fts(path,content) VALUES (?,?)",
            rel,
            txt,
          );
        } catch {
          /* binary */
        }
      }
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

const workerRouter = new Spiceflow()
  .state("env", {} as Env)
  .use(cors())
  .use(openapi({ path: "/openapi.json" }))
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/files",
    handler: async ({ params, state }) => {
      const { owner, repo, branch } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);
      const doUrl = new URL("https://repo/files");
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      return stub.fetch(new Request(doUrl.toString()));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/file/*",
    handler: async ({ params, state }) => {
      const { owner, repo, branch, "*": filePath } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);
      const doUrl = new URL(`https://repo/file/${filePath}`);
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      return stub.fetch(new Request(doUrl.toString()));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/search/:query",
    handler: async ({ params, state }) => {
      const { owner, repo, branch, query } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);
      const doUrl = new URL(`https://repo/search/${encodeURIComponent(query)}`);
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      return stub.fetch(new Request(doUrl.toString()));
    },
  });

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    workerRouter.handle(req, { state: { env } }),
};

/* ---------- tiny helpers ------------------ */
const json = (x: unknown) =>
  new Response(JSON.stringify(x, null, 2), {
    headers: { "content-type": "application/json" },
  });
const notFound = () => new Response("Not found", { status: 404 });

function findLineNumberInContent(content: string, searchQuery: string): number | null {
  try {
    const lines = content.split('\n');
    
    // Simple search - find first line containing the search term
    // This is a basic implementation; could be enhanced with regex matching
    const searchTerm = searchQuery.toLowerCase();
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchTerm)) {
        return i + 1; // Return 1-based line number
      }
    }
    
    return null;
  } catch {
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
