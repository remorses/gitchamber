import { zodown } from 'zodown'
import { McpAgent } from 'agents/mcp'

import { parseTar } from '@xmorse/tar-parser'
import { DurableObject } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import { cors } from 'spiceflow/cors'
import { openapi } from 'spiceflow/openapi'
import { mcp, addMcpTools } from 'spiceflow/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, type ZodRawShape } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { createSpiceflowClient } from 'spiceflow/client'
import micromatch from 'micromatch'
import {
  findLineNumberInContent,
  formatFileWithLines,
  extractSnippetFromContent,
} from './utils.js'
import AGENTS_MD from '../AGENTS.md'
import { marked } from 'marked'
import { SpiceflowRequest } from 'spiceflow/dist/spiceflow'
import { fetchGitHubBranches } from './github-api.js'

/* ---------- Global constants ------------------------- */

const ENABLE_FTS = false // Set to true to enable full-text search indexing
const DEFAULT_GLOB = '**/{*.md,*.mdx,README*}' // Default to markdown and README files only
const MAX_FILE_LINES = 1000 // Maximum number of lines to return for a file

/* ---------- Region support --------------------------- */

const VALID_REGIONS = [
  // North America
  'enam',
  // Europe
  'weur',
  // Asia Pacific
  'apac',
  // South America
  'sam',
  // Oceania
  'oc',
  // Africa
  'afr',
] as const
export type DurableObjectRegion = (typeof VALID_REGIONS)[number]

interface GetClosestAvailableRegionArgs {
  request: Request
  regions?: DurableObjectRegion[]
}

/* ---------- Helper functions ------------------------- */

// Determine the closest Durable Object region based on location
function getClosestDurableObjectRegion(params: {
  continent?: string
  latitude?: number
  longitude?: number
}): DurableObjectRegion {
  const { continent, latitude, longitude } = params

  // If we have specific continent information, use it
  if (continent) {
    switch (continent) {
      case 'NA':
        return 'enam'
      case 'EU':
        return 'weur'
      case 'AS':
        return 'apac'
      case 'OC':
        return 'oc'
      case 'SA':
        return 'sam'
      case 'AF':
        return 'afr'
      default:
        return 'enam' // Default fallback to North America
    }
  }

  // Fallback to North America if no location info
  return 'enam'
}

function getClosestAvailableRegion({
  request,
  regions = VALID_REGIONS as unknown as DurableObjectRegion[],
}: GetClosestAvailableRegionArgs): DurableObjectRegion {
  // Check for x-force-region header (for testing)
  const forceRegion = request.headers.get('x-force-region')
  if (
    forceRegion &&
    VALID_REGIONS.includes(forceRegion as DurableObjectRegion)
  ) {
    const forcedRegion = forceRegion as DurableObjectRegion

    // Only allow forcing to regions that actually have the dataset
    if (regions.includes(forcedRegion)) {
      return forcedRegion
    }

    // If forced region doesn't have the dataset, throw error
    throw new Error(
      `Cannot force region ${forcedRegion}: dataset not available in that region. Available regions: ${regions.join(', ')}`,
    )
  }

  // Use the closest region from available regions
  const requestRegion = getClosestDurableObjectRegion({
    continent: request.cf?.continent as string | undefined,
    latitude: request.cf?.latitude as number | undefined,
    longitude: request.cf?.longitude as number | undefined,
  })

  // If the request's closest region is in our available regions, use it
  if (regions.includes(requestRegion)) {
    return requestRegion
  }

  // Otherwise use first available region
  return regions[0]
}

// Convert glob pattern to a safe table suffix
function globToTableSuffix(glob?: string): string {
  if (!glob) return 'default'
  if (glob === '**/*') return 'all_files'
  if (glob === DEFAULT_GLOB) return 'markdown_only'
  // Replace special characters with underscores to create valid table name
  return glob.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
}

// Generate cache key for Durable Object
interface CacheKeyParams {
  region: DurableObjectRegion
  owner: string
  repo: string
  branch: string
  glob?: string
}

function getCacheKey({
  region,
  owner,
  repo,
  branch,
  glob,
}: CacheKeyParams): string {
  const basePath = `${owner}/${repo}/${branch}`
  const pathWithGlob = glob
    ? `${basePath}/${globToTableSuffix(glob)}`
    : basePath
  return `${region}.${pathWithGlob}`
}

/* ---------- ENV interface ---------------------------- */

interface Env {
  REPO_CACHE: DurableObjectNamespace
  GITHUB_TOKEN?: string
  CACHE_TTL_MS?: string // e.g. "21600000" (6 h)
}

/* ======================================================================
   Durable Object: per‑repo cache
   ==================================================================== */
export class RepoCache extends DurableObject {
  private sql: SqlStorage
  private ttl: number
  private owner?: string
  private repo?: string
  private branch?: string

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.sql = state.storage.sql
    this.ttl = Number(env.CACHE_TTL_MS ?? 21_600_000) // 6 h default

    // Create meta table for tracking different glob patterns
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, val TEXT);
    `)
  }

  private ensureTablesForGlob(glob?: string) {
    const tableSuffix = globToTableSuffix(glob)
    const filesTable = `files_${tableSuffix}`
    const ftsTable = `files_fts_${tableSuffix}`

    /* Create tables specific to this glob pattern if they don't exist */
    if (ENABLE_FTS) {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS ${filesTable} (
          path          TEXT PRIMARY KEY,
          content       TEXT,
          firstFetched  INTEGER
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable}
          USING fts5(path, content, tokenize = 'porter');
      `)
    } else {
      // Optimized for fast inserts - no additional indexes on content
      // The PRIMARY KEY on path provides fast path searches
      // Content searches use table scan with LIKE (acceptable trade-off for fast inserts)
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS ${filesTable} (
          path          TEXT PRIMARY KEY,
          content       TEXT,
          firstFetched  INTEGER
        );
      `)
    }
  }

  async getFiles(params: {
    owner: string
    repo: string
    branch: string
    glob?: string
  }): Promise<Response> {
    this.owner = params.owner
    this.repo = params.repo
    this.branch = params.branch

    await this.ensureFresh(params.glob)
    this.ensureTablesForGlob(params.glob)
    const tableSuffix = globToTableSuffix(params.glob)
    const filesTable = `files_${tableSuffix}`
    const rows = [
      ...this.sql.exec(`SELECT path FROM ${filesTable} ORDER BY path`),
    ]
    return json(rows.map((r) => r.path))
  }

  async getFile(params: {
    owner: string
    repo: string
    branch: string
    filePath: string
    showLineNumbers?: boolean
    start?: number
    end?: number
    glob?: string
  }): Promise<Response> {
    this.owner = params.owner
    this.repo = params.repo
    this.branch = params.branch

    await this.ensureFresh(params.glob)
    this.ensureTablesForGlob(params.glob)
    const tableSuffix = globToTableSuffix(params.glob)
    const filesTable = `files_${tableSuffix}`
    const results = [
      ...this.sql.exec(
        `SELECT content FROM ${filesTable} WHERE path = ?`,
        params.filePath,
      ),
    ]
    const row = results.length > 0 ? results[0] : null

    if (!row) {
      return notFound()
    }

    const content = row.content as string

    // Always use formatFileWithLines to ensure consistent truncation at MAX_FILE_LINES
    const formatted = formatFileWithLines({
      content,
      showLineNumbers: params.showLineNumbers ?? false,
      startLine: params.start,
      endLine: params.end,
      maxLines: MAX_FILE_LINES,
    })

    return new Response(formatted, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  async searchFiles(params: {
    owner: string
    repo: string
    branch: string
    query: string
    glob?: string
  }): Promise<Response> {
    this.owner = params.owner
    this.repo = params.repo
    this.branch = params.branch

    await this.ensureFresh(params.glob)
    this.ensureTablesForGlob(params.glob)
    const tableSuffix = globToTableSuffix(params.glob)
    const filesTable = `files_${tableSuffix}`
    const ftsTable = `files_fts_${tableSuffix}`
    const searchQuery = decodeURIComponent(params.query)

    let rows: any[]

    if (ENABLE_FTS) {
      // Use FTS when enabled
      // SQLite snippet() extracts text around matches: snippet(table, column, start_mark, end_mark, ellipsis, max_tokens)
      // -1 means use all columns, '' for no highlighting marks, '...' as ellipsis, 64 max tokens
      rows = [
        ...this.sql.exec(
          `SELECT
            ${filesTable}.path,
            ${filesTable}.content,
            snippet(${ftsTable}, -1, '', '', '...', 64) as snippet
          FROM ${ftsTable}
          JOIN ${filesTable} ON ${filesTable}.path = ${ftsTable}.path
          WHERE ${ftsTable} MATCH ?
          ORDER BY rank`,
          searchQuery,
        ),
      ]
    } else {
      // Use LIKE queries when FTS is disabled
      // Search in both path and content, case-insensitive
      const likePattern = `%${searchQuery}%`
      rows = [
        ...this.sql.exec(
          `SELECT
            path,
            content,
            NULL as snippet
          FROM ${filesTable}
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
      ]
    }

    const results = rows.map((r) => {
      const content = r.content as string
      let snippet: string

      if (ENABLE_FTS) {
        // Remove HTML markup and clean up snippet from FTS
        snippet = (r.snippet as string).replace(/<\/?mark>/g, '')
      } else {
        // Extract snippet for LIKE search
        snippet = extractSnippetFromContent(content, searchQuery)
      }

      // Remove ... only from start/end of snippet before searching for line numbers
      const cleanSnippet = snippet.replace(/^\.\.\.|\.\.\.$/, '')
      const lineNumber = findLineNumberInContent(content, cleanSnippet)

      // Create URL with glob parameter and without base domain
      let url = `/repos/${params.owner}/${params.repo}/${params.branch}/files/${r.path}`
      const queryParams: string[] = []
      if (lineNumber) {
        queryParams.push(`start=${lineNumber}`)
      }
      if (params.glob && params.glob !== DEFAULT_GLOB) {
        queryParams.push(`glob=${params.glob}`)
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      return {
        path: r.path as string,
        snippet,
        url,
        lineNumber,
      }
    })

    const markdown = formatSearchResultsAsMarkdown(results)
    return new Response(markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    })
  }

  /* ---------- populate / refresh ------------- */
  private async ensureFresh(glob?: string) {
    const metaKey = `lastFetched_${globToTableSuffix(glob)}`
    const results = [
      ...this.sql.exec('SELECT val FROM meta WHERE key = ?', metaKey),
    ]
    const meta = results.length > 0 ? results[0] : null
    const last = meta ? Number(meta.val) : 0
    if (Date.now() - last < this.ttl) {
      return
    }

    // Return indicator that refresh is needed
    throw new Error('NEEDS_REFRESH')
  }

  async alarm() {
    console.log('Alarm triggered - checking if repo data should be deleted')

    // Get all lastFetched entries from meta table
    const results = [
      ...this.sql.exec(
        "SELECT key, val FROM meta WHERE key LIKE 'lastFetched_%'",
      ),
    ]

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    let anyActive = false

    for (const meta of results) {
      const lastFetched = Number(meta.val)
      if (lastFetched >= oneDayAgo) {
        anyActive = true
        break
      }
    }

    if (!anyActive) {
      console.log('Deleting all repo data - not accessed in over 24 hours')
      // Delete all glob-specific tables
      const tableResults = [
        ...this.sql.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'files_%'",
        ),
      ]
      for (const table of tableResults) {
        this.sql.exec(`DROP TABLE IF EXISTS ${table.name}`)
      }
      this.sql.exec('DELETE FROM meta')

      await this.ctx.storage.deleteAlarm()
      console.log('All repo data deleted and alarm cleared')
    } else {
      const nextAlarmTime = Date.now() + 24 * 60 * 60 * 1000
      await this.ctx.storage.setAlarm(nextAlarmTime)
      console.log(
        `Repo still active, rescheduled alarm for ${new Date(nextAlarmTime)}`,
      )
    }
  }

  async storeFiles(
    files: Array<{ path: string; content: string }>,
    glob?: string,
    isFirstBatch: boolean = true,
  ) {
    this.ensureTablesForGlob(glob)
    const tableSuffix = globToTableSuffix(glob)
    const filesTable = `files_${tableSuffix}`
    const ftsTable = `files_fts_${tableSuffix}`

    /* freshen: clear existing rows to avoid orphans on first batch only */
    if (isFirstBatch) {
      this.sql.exec(`DELETE FROM ${filesTable}`)
      if (ENABLE_FTS) {
        this.sql.exec(`DELETE FROM ${ftsTable}`)
      }
    }

    const startTime = Date.now()

    // Store files in batch
    for (const file of files) {
      this.sql.exec(
        `INSERT INTO ${filesTable} VALUES (?,?,?)`,
        file.path,
        file.content,
        Date.now(),
      )
      // Index for FTS
      if (ENABLE_FTS) {
        this.sql.exec(
          `INSERT INTO ${ftsTable}(path,content) VALUES (?,?)`,
          file.path,
          file.content,
        )
      }
    }

    const endTime = Date.now()
    const durationSeconds = (endTime - startTime) / 1000

    console.log(
      `Batch save completed in ${durationSeconds} seconds for ${files.length} files`,
    )

    return json({ success: true, filesStored: files.length })
  }

  async finalizeBatch(glob?: string) {
    const metaKey = `lastFetched_${globToTableSuffix(glob)}`
    const now = Date.now()
    this.sql.exec('INSERT OR REPLACE INTO meta VALUES (?,?)', metaKey, now)

    const alarmTime = now + 24 * 60 * 60 * 1000
    await this.ctx.storage.setAlarm(alarmTime)
    console.log(`Set cleanup alarm for ${new Date(alarmTime)}`)

    return json({ success: true })
  }
}

async function populateRepo(
  owner: string,
  repo: string,
  branch: string,
  stub: RepoCache,
  glob?: string,
  githubToken?: string,
): Promise<Response | null> {
  // Use direct GitHub archive URL - no authentication required
  const url = `https://github.com/${owner}/${repo}/archive/${branch}.tar.gz`
  const r = await fetch(url)
  if (!r.ok) {
    if (r.status === 404) {
      // When tar URL returns 404, try to fetch available branches to provide helpful error
      let branches: string[] | undefined

      try {
        const branchInfo = await fetchGitHubBranches(owner, repo, githubToken)

        if (branchInfo.error === 'REPO_NOT_FOUND') {
          return new Response(
            JSON.stringify(
              {
                error: 'Repository not found',
                message: `Repository ${owner}/${repo} does not exist or is private`,
                suggestion:
                  'Please check that the repository exists and is public, or that you have access to it.',
              },
              null,
              2,
            ),
            {
              status: 404,
              headers: { 'content-type': 'application/json' },
            },
          )
        }

        // If we successfully got branches, use them
        if (branchInfo.branches && branchInfo.branches.length > 0) {
          branches = branchInfo.branches
            .slice(0, 10) // Show up to 10 branches
            .map((b) => b.name)
        }
      } catch (error) {
        // If fetching branches fails (rate limit, network issue, etc.),
        // we still want to return a branch not found error
        console.error('Failed to fetch branches for suggestions:', error)
      }

      // Return branch not found error with or without branch suggestions
      if (branches && branches.length > 0) {
        const fullMessage = `Branch '${branch}' does not exist in ${owner}/${repo}.\n\nAvailable branches:\n${branches.map((b) => `  - ${b}`).join('\n')}`

        return new Response(
          JSON.stringify(
            {
              error: 'Branch not found',
              message: fullMessage,
              availableBranches: branches,
              suggestion: 'Try one of the available branches listed above.',
            },
            null,
            2,
          ),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        )
      } else {
        // No branches available (either none exist or we couldn't fetch them)
        return new Response(
          JSON.stringify(
            {
              error: 'Branch not found',
              message: `Branch '${branch}' does not exist in ${owner}/${repo}.`,
              suggestion:
                'Please verify the branch name or check the repository directly.',
            },
            null,
            2,
          ),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
    }

    return new Response(
      JSON.stringify(
        {
          error: 'Request failed',
          message: `GitHub archive fetch failed (${r.status}) for ${owner}/${repo}/${branch}. URL: ${url}`,
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  // Batch configuration - aim for chunks under 20MB to be safe (well below the 32MB limit)
  const MAX_BATCH_SIZE = 20 * 1024 * 1024 // 20MB
  let currentBatch: Array<{ path: string; content: string }> = []
  let currentBatchSize = 0
  let batchNumber = 0
  let totalFiles = 0

  const gz = r.body!.pipeThrough(new DecompressionStream('gzip'))

  await parseTar(gz, async (ent) => {
    if (ent.header.type !== 'file') return
    const rel = ent.name.split('/').slice(1).join('/')
    const buf = await ent.arrayBuffer()

    /* only store text files under 1MB */
    if (buf.byteLength < 1_000_000) {
      try {
        const txt = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: false,
        }).decode(buf)

        // Skip files that don't match the glob pattern
        if (glob && glob !== '**/*' && !micromatch.isMatch(rel, glob)) {
          return
        }

        // Calculate the approximate size of this file in the batch
        // Account for both path and content strings
        const fileSize = rel.length + txt.length

        // If adding this file would exceed the batch size, send the current batch
        if (
          currentBatchSize + fileSize > MAX_BATCH_SIZE &&
          currentBatch.length > 0
        ) {
          console.log(
            `Sending batch ${batchNumber + 1} with ${currentBatch.length} files (${(currentBatchSize / 1024 / 1024).toFixed(2)}MB)`,
          )
          await stub.storeFiles(currentBatch, glob, batchNumber === 0)
          batchNumber++
          totalFiles += currentBatch.length
          currentBatch = []
          currentBatchSize = 0
        }

        // Add file to current batch
        currentBatch.push({ path: rel, content: txt })
        currentBatchSize += fileSize
      } catch {
        // Skip binary files
      }
    }
    // Skip large files
  })

  // Send any remaining files in the last batch
  if (currentBatch.length > 0) {
    console.log(
      `Sending final batch ${batchNumber + 1} with ${currentBatch.length} files (${(currentBatchSize / 1024 / 1024).toFixed(2)}MB)`,
    )
    await stub.storeFiles(currentBatch, glob, batchNumber === 0)
    totalFiles += currentBatch.length
  }

  // Finalize the batch operation
  await stub.finalizeBatch(glob)

  console.log(
    `Populated repo with ${totalFiles} files in ${batchNumber + 1} batches`,
  )
  return null // Success - no error response
}

const app = new Spiceflow()
  .state('env', {} as Env)
  .use(cors())
  .use(openapi({ path: '/openapi.json' }))
  .route({
    method: 'GET',
    path: '/',
    handler: ({ request }) => {
      const acceptHeader = request.headers.get('accept') || ''

      // Check if client accepts HTML
      if (acceptHeader.includes('text/html')) {
        // Configure marked to render links
        marked.setOptions({
          breaks: true,
          gfm: true,
        })

        // Convert markdown to HTML
        const htmlContent = marked.parse(AGENTS_MD)

        // Wrap in basic HTML structure
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitChamber API Documentation</title>
  <style>
    body {
      font-family: Consolas, Menlo, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', 'Courier New', monospace;
      line-height: 1.6;
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
      background-color: #000;
      color: #fff;
    }
    .container {
      max-width: 900px;
      width: 100%;
    }
    .github-link {
      text-align: center;
      margin-bottom: 20px;
      padding: 10px;
      background-color: #111;
      border-radius: 4px;
    }
    a {
      color: #4a9eff;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    pre {
      overflow-x: auto;
      background-color: #111;
      padding: 12px;
      border-radius: 4px;
    }
    code {
      font-family: inherit;
      background-color: #222;
      padding: 2px 4px;
      border-radius: 2px;
    }
    pre code {
      background-color: transparent;
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #333;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #1a1a1a;
    }
    tr:hover {
      background-color: #0a0a0a;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="github-link">
      <a href="https://github.com/remorses/gitchamber" target="_blank" rel="noopener noreferrer">View on GitHub</a>
    </div>
    ${htmlContent}
  </div>
</body>
</html>`

        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }

      // Default to plain text
      return new Response(AGENTS_MD, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    },
  })

  .route({
    method: 'GET',
    path: '/repos/:owner/:repo/:branch/files',
    handler: async ({ params, query, state, request }) => {
      const { owner, repo, branch } = params
      const force = query.force === 'true'
      const glob = query.glob || DEFAULT_GLOB

      // Determine the closest region
      const selectedRegion = getClosestAvailableRegion({
        request: request as any,
      })

      const cacheKey = getCacheKey({
        region: selectedRegion,
        owner,
        repo,
        branch,
        glob,
      })
      const id = state.env.REPO_CACHE.idFromName(cacheKey)
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache

      try {
        if (force) {
          // Force refresh by directly populating
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
        }
        return await stub.getFiles({ owner, repo, branch, glob })
      } catch (error: any) {
        if (error.message === 'NEEDS_REFRESH') {
          // Populate in the worker
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
          // Try again after populating
          return stub.getFiles({ owner, repo, branch, glob })
        }
        throw error
      }
    },
  })
  .route({
    method: 'GET',
    path: '/repos/:owner/:repo/:branch/file/*',
    handler: ({ params, request }) => {
      // Redirect /file/* to /files/*
      const { owner, repo, branch, '*': filePath } = params
      const url = new URL(request.url)
      const search = url.search
      const location = `/repos/${owner}/${repo}/${branch}/files/${filePath}${search}`
      return Response.redirect(location, 302)
    },
  })
  .route({
    method: 'GET',
    path: '/repos/:owner/:repo/:branch/glob',
    handler: ({ params, request }) => {
      // Redirect /file/* to /files/*
      const { owner, repo, branch } = params
      const url = new URL(request.url)
      const search = url.search
      const location = `/repos/${owner}/${repo}/${branch}/files${search}`
      return Response.redirect(location, 302)
    },
  })
  .route({
    method: 'GET',
    path: '/repos/:owner/:repo/:branch/files/*',
    handler: async ({ params, query, state, request }) => {
      const { owner, repo, branch, '*': filePath } = params
      const showLineNumbers = query.showLineNumbers === 'true'
      const force = query.force === 'true'
      const glob = query.glob || DEFAULT_GLOB
      const start = query.start ? parseInt(query.start) : undefined
      const end = query.end ? parseInt(query.end) : undefined

      // If only start is provided, default to showing 50 lines
      const finalEnd =
        start !== undefined && end === undefined ? start + 49 : end

      // Determine the closest region
      const selectedRegion = getClosestAvailableRegion({
        request: request as any,
      })

      const cacheKey = getCacheKey({
        region: selectedRegion,
        owner,
        repo,
        branch,
        glob,
      })
      const id = state.env.REPO_CACHE.idFromName(cacheKey)
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache

      try {
        if (force) {
          // Force refresh by directly populating
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
        }
        return await stub.getFile({
          owner,
          repo,
          branch,
          filePath,
          showLineNumbers,
          start,
          end: finalEnd,
          glob,
        })
      } catch (error: any) {
        if (error.message === 'NEEDS_REFRESH') {
          // Populate in the worker
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
          // Try again after populating
          return stub.getFile({
            owner,
            repo,
            branch,
            filePath,
            showLineNumbers,
            start,
            end: finalEnd,
            glob,
          })
        }
        throw error
      }
    },
  })
  .route({
    method: 'GET',
    path: '/repos/:owner/:repo/:branch/search/*',
    handler: async ({ params, query: queryParams, state, request }) => {
      const { owner, repo, branch, '*': query } = params
      const force = queryParams.force === 'true'
      const glob = queryParams.glob || DEFAULT_GLOB

      // Determine the closest region
      const selectedRegion = getClosestAvailableRegion({
        request: request as any,
      })

      const cacheKey = getCacheKey({
        region: selectedRegion,
        owner,
        repo,
        branch,
        glob,
      })
      const id = state.env.REPO_CACHE.idFromName(cacheKey)
      const stub = state.env.REPO_CACHE.get(id) as any as RepoCache

      try {
        if (force) {
          // Force refresh by directly populating
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
        }
        return await stub.searchFiles({
          owner,
          repo,
          branch,
          query,
          glob,
        })
      } catch (error: any) {
        if (error.message === 'NEEDS_REFRESH') {
          // Populate in the worker
          const errorResponse = await populateRepo(
            owner,
            repo,
            branch,
            stub,
            glob,
            state.env.GITHUB_TOKEN,
          )
          if (errorResponse) return errorResponse
          // Try again after populating
          return stub.searchFiles({
            owner,
            repo,
            branch,
            query,
            glob,
          })
        }
        throw error
      }
    },
  })
  .route({
    path: '/*',
    handler: () => {
      return new Response(
        '404 Not Found\n\nTo see how to use gitchamber ALWAYS do `curl -s https://gitchamber.com` first.',
        {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        },
      )
    },
  })

// from example https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-authless/src/index.ts
export class MyMCP extends McpAgent<Env> {
  server = new McpServer(
    {
      name: 'Gitchamber',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  )

  async init() {
    const env = this.env
    const ctx = this.ctx

    const client = createSpiceflowClient<typeof app>(app, {
      state: { env },
    })

    // Tool for listing files in a repository
    this.server.registerTool(
      'listRepoFiles',
      {
        title: 'List Repository Files',
        description: 'List all files in a GitHub repository',
        inputSchema: {
          owner: z.string().describe('Repository owner'),
          repo: z.string().describe('Repository name'),
          branch: z.string().describe('Branch name'),
          glob: z.string().default(DEFAULT_GLOB).describe('File glob pattern'),
        },
      },
      async ({ owner, repo, branch = 'main', glob = DEFAULT_GLOB }) => {
        const { data, error } = await client.repos[owner][repo][
          branch
        ].files.get({ query: { glob } })

        if (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error}`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        }
      },
    )

    // Tool for reading a specific file
    this.server.registerTool(
      'readRepoFile',
      {
        title: 'Read Repository File',
        description:
          'Read the content of a specific file in a GitHub repository',
        inputSchema: {
          owner: z.string().describe('Repository owner'),
          repo: z.string().describe('Repository name'),
          branch: z.string().describe('Branch name'),
          glob: z.string().default(DEFAULT_GLOB).describe('File glob pattern'),
          filepath: z.string().describe('Path to the file'),
          start: z.coerce
            .number()
            .int()
            .optional()
            .describe('Start line number'),
          end: z.coerce.number().int().optional().describe('End line number'),
          showLineNumbers: z.coerce
            .boolean()
            .default(false)
            .describe('Show line numbers'),
        },
      },
      async ({
        owner,
        repo,
        branch = 'main',
        filepath,
        start,
        end,
        showLineNumbers = false,
        glob = DEFAULT_GLOB,
      }) => {
        const query: Record<string, string> = { glob }
        if (start !== undefined) query.start = String(start)
        if (end !== undefined) query.end = String(end)
        if (showLineNumbers) query.showLineNumbers = 'true'

        const { data, error } = await client.repos[owner][repo][branch].files[
          filepath
        ].get({ query })

        if (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error}`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: data,
            },
          ],
        }
      },
    )

    // Tool for searching in a repository
    this.server.registerTool(
      'searchRepoContent',
      {
        title: 'Search Repository Content',
        description: 'Search for content in a GitHub repository',
        inputSchema: {
          owner: z.string().describe('Repository owner'),
          repo: z.string().describe('Repository name'),
          branch: z.string().describe('Branch name'),
          glob: z.string().default(DEFAULT_GLOB).describe('File glob pattern'),
          query: z.string().describe('Search query'),
        },
      },
      async ({ owner, repo, branch = 'main', query, glob = DEFAULT_GLOB }) => {
        const { data, error } = await client.repos[owner][repo][branch].search[
          query
        ].get({ query: { glob } })

        if (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error}`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: data,
            },
          ],
        }
      },
    )
  }
}

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url)

    if (url.pathname === '/sse' || url.pathname === '/sse/message') {
      return await MyMCP.serveSSE('/sse').fetch(request, env, ctx)
    }

    if (url.pathname === '/mcp') {
      return await MyMCP.serve('/mcp').fetch(request, env, ctx)
    }

    return await app.handle(request, { state: { env } })
  },
}

const json = (x: unknown) =>
  new Response(JSON.stringify(x, null, 2), {
    headers: { 'content-type': 'application/json' },
  })
const notFound = () => new Response('Not found', { status: 404 })

function formatSearchResultsAsMarkdown(
  results: Array<{
    path: string
    snippet: string
    url: string
    lineNumber: number | null
  }>,
): string {
  if (results.length === 0) {
    return '<results>\nNo results found.\n</results>'
  }

  const resultsXml = results
    .map((result) => {
      return `<result contentUrl="${result.url}">\n${result.path}\n\n${result.snippet}\n</result>`
    })
    .join('\n\n')

  return `<results>\n${resultsXml}\n</results>`
}
