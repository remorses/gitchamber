<div align='center' className='w-full'>
    <br/>
    <br/>
    <br/>
    <h1>gitchamber</h1>
    <p>search and read files in GitHub repositories without worrying about rate limits</p>
    <br/>
    <br/>
</div>

High-performance GitHub repository caching service built with Cloudflare Workers and Durable Objects. Provides instant file access, full-text search, and REST API for GitHub repositories.

## Features

- Instant file access via repository caching
- Full-text search using SQLite FTS
- Configurable TTL with automatic cache refresh
- Global edge deployment via Cloudflare Workers
- Per-repository isolation using Durable Objects

## Architecture

Two-tier system:

1. Worker router handles request routing
2. Durable Object (RepoCache) manages per-repository caching and storage

When accessed, repositories are downloaded as tar.gz archives from GitHub, extracted, and stored in SQLite with FTS indexing. Cache refreshes based on configurable TTL (default: 6 hours). Data is automatically cleaned up after 24 hours of inactivity.

## API Endpoints

### List Files

```
GET https://gitchamber.com/repos/:owner/:repo/:branch/files
```

Returns JSON array of all file paths.

### Get File Content

```
GET https://gitchamber.com/repos/:owner/:repo/:branch/file/*filepath[?showLineNumbers=true&start=N&end=M]
```

Returns file content. Optional parameters:

- `showLineNumbers`: Add line numbers
- `start`: Start line number
- `end`: End line number (defaults to start+49 if only start provided)

### Search Repository

```
GET https://gitchamber.com/repos/:owner/:repo/:branch/search/*query
```

Full-text search returning markdown-formatted results with file paths, snippets, and line numbers.

## Usage Examples

- [https://gitchamber.com/repos/remorses/gitchamber/main/files](https://gitchamber.com/repos/remorses/gitchamber/main/files)
- [https://gitchamber.com/repos/remorses/gitchamber/main/file/package.json?start=5&end=50&showLineNumbers=true](https://gitchamber.com/repos/remorses/gitchamber/main/file/package.json?start=5&end=50&showLineNumbers=true)
- [https://gitchamber.com/repos/remorses/gitchamber/main/search/cloudflare](https://gitchamber.com/repos/remorses/gitchamber/main/search/cloudflare)

## Development

Prerequisites: Node.js 18+, pnpm, Wrangler CLI

```bash
git clone https://github.com/your-username/gitchamber.git
cd gitchamber
pnpm install
pnpm run deployment
```

## Configuration

Environment variables in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "GITHUB_TOKEN": "", // Optional: 5K req/h limit vs 60 req/h
    "CACHE_TTL_MS": "21600000", // 6 hours default
  },
}
```

## Why Use GitChamber Instead of WebFetch

GitChamber offers several key advantages over the traditional WebFetch tool for accessing GitHub repositories:

- **Always Fresh Content**: Never get stale information - GitChamber automatically refreshes cached content based on configurable TTL, ensuring you always see the latest version of repository files
- **Native Markdown Support**: Files are already in markdown format, eliminating the need to convert HTML back to markdown, preserving original formatting and structure
- **Access to Implementation Files**: Using custom glob patterns, you can retrieve actual source code files (.js, .ts, .py, etc.), not just documentation
- **Context-Aware Pagination**: Supports line-based pagination with `start` and `end` parameters to prevent LLM context overflow - Claude and other LLMs can efficiently process large files in chunks
- **Precise Search**: Uses exact string matching instead of imprecise fuzzy or semantic search, ensuring you find exactly what you're looking for with full-text search capabilities via SQLite FTS
- **Optimized for LLMs**: Purpose-built for AI agents and LLMs like Claude that need structured, reliable access to repository contents

## Tech Stack

- Cloudflare Workers (runtime)
- Durable Objects with SQLite (storage)
- TypeScript

- Spiceflow (API framework)
- Zod (validation)

## Performance

- Cold start: 200-500ms
- Cached response: 10-50ms globally
- Automatic cleanup after 24h inactivity

## OpenAPI Schema

The API follows OpenAPI 3.0 specification. Key endpoints:

```yaml
openapi: 3.0.0
info:
  title: GitChamber API
  version: 1.0.0
servers:
  - url: https://gitchamber.com
paths:
  /repos/{owner}/{repo}/{branch}/files:
    get:
      summary: List repository files
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items:
                  type: string
  /repos/{owner}/{repo}/{branch}/file/{filepath}:
    get:
      summary: Get file content
      parameters:
        - name: showLineNumbers
          in: query
          schema:
            type: boolean
        - name: start
          in: query
          schema:
            type: integer
        - name: end
          in: query
          schema:
            type: integer
      responses:
        "200":
          content:
            text/plain:
              schema:
                type: string
  /repos/{owner}/{repo}/{branch}/search/{query}:
    get:
      summary: Search repository content
      responses:
        "200":
          content:
            text/markdown:
              schema:
                type: string
```
