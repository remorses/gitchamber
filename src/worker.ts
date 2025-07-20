/* -----------------------------------------------------------------------
   Cloudflare Worker + Durable Object (SQLite) in one file
   -------------------------------------------------------------------- */

import { Spiceflow, AnySpiceflow } from "spiceflow";
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
  private router: AnySpiceflow;
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

    /* ---------------- Spiceflow router inside DO ------------- */
    const sql = this.sql;
    const ensureFresh = this.ensureFresh.bind(this);

    this.router = new Spiceflow()
      .route({
        method: "GET",
        path: "/files",
        handler: async () => {
          await ensureFresh();
          const rows = [...sql.exec("SELECT path FROM files ORDER BY path")];
          return json(rows.map((r) => r.path));
        },
      })
      .route({
        method: "GET",
        path: "/file/*",
        handler: async ({ params }) => {
          await ensureFresh();
          const results = [...sql.exec("SELECT content FROM files WHERE path = ?", params["*"])];
          const row = results.length > 0 ? results[0] : null;
          return row ? new Response(row.content as BodyInit) : notFound();
        },
      })
      .route({
        method: "GET",
        path: "/search",
        query: z.object({
          query: z.string().optional(),
        }),
        handler: async ({ query }) => {
          await ensureFresh();
          const q = query.query ?? "";
          const rows = [
            ...sql.exec(
              "SELECT path FROM files_fts WHERE files_fts MATCH ?",
              q,
            ),
          ];
          return json(rows.map((r) => r.path));
        },
      });
  }


  /* ---------------- entry -------------------- */
  async fetch(request: Request) {
    const url = new URL(request.url);
    
    // Extract owner, repo, branch from query params
    this.owner = url.searchParams.get("owner") || undefined;
    this.repo = url.searchParams.get("repo") || undefined;
    this.branch = url.searchParams.get("branch") || undefined;
    
    // Path received from outer worker has already removed /repos/:o/:r/:b
    return this.router.handle(request, { state: { env: this.env } });
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh() {
    const results = [...this.sql.exec("SELECT val FROM meta WHERE key = 'lastFetched'")];
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
      throw new Error("Repository parameters (owner, repo, branch) are required for populate");
    }
    
    // Use direct GitHub archive URL - no authentication required
    const url = `https://github.com/${this.owner}/${this.repo}/archive/${this.branch}.tar.gz`;
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error(`GitHub archive fetch failed (${r.status}) for ${this.owner}/${this.repo}/${this.branch}. URL: ${url}`);
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
    handler: async ({ request, params, state }) => {
      const { owner, repo, branch } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      const doUrl = new URL("https://repo/files");
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      return stub.fetch(new Request(doUrl.toString(), request));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/file/*",
    handler: async ({ request, params, state }) => {
      const { owner, repo, branch, "*": filePath } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      const doUrl = new URL(`https://repo/file/${filePath}`);
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      return stub.fetch(new Request(doUrl.toString(), request));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/search",
    query: z.object({
      query: z.string().optional(),
    }),
    handler: async ({ request, params, state, query }) => {
      const { owner, repo, branch } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      const doUrl = new URL("https://repo/search");
      doUrl.searchParams.set("owner", owner);
      doUrl.searchParams.set("repo", repo);
      doUrl.searchParams.set("branch", branch);
      if (query.query) {
        doUrl.searchParams.set("query", query.query);
      }
      
      return stub.fetch(new Request(doUrl.toString(), request));
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
