# GitChamber Agent Integration

GitChamber provides a REST API for accessing GitHub repository contents with caching, search, and line-numbered file viewing. This document explains how to integrate GitChamber with AI agents and automation tools.

## Base URL

```
https://gitchamber.com/repos/{owner}/{repo}/{branch}/
```

## Agent Prompt Snippet

Use this prompt snippet when configuring AI agents to work with GitChamber:

```
You have access to GitChamber, a GitHub repository caching service. Use these URLs for repository operations:

BASE_URL: https://gitchamber.com/repos/{owner}/{repo}/{branch}/

AVAILABLE OPERATIONS:

1. LIST FILES: GET {BASE_URL}/files
   - Returns JSON array of all file paths in repository
   - Example: https://gitchamber.com/repos/facebook/react/main/files

2. READ FILE: GET {BASE_URL}/file/{filepath}[?showLineNumbers=true&start=N&end=M]
   - Returns file content as plain text
   - Optional query parameters:
     * showLineNumbers=true: Adds line numbers to output
     * start=N: Start from line N
     * end=M: End at line M (if only start provided, shows 50 lines)
   - Examples:
     * https://gitchamber.com/repos/facebook/react/main/file/package.json
     * https://gitchamber.com/repos/facebook/react/main/file/src/index.js?start=100&end=150
     * https://gitchamber.com/repos/facebook/react/main/file/README.md?showLineNumbers=true

3. SEARCH REPOSITORY: GET {BASE_URL}/search/{query}
   - Returns markdown-formatted search results
   - Shows matching files with snippets and line numbers
   - Example: https://gitchamber.com/repos/facebook/react/main/search/useState

USAGE GUIDELINES:
- Always URL-encode file paths and search queries
- Use line numbers for precise code references (format: filename:line_number)
- Search returns markdown with clickable links to specific line numbers
- Repository data is cached for 6 hours, automatically refreshed
- Large files (>1MB) and binary files are not cached

INTEGRATION PATTERNS:
1. Start with search to find relevant files
2. Use line-numbered file access for precise code reading
3. Reference specific lines when discussing code (e.g., "src/index.js:42")
4. Use file listing to understand repository structure
```

## Query Parameter Reference

### File Access Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `showLineNumbers` | boolean | Add line numbers to output | `?showLineNumbers=true` |
| `start` | integer | Start line number (1-based) | `?start=50` |
| `end` | integer | End line number (inclusive) | `?end=100` |

### Combined Parameters

```bash
# Show lines 10-20 with line numbers
GET /file/src/app.js?showLineNumbers=true&start=10&end=20

# Show 50 lines starting from line 100
GET /file/src/app.js?start=100

# Show entire file with line numbers
GET /file/src/app.js?showLineNumbers=true
```

## Search Query Examples

GitChamber uses SQLite FTS (Full-Text Search). Supported query patterns:

```bash
# Simple text search
GET /search/function

# Multiple terms (AND)
GET /search/async%20function

# Phrase search
GET /search/"error%20handling"

# Prefix search
GET /search/handle*

# Boolean operators
GET /search/async%20AND%20await
GET /search/function%20OR%20method
GET /search/error%20NOT%20warning
```

## Response Formats

### File Listing Response
```json
[
  "package.json",
  "src/index.js",
  "src/components/App.jsx",
  "README.md"
]
```

### Search Response (Markdown)
```markdown
## [src/hooks/useEffect.js](https://gitchamber.com/repos/owner/repo/main/file/src/hooks/useEffect.js?start=42) (line 42)

```
function useCustomEffect(callback, deps) {
  return useEffect(callback, deps);
}
```

---

## [src/components/App.jsx](https://gitchamber.com/repos/owner/repo/main/file/src/components/App.jsx?start=15) (line 15)

```
useEffect(() => {
  fetchData();
}, []);
```
```

### File Content Response (with line numbers)
```
  1  import React from 'react';
  2  import { useState, useEffect } from 'react';
  3  
  4  function App() {
  5    const [data, setData] = useState(null);
  6    
  7    useEffect(() => {
  8      fetchData();
  9    }, []);
 10    
 11    return <div>Hello World</div>;
 12  }
```

## Error Handling

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 404 | File or repository not found |
| 500 | Internal server error (GitHub API issues, parsing errors) |

## Rate Limits

- Without GitHub token: 60 requests/hour per IP
- With GitHub token: 5,000 requests/hour
- Repository caching reduces GitHub API calls

## Best Practices for Agents

1. **Start with search**: Use search to discover relevant files before reading specific content
2. **Use line numbers**: Always request line numbers when examining code
3. **Cache file structure**: List files once, then reference specific files
4. **Handle pagination**: Use start/end parameters for large files
5. **URL encoding**: Always encode file paths and search queries
6. **Reference format**: Use `filename:line_number` when referencing specific code locations

## Example Agent Workflow

```python
# 1. Search for relevant functionality
search_url = f"https://gitchamber.com/repos/{owner}/{repo}/{branch}/search/authentication"
search_results = fetch(search_url)

# 2. Get specific file with line numbers
file_url = f"https://gitchamber.com/repos/{owner}/{repo}/{branch}/file/src/auth.js?showLineNumbers=true&start=50&end=100"
file_content = fetch(file_url)

# 3. Reference specific lines in discussion
print(f"The authentication logic is implemented in src/auth.js:67")
```