/* -----------------------------------------------------------------------
   Cloudflare Worker + Durable Object (SQLite) in one file
   -------------------------------------------------------------------- */

import { McpAgent } from "agents/mcp";

import { parseTar } from "@xmorse/tar-parser";
import { DurableObject } from "cloudflare:workers";
import { Spiceflow } from "spiceflow";
import { cors } from "spiceflow/cors";
import { openapi } from "spiceflow/openapi";
import { mcp, addMcpTools } from "spiceflow/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/* ---------- Global constants ------------------------- */

const ENABLE_FTS = false; // Set to true to enable full-text search indexing

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
    if (ENABLE_FTS) {
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
    } else {
      // Optimized for fast inserts - no additional indexes on content
      // The PRIMARY KEY on path provides fast path searches
      // Content searches use table scan with LIKE (acceptable trade-off for fast inserts)
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS files (
          path          TEXT PRIMARY KEY,
          content       TEXT,
          firstFetched  INTEGER
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, val TEXT);


      `);
    }
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

    let rows: any[];

    if (ENABLE_FTS) {
      // Use FTS when enabled
      // SQLite snippet() extracts text around matches: snippet(table, column, start_mark, end_mark, ellipsis, max_tokens)
      // -1 means use all columns, '' for no highlighting marks, '...' as ellipsis, 64 max tokens
      rows = [
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
    } else {
      // Use LIKE queries when FTS is disabled
      // Search in both path and content, case-insensitive
      const likePattern = `%${searchQuery}%`;
      rows = [
        ...this.sql.exec(
          `SELECT
            path,
            content,
            NULL as snippet
          FROM files
          WHERE path LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE
          ORDER BY
            CASE
              WHEN path LIKE ? COLLATE NOCASE THEN 0
              ELSE 1
            END,
            path`,
          likePattern,
          likePattern,
          likePattern,
        ),
      ];
    }

    const results = rows.map((r) => {
      const content = r.content as string;
      let snippet: string;

      if (ENABLE_FTS) {
        // Remove HTML markup and clean up snippet from FTS
        snippet = (r.snippet as string).replace(/<\/?mark>/g, "");
      } else {
        // Extract snippet for LIKE search
        snippet = extractSnippetFromContent(content, searchQuery);
      }

      // Remove ... only from start/end of snippet before searching for line numbers
      const cleanSnippet = snippet.replace(/^\.\.\.|\.\.\.$/, "");
      const lineNumber = findLineNumberInContent(content, cleanSnippet);

      // Create gitchamber.com URL
      const url = `https://gitchamber.com/repos/${params.owner}/${params.repo}/${params.branch}/file/${r.path}${lineNumber ? `?start=${lineNumber}` : ""}`;

      return {
        path: r.path as string,
        snippet,
        url,
        lineNumber,
      };
    });

    const markdown = formatSearchResultsAsMarkdown(results);
    return new Response(markdown, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh() {
    const results = [
      ...this.sql.exec("SELECT val FROM meta WHERE key = 'lastFetched'"),
    ];
    const meta = results.length > 0 ? results[0] : null;
    const last = meta ? Number(meta.val) : 0;
    if (Date.now() - last < this.ttl) {
      return;
    }

    // Return indicator that refresh is needed
    throw new Error("NEEDS_REFRESH");
  }

  async alarm() {
    console.log("Alarm triggered - checking if repo data should be deleted");

    const results = [
      ...this.sql.exec("SELECT val FROM meta WHERE key = 'lastFetched'"),
    ];
    const meta = results.length > 0 ? results[0] : null;
    const lastFetched = meta ? Number(meta.val) : 0;

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    if (lastFetched < oneDayAgo) {
      console.log("Deleting repo data - not accessed in over 24 hours");
      this.sql.exec("DELETE FROM files");
      this.sql.exec("DELETE FROM files_fts");
      this.sql.exec("DELETE FROM meta");

      await this.ctx.storage.deleteAlarm();
      console.log("Repo data deleted and alarm cleared");
    } else {
      const nextAlarmTime = lastFetched + 24 * 60 * 60 * 1000;
      await this.ctx.storage.setAlarm(nextAlarmTime);
      console.log(
        `Repo still active, rescheduled alarm for ${new Date(nextAlarmTime)}`,
      );
    }
  }

  async storeFiles(files: Array<{ path: string; content: string }>, isFirstBatch: boolean = true) {
    /* freshen: clear existing rows to avoid orphans on first batch only */
    if (isFirstBatch) {
      this.sql.exec("DELETE FROM files");
      if (ENABLE_FTS) {
        this.sql.exec("DELETE FROM files_fts");
      }
    }

    const startTime = Date.now();

    // Store files in batch
    for (const file of files) {
      this.sql.exec(
        "INSERT INTO files VALUES (?,?,?)",
        file.path,
        file.content,
        Date.now(),
      );
      // Index for FTS
      if (ENABLE_FTS) {
        this.sql.exec(
          "INSERT INTO files_fts(path,content) VALUES (?,?)",
          file.path,
          file.content,
        );
      }
    }

    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;

    console.log(`Batch save completed in ${durationSeconds} seconds for ${files.length} files`);

    return json({ success: true, filesStored: files.length });
  }

  async finalizeBatch() {
    const now = Date.now();
    this.sql.exec("INSERT OR REPLACE INTO meta VALUES ('lastFetched',?)", now);

    const alarmTime = now + 24 * 60 * 60 * 1000;
    await this.ctx.storage.setAlarm(alarmTime);
    console.log(`Set cleanup alarm for ${new Date(alarmTime)}`);

    return json({ success: true });
  }
}

async function populateRepo(
  owner: string,
  repo: string,
  branch: string,
  stub: RepoCache,
) {
  // Use direct GitHub archive URL - no authentication required
  const url = `https://github.com/${owner}/${repo}/archive/${branch}.tar.gz`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(
      `GitHub archive fetch failed (${r.status}) for ${owner}/${repo}/${branch}. URL: ${url}`,
    );
  }

  // Batch configuration - aim for chunks under 20MB to be safe (well below the 32MB limit)
  const MAX_BATCH_SIZE = 20 * 1024 * 1024; // 20MB
  let currentBatch: Array<{ path: string; content: string }> = [];
  let currentBatchSize = 0;
  let batchNumber = 0;
  let totalFiles = 0;

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
        
        // Calculate the approximate size of this file in the batch
        // Account for both path and content strings
        const fileSize = rel.length + txt.length;
        
        // If adding this file would exceed the batch size, send the current batch
        if (currentBatchSize + fileSize > MAX_BATCH_SIZE && currentBatch.length > 0) {
          console.log(`Sending batch ${batchNumber + 1} with ${currentBatch.length} files (${(currentBatchSize / 1024 / 1024).toFixed(2)}MB)`);
          await stub.storeFiles(currentBatch, batchNumber === 0);
          batchNumber++;
          totalFiles += currentBatch.length;
          currentBatch = [];
          currentBatchSize = 0;
        }
        
        // Add file to current batch
        currentBatch.push({ path: rel, content: txt });
        currentBatchSize += fileSize;
      } catch {
        // Skip binary files
      }
    }
    // Skip large files
  });

  // Send any remaining files in the last batch
  if (currentBatch.length > 0) {
    console.log(`Sending final batch ${batchNumber + 1} with ${currentBatch.length} files (${(currentBatchSize / 1024 / 1024).toFixed(2)}MB)`);
    await stub.storeFiles(currentBatch, batchNumber === 0);
    totalFiles += currentBatch.length;
  }

  // Finalize the batch operation
  await stub.finalizeBatch();
  
  console.log(`Populated repo with ${totalFiles} files in ${batchNumber + 1} batches`);
  return { success: true, totalFiles, batches: batchNumber + 1 };
}

const app = new Spiceflow()
  .state("env", {} as Env)
  .state("ctx", {} as ExecutionContext)
  .use(cors())
  .use(openapi({ path: "/openapi.json" }))
  .route({
    path: "/sse",
    handler: ({ request, state }) =>
      MyMCP.serveSSE("/sse").fetch(request as Request, state.env, state.ctx),
  })
  .route({
    path: "/sse/message",
    handler: ({ request, state }) =>
      MyMCP.serveSSE("/sse").fetch(request as Request, state.env, state.ctx),
  })
  .route({
    path: "/mcp",
    handler: ({ request, state }) =>
      MyMCP.serve("/mcp").fetch(request as Request, state.env, state.ctx),
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/files",
    handler: async ({ params, query, state }) => {
      const { owner, repo, branch } = params;
      const force = query.force === "true";
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache;

      try {
        if (force) {
          // Force refresh by directly populating
          await populateRepo(owner, repo, branch, stub);
        }
        return await stub.getFiles({ owner, repo, branch });
      } catch (error: any) {
        if (error.message === "NEEDS_REFRESH") {
          // Populate in the worker

          await populateRepo(owner, repo, branch, stub);

          // Try again after populating
          return stub.getFiles({ owner, repo, branch });
        }
        throw error;
      }
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/file/*",
    handler: async ({ params, query, state }) => {
      const { owner, repo, branch, "*": filePath } = params;
      const showLineNumbers = query.showLineNumbers === "true";
      const force = query.force === "true";
      const start = query.start ? parseInt(query.start) : undefined;
      const end = query.end ? parseInt(query.end) : undefined;

      // If only start is provided, default to showing 50 lines
      const finalEnd =
        start !== undefined && end === undefined ? start + 49 : end;

      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache;

      try {
        if (force) {
          // Force refresh by directly populating
          await populateRepo(owner, repo, branch, stub);
        }
        return await stub.getFile({
          owner,
          repo,
          branch,
          filePath,
          showLineNumbers,
          start,
          end: finalEnd,
        });
      } catch (error: any) {
        if (error.message === "NEEDS_REFRESH") {
          // Populate in the worker
          await populateRepo(owner, repo, branch, stub);
          // Try again after populating
          return stub.getFile({
            owner,
            repo,
            branch,
            filePath,
            showLineNumbers,
            start,
            end: finalEnd,
          });
        }
        throw error;
      }
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/search/*",
    handler: async ({ params, query: queryParams, state }) => {
      const { owner, repo, branch, "*": query } = params;
      const force = queryParams.force === "true";
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache;

      try {
        if (force) {
          // Force refresh by directly populating
          await populateRepo(owner, repo, branch, stub);
        }
        return await stub.searchFiles({ owner, repo, branch, query });
      } catch (error: any) {
        if (error.message === "NEEDS_REFRESH") {
          // Populate in the worker
          await populateRepo(owner, repo, branch, stub);
          // Try again after populating
          return stub.searchFiles({ owner, repo, branch, query });
        }
        throw error;
      }
    },
  });

// from example https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-authless/src/index.ts
export class MyMCP extends McpAgent {
  server = new McpServer(
    {
      name: "Gitchamber",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  async init() {
    await addMcpTools({
      mcpServer: this.server,
      app: app,
      ignorePaths: ["/sse", "/sse/message", "/mcp"],
    });
  }
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    app.handle(req, { state: { env, ctx } }),
};

const json = (x: unknown) =>
  new Response(JSON.stringify(x, null, 2), {
    headers: { "content-type": "application/json" },
  });
const notFound = () => new Response("Not found", { status: 404 });

export function findLineNumberInContent(
  content: string,
  searchSnippet: string,
): number | null {
  try {
    if (!content || !searchSnippet) {
      return null;
    }

    // Clean the snippet by removing leading/trailing whitespace
    const cleanSnippet = searchSnippet.trim();

    // If snippet is too short, return null
    if (cleanSnippet.length < 3) {
      return null;
    }

    // Try exact match first
    let index = content.indexOf(cleanSnippet);

    if (index === -1) {
      // Try to find a substring that's more likely to match
      // Split snippet into words and find the longest matching sequence
      const words = cleanSnippet.split(/\s+/).filter((word) => word.length > 2);

      for (const word of words) {
        const wordIndex = content.indexOf(word);
        if (wordIndex !== -1) {
          index = wordIndex;
          break;
        }
      }
    }

    if (index === -1) {
      return null;
    }

    // Count newlines before the found index to determine line number
    const beforeMatch = content.substring(0, index);
    const lineNumber = beforeMatch.split("\n").length;

    return lineNumber;
  } catch (e) {
    console.error("Error finding line number:", e);
    return null;
  }
}

function extractSnippetFromContent(
  content: string,
  searchQuery: string,
  maxLength: number = 200
): string {
  if (!content || !searchQuery) {
    return "";
  }

  // Case-insensitive search
  const lowerContent = content.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    // If not found in content, might be in the path - return first part of content
    const lines = content.split('\n').slice(0, 3).join('\n');
    if (lines.length > maxLength) {
      return lines.substring(0, maxLength) + '...';
    }
    return lines;
  }

  // Extract context around the match
  const contextRadius = Math.floor((maxLength - searchQuery.length) / 2);
  const start = Math.max(0, index - contextRadius);
  const end = Math.min(content.length, index + searchQuery.length + contextRadius);

  let snippet = content.substring(start, end);

  // Add ellipsis if truncated
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < content.length) {
    snippet = snippet + '...';
  }

  // Clean up: try to break at word boundaries
  if (start > 0) {
    const firstSpace = snippet.indexOf(' ', 3);
    if (firstSpace > 3 && firstSpace < 20) {
      snippet = '...' + snippet.substring(firstSpace + 1);
    }
  }
  if (end < content.length) {
    const lastSpace = snippet.lastIndexOf(' ', snippet.length - 4);
    if (lastSpace > snippet.length - 20) {
      snippet = snippet.substring(0, lastSpace) + '...';
    }
  }

  return snippet;
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

function formatSearchResultsAsMarkdown(
  results: Array<{
    path: string;
    snippet: string;
    url: string;
    lineNumber: number | null;
  }>,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((result) => {
      const lineInfo = result.lineNumber ? ` (line ${result.lineNumber})` : "";
      return `## [${result.path}](${result.url})${lineInfo}\n\n\`\`\`\n${result.snippet}\n\`\`\``;
    })
    .join("\n\n---\n\n");
}
