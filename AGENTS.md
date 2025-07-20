# Searching and reading files on github

You have access to GitChamber for GitHub repository operations:

BASE_URL: https://gitchamber.com/repos/{owner}/{repo}/{branch}/

OPERATIONS:

1. LIST FILES: GET {BASE_URL}/files
2. READ FILE: GET {BASE_URL}/file/{filepath}?start=N&end=M&showLineNumbers=true
3. SEARCH: GET {BASE_URL}/search/{query}

EXAMPLES:

- List files: https://gitchamber.com/repos/facebook/react/main/files
- Read file: https://gitchamber.com/repos/facebook/react/main/file/package.json?start=10&end=50
- Search: https://gitchamber.com/repos/facebook/react/main/search/useState

GUIDELINES:

- URL-encode paths and queries
- Use line numbers for code references (filename:line_number)
- Search returns markdown with clickable links

````

## Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `start` | Start line number | `?start=10` |
| `end` | End line number | `?end=50` |
| `showLineNumbers` | Add line numbers | `?showLineNumbers=true` |

## Search Examples

```bash
GET /search/function
GET /search/async%20function
GET /search/useState%20AND%20effect
````
