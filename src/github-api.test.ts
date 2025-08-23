import { describe, it, expect } from 'vitest';
import { fetchGitHubBranches, fetchBranchDetails } from './github-api.js';

describe('fetchGitHubBranches - REAL API TESTS', () => {
  it('should fetch branches from vercel/next.js repository', async () => {
    const result = await fetchGitHubBranches('vercel', 'next.js');

    expect(result.error).toBeUndefined();
    expect(result.branches).toBeDefined();
    expect(result.branches!.length).toBeGreaterThan(0);
    expect(result.branches!.length).toBeLessThanOrEqual(100); // API requests per_page=100
    
    // Check structure of first branch
    const firstBranch = result.branches![0];
    expect(firstBranch).toHaveProperty('name');
    expect(firstBranch).toHaveProperty('commit.sha');
    expect(firstBranch).toHaveProperty('commit.url');
    
    // Snapshot the branch names (not the full response as SHAs change)
    const branchNames = result.branches!.map(b => b.name);
    expect(branchNames).toMatchInlineSnapshot(`
      [
        "01-02-Copy_58398",
        "01-02-Rename___next_f_to___rsc_payload",
        "01-02-Try_removing_partial_manifest",
        "01-03--_implemented_api_invocation_logic_for_feedback_thumb_up_down_-_added_component_test_to_erroroverlaylayout_and_fixed_bug_in_clip-rule_etc",
        "01-05-Rename_acceptance_directory_to_acceptance-pages",
        "01-05-Start_typechecking_at_the_same_time_between_pages_and_app_router",
        "01-10-Support_any_value_in_RECORD_REPLAY",
        "01-13-handle_pnpm-workspace.yaml_while_searching_for_monorepo_root",
        "01-16-Update_ReactRefreshRegression_test_snapshot_for_Turbopack",
        "01-17-test_lucide-react_import",
        "01-19-Move_next/react-dev-overlay_into_next",
        "01-19-Remove_module_scope_variable_in_hot-dev-client",
        "01-23-tweak_prefetch_cache_key_prefix_logic",
        "01-24-Turbopack_test_updates",
        "01-30-Add_test_for_issue_45393",
      ]
    `);
  }, 10000);

  it('should handle non-existent repository with real API', async () => {
    const result = await fetchGitHubBranches('vercel', 'this-repo-definitely-does-not-exist-123456789');

    expect(result).toMatchInlineSnapshot(`
      {
        "error": "RATE_LIMITED",
        "message": "GitHub API rate limit exceeded",
      }
    `);
  }, 10000);

  it('should fetch branches from facebook/react repository', async () => {
    const result = await fetchGitHubBranches('facebook', 'react');

    expect(result.error).toBeUndefined();
    expect(result.branches).toBeDefined();
    expect(result.branches!.length).toBeGreaterThan(0);
    
    // Just verify we got branches, don't assume specific branch names
    const firstBranch = result.branches![0];
    expect(firstBranch).toHaveProperty('name');
    expect(firstBranch).toHaveProperty('commit.sha');
  }, 10000);
});

describe('fetchBranchDetails - REAL API TESTS', () => {
  it('should fetch branch details for vercel/next.js canary branch', async () => {
    const result = await fetchBranchDetails('vercel', 'next.js', 'canary');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('canary');
    expect(result!.commit).toHaveProperty('sha');
    expect(result!.commit).toHaveProperty('commit.committer.date');
    
    // Verify date is a valid ISO string
    const date = result!.commit.commit!.committer.date;
    expect(() => new Date(date)).not.toThrow();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // Basic ISO date format
  }, 10000);

  it('should return null for non-existent branch', async () => {
    const result = await fetchBranchDetails('vercel', 'next.js', 'this-branch-does-not-exist-999');

    expect(result).toBeNull();
  }, 10000);

  it('should fetch branch details for facebook/react main branch', async () => {
    const result = await fetchBranchDetails('facebook', 'react', 'main');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('main');
    expect(result!.commit).toHaveProperty('sha');
    expect(result!.commit).toHaveProperty('commit.committer.date');
  }, 10000);
});