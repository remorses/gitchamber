# GitChamber

A high-performance GitHub repository caching service built with Cloudflare Workers and Durable Objects. GitChamber provides instant access to repository files with intelligent caching, full-text search, and a clean REST API.

## 🚀 Features

- **Instant File Access**: Cache entire GitHub repositories for lightning-fast file retrieval
- **Full-Text Search**: Search through repository content using SQLite FTS (Full-Text Search)
- **Smart Caching**: Configurable TTL with automatic cache refresh when expired
- **Type-Safe API**: Built with Spiceflow and Zod for robust TypeScript support
- **Scalable Architecture**: Leverages Cloudflare's global edge network and Durable Objects

## 🏗️ Architecture

GitChamber uses a two-tier architecture:

1. **Worker Router**: Routes requests to the appropriate repository cache instance
2. **Durable Object (RepoCache)**: Handles per-repository caching, storage, and search

### How It Works

1. When a repository is first accessed, GitChamber downloads the tar.gz archive from GitHub
2. Files are extracted and stored in SQLite with content indexed for full-text search
3. Subsequent requests are served instantly from the cache
4. Cache automatically refreshes based on configurable TTL (default: 6 hours)

## 📡 API Endpoints

All endpoints follow the pattern: `https://gitchamber.com/repos/:owner/:repo/:branch/...`

### List Files
```
GET /repos/:owner/:repo/:branch/files
```
Returns a JSON array of all file paths in the repository.

### Get File Content
```
GET /repos/:owner/:repo/:branch/file/*filepath
```
Returns the raw content of the specified file.

### Search Repository
```
GET /repos/:owner/:repo/:branch/search?query=searchterm
```
Search through repository content using full-text search.

## 🔧 Example Usage

### List files in remorses/fumabase repository
```bash
curl "https://gitchamber.com/repos/remorses/fumabase/main/files"
```

### Read a specific file (cloudflare-tunnel/README.md)
```bash
curl "https://gitchamber.com/repos/remorses/fumabase/main/file/cloudflare-tunnel/README.md"
```

### Search for "markdown" in the repository
```bash
curl "https://gitchamber.com/repos/remorses/fumabase/main/search?query=markdown"
```

### More Examples
```bash
# List all files
curl "https://gitchamber.com/repos/facebook/react/main/files"

# Get package.json
curl "https://gitchamber.com/repos/facebook/react/main/file/package.json"

# Search for "hooks"
curl "https://gitchamber.com/repos/facebook/react/main/search?query=hooks"
```

## 🛠️ Development

### Prerequisites
- Node.js 18+
- pnpm
- Cloudflare Workers CLI (Wrangler)

### Setup
```bash
# Clone the repository
git clone https://github.com/your-username/gitchamber.git
cd gitchamber

# Install dependencies
pnpm install

# Deploy to Cloudflare Workers
pnpm run deployment
```

### Configuration

The service can be configured via environment variables in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "GITHUB_TOKEN": "", // Optional: Increases rate limit to 5,000 req/h
    "CACHE_TTL_MS": "21600000" // Optional: Cache TTL in milliseconds (6h default)
  }
}
```

### Custom Domain

The service is configured to run on `gitchamber.com`. To use your own domain, update the routes in `wrangler.jsonc`:

```jsonc
{
  "routes": [
    {
      "pattern": "yourdomain.com/*",
      "custom_domain": true
    }
  ]
}
```

## 🏛️ Tech Stack

- **Runtime**: Cloudflare Workers
- **Storage**: Durable Objects with SQLite
- **Framework**: [Spiceflow](https://getspiceflow.com) - Type-safe API framework
- **Validation**: Zod
- **Archive Parsing**: @mjackson/tar-parser
- **Language**: TypeScript

## 📊 Performance

- **Cold Start**: ~200-500ms (first access to a repository)
- **Cached Response**: ~10-50ms globally
- **Storage**: Efficient SQLite storage with FTS indexing
- **Concurrency**: Handled automatically by Durable Objects

## 🔒 Rate Limits

- **Without GitHub Token**: 60 requests/hour per IP (GitHub's public API limit)
- **With GitHub Token**: 5,000 requests/hour (recommended for production)

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🐛 Issues

If you encounter any issues, please report them on [GitHub Issues](https://github.com/your-username/gitchamber/issues).