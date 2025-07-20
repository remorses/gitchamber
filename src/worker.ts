/* -----------------------------------------------------------------------
   Cloudflare Worker + Durable Object (SQLite) in one file
   -------------------------------------------------------------------- */

import { Spiceflow, AnySpiceflow } from "spiceflow";
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
          const row = sql
            .exec("SELECT content FROM files WHERE path = ?", params["*"])
            .one();
          return row ? new Response(row.content as BodyInit) : notFound();
        },
      })
      .route({
        method: "GET",
        path: "/search",
        query: z.object({
          q: z.string().optional(),
        }),
        handler: async ({ query }) => {
          await ensureFresh();
          const q = query.q ?? "";
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
    // Path received from outer worker has already removed /repos/:o/:r/:b
    return this.router.handle(request, { state: { env: this.env } });
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh() {
    const meta = this.sql
      .exec("SELECT val FROM meta WHERE key = 'lastFetched'")
      .one();
    const last = meta ? Number(meta.val) : 0;
    if (Date.now() - last < this.ttl) return; // still fresh

    /* avoid duplicate concurrent populates */
    if (this.ctx.blockConcurrencyWhile)
      await this.ctx.blockConcurrencyWhile(() => this.populate());
    else await this.populate(); // older runtimes
  }

  private async populate() {
    const [owner, repo, branch] = this.ctx.id.toString().split("/", 3);
    const headers: HeadersInit = this.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${this.env.GITHUB_TOKEN}` }
      : {};
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${branch}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GitHub archive fetch failed (${r.status})`);

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

const workerRouter = new Spiceflow().state("env", {} as Env)
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/files",
    handler: async ({ request, params, state }) => {
      const { owner, repo, branch } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      return stub.fetch(new Request("https://repo/files", request));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/file/*",
    handler: async ({ request, params, state }) => {
      const { owner, repo, branch, "*": filePath } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      return stub.fetch(new Request(`https://repo/file/${filePath}`, request));
    },
  })
  .route({
    method: "GET",
    path: "/repos/:owner/:repo/:branch/search",
    query: z.object({
      q: z.string().optional(),
    }),
    handler: async ({ request, params, state, query }) => {
      const { owner, repo, branch } = params;
      const id = state.env.REPO_CACHE.idFromName(`${owner}/${repo}/${branch}`);
      const stub = state.env.REPO_CACHE.get(id);

      const searchParams = new URLSearchParams();
      if (query.q) {
        searchParams.set("q", query.q);
      }
      const searchUrl = `https://repo/search?${searchParams.toString()}`;
      
      return stub.fetch(new Request(searchUrl, request));
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
