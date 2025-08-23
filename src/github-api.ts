export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url?: string;
    commit?: {
      committer: {
        date: string;
      };
    };
  };
}

export interface GitHubApiResponse {
  branches?: GitHubBranch[];
  error?: string;
  message?: string;
}

// Fetch branches for a repository from GitHub API
export async function fetchGitHubBranches(owner: string, repo: string, githubToken?: string): Promise<GitHubApiResponse> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitChamber/1.0'
  };

  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    // Simple approach: just get branches, prioritize common names
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, {
      headers
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'REPO_NOT_FOUND', message: `Repository ${owner}/${repo} not found or is private` };
      }
      if (response.status === 403) {
        return { error: 'RATE_LIMITED', message: 'GitHub API rate limit exceeded' };
      }
      return { error: 'API_ERROR', message: `GitHub API error: ${response.status}` };
    }

    const branches = await response.json() as GitHubBranch[];
    
    // Prioritize common branch names
    const priorityNames = ['main', 'master', 'canary', 'develop', 'dev', 'staging', 'release', 'production', 'beta', 'next'];
    
    const priorityBranches: GitHubBranch[] = [];
    const otherBranches: GitHubBranch[] = [];
    
    branches.forEach(branch => {
      // Check exact match first
      if (priorityNames.includes(branch.name)) {
        priorityBranches.push(branch);
      } else {
        otherBranches.push(branch);
      }
    });
    
    // Sort priority branches by importance
    priorityBranches.sort((a, b) => {
      const aIndex = priorityNames.indexOf(a.name);
      const bIndex = priorityNames.indexOf(b.name);
      return aIndex - bIndex;
    });
    
    // Combine: priority branches first, then first few alphabetical others
    const result = [
      ...priorityBranches,
      ...otherBranches.slice(0, Math.max(10 - priorityBranches.length, 0))
    ];
    
    // Return up to 10 branches
    return { branches: result };
  } catch (error) {
    console.error('Error fetching GitHub branches:', error);
    console.error('Request was for:', `${owner}/${repo}`);
    return { error: 'NETWORK_ERROR', message: 'Failed to connect to GitHub API' };
  }
}

// Fetch detailed information for a specific branch
export async function fetchBranchDetails(owner: string, repo: string, branch: string, githubToken?: string): Promise<GitHubBranch | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitChamber/1.0'
  };

  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, {
      headers
    });

    if (!response.ok) {
      return null;
    }

    const branchData = await response.json() as GitHubBranch;
    return branchData;
  } catch (error) {
    console.error('Error fetching branch details:', error);
    return null;
  }
}
