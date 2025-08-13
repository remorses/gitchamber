import { describe, it, expect } from 'vitest';

describe('GitChamber Production API', () => {
  const baseUrl = 'https://gitchamber.com/repos/vercel/next.js/canary';

  it('should list files', async () => {
    const response = await fetch(`${baseUrl}/files?force=true`);
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.slice(0, 5)).toMatchInlineSnapshot(`
      [
        "CODE_OF_CONDUCT.md",
        "UPGRADING.md",
        "apps/docs/README.md",
        "bench/fuzzponent/readme.md",
        "bench/rendering/readme.md",
      ]
    `);
  });

  it('should search repository', async () => {
    const response = await fetch(`${baseUrl}/search/DurableObject`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(text).toMatchInlineSnapshot(`"No results found."`);
  });

  it('should get file content without line numbers', async () => {
    const response = await fetch(`${baseUrl}/file/CODE_OF_CONDUCT.md`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(text).toMatchInlineSnapshot(`
      "## Code of Conduct

      ### Our Pledge

      We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, caste, color, religion, or sexual identity and orientation.

      We pledge to act and interact in ways that contribute to an open, welcoming, diverse, inclusive, and healthy community.

      ### Our Standards

      Examples of behavior that contributes to a positive environment for our community include:

      - Demonstrating empathy and kindness toward other people
      - Being respectful of differing opinions, viewpoints, and experiences
      - Giving and gracefully accepting constructive feedback
      - Accepting responsibility and apologizing to those affected by our mistakes, and learning from the experience
      - Focusing on what is best not just for us as individuals, but for the overall community

      Examples of unacceptable behavior include:

      - The use of sexualized language or imagery, and sexual attention or advances of any kind
      - Trolling, insulting or derogatory comments, and personal or political attacks
      - Public or private harassment
      - Publishing others’ private information, such as a physical or email address, without their explicit permission
      - Other conduct which could reasonably be considered inappropriate in a professional setting

      ### Enforcement Responsibilities

      Project maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.

      Project maintainers have the right and responsibility to remove, edit, or reject comments, commits, code, wiki edits, issues, and other contributions that are not aligned to this Code of Conduct, and will communicate reasons for moderation decisions when appropriate.

      ### Scope

      This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces. Examples of representing our community include using an official e-mail address, posting via an official social media account, or acting as an appointed representative at an online or offline event.

      ### Enforcement

      Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project team responsible for enforcement at [coc@vercel.com](mailto:coc@vercel.com). All complaints will be reviewed and investigated promptly and fairly.

      All project maintainers are obligated to respect the privacy and security of the reporter of any incident.

      Project maintainers who do not follow or enforce the Code of Conduct in good
      faith may face temporary or permanent repercussions as determined by other
      members of the project's leadership.

      ### Attribution

      This Code of Conduct is adapted from the [Contributor Covenant][homepage], version 2.1,
      available at [https://www.contributor-covenant.org/version/2/1/code_of_conduct/][version]

      [homepage]: http://contributor-covenant.org
      [version]: https://www.contributor-covenant.org/version/2/1
      "
    `);
  });

  it('should get file content with line numbers', async () => {
    const response = await fetch(`${baseUrl}/file/CODE_OF_CONDUCT.md?showLineNumbers=true`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(text).toMatchInlineSnapshot(`
      " 1  ## Code of Conduct
       2  
       3  ### Our Pledge
       4  
       5  We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, caste, color, religion, or sexual identity and orientation.
       6  
       7  We pledge to act and interact in ways that contribute to an open, welcoming, diverse, inclusive, and healthy community.
       8  
       9  ### Our Standards
      10  
      11  Examples of behavior that contributes to a positive environment for our community include:
      12  
      13  - Demonstrating empathy and kindness toward other people
      14  - Being respectful of differing opinions, viewpoints, and experiences
      15  - Giving and gracefully accepting constructive feedback
      16  - Accepting responsibility and apologizing to those affected by our mistakes, and learning from the experience
      17  - Focusing on what is best not just for us as individuals, but for the overall community
      18  
      19  Examples of unacceptable behavior include:
      20  
      21  - The use of sexualized language or imagery, and sexual attention or advances of any kind
      22  - Trolling, insulting or derogatory comments, and personal or political attacks
      23  - Public or private harassment
      24  - Publishing others’ private information, such as a physical or email address, without their explicit permission
      25  - Other conduct which could reasonably be considered inappropriate in a professional setting
      26  
      27  ### Enforcement Responsibilities
      28  
      29  Project maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.
      30  
      31  Project maintainers have the right and responsibility to remove, edit, or reject comments, commits, code, wiki edits, issues, and other contributions that are not aligned to this Code of Conduct, and will communicate reasons for moderation decisions when appropriate.
      32  
      33  ### Scope
      34  
      35  This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces. Examples of representing our community include using an official e-mail address, posting via an official social media account, or acting as an appointed representative at an online or offline event.
      36  
      37  ### Enforcement
      38  
      39  Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project team responsible for enforcement at [coc@vercel.com](mailto:coc@vercel.com). All complaints will be reviewed and investigated promptly and fairly.
      40  
      41  All project maintainers are obligated to respect the privacy and security of the reporter of any incident.
      42  
      43  Project maintainers who do not follow or enforce the Code of Conduct in good
      44  faith may face temporary or permanent repercussions as determined by other
      45  members of the project's leadership.
      46  
      47  ### Attribution
      48  
      49  This Code of Conduct is adapted from the [Contributor Covenant][homepage], version 2.1,
      50  available at [https://www.contributor-covenant.org/version/2/1/code_of_conduct/][version]
      51  
      52  [homepage]: http://contributor-covenant.org
      53  [version]: https://www.contributor-covenant.org/version/2/1
      54  
      end of file"
    `);
  });

  it('should get file content with start and end line numbers', async () => {
    const response = await fetch(`${baseUrl}/file/CODE_OF_CONDUCT.md?start=6&end=12`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(text).toMatchInlineSnapshot(`
      " 6  
       7  We pledge to act and interact in ways that contribute to an open, welcoming, diverse, inclusive, and healthy community.
       8  
       9  ### Our Standards
      10  
      11  Examples of behavior that contributes to a positive environment for our community include:
      12  "
    `);
  });

  it('should get file content with only start line number', async () => {
    const response = await fetch(`${baseUrl}/file/CODE_OF_CONDUCT.md?start=20`);
    const text = await response.text();

    expect(text).toMatchInlineSnapshot(`
      "20  
      21  - The use of sexualized language or imagery, and sexual attention or advances of any kind
      22  - Trolling, insulting or derogatory comments, and personal or political attacks
      23  - Public or private harassment
      24  - Publishing others’ private information, such as a physical or email address, without their explicit permission
      25  - Other conduct which could reasonably be considered inappropriate in a professional setting
      26  
      27  ### Enforcement Responsibilities
      28  
      29  Project maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.
      30  
      31  Project maintainers have the right and responsibility to remove, edit, or reject comments, commits, code, wiki edits, issues, and other contributions that are not aligned to this Code of Conduct, and will communicate reasons for moderation decisions when appropriate.
      32  
      33  ### Scope
      34  
      35  This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces. Examples of representing our community include using an official e-mail address, posting via an official social media account, or acting as an appointed representative at an online or offline event.
      36  
      37  ### Enforcement
      38  
      39  Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project team responsible for enforcement at [coc@vercel.com](mailto:coc@vercel.com). All complaints will be reviewed and investigated promptly and fairly.
      40  
      41  All project maintainers are obligated to respect the privacy and security of the reporter of any incident.
      42  
      43  Project maintainers who do not follow or enforce the Code of Conduct in good
      44  faith may face temporary or permanent repercussions as determined by other
      45  members of the project's leadership.
      46  
      47  ### Attribution
      48  
      49  This Code of Conduct is adapted from the [Contributor Covenant][homepage], version 2.1,
      50  available at [https://www.contributor-covenant.org/version/2/1/code_of_conduct/][version]
      51  
      52  [homepage]: http://contributor-covenant.org
      53  [version]: https://www.contributor-covenant.org/version/2/1
      54  
      end of file"
    `);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    // Should show 50 lines starting from line 20
    expect(text).toContain('20  ');
    expect(text).toContain('21  ');
    expect(text.split('\n').length).toMatchInlineSnapshot(`36`);
  });

  it('should handle 404 for non-existent file', async () => {
    const response = await fetch(`${baseUrl}/file/nonexistent.txt`);

    expect(response.status).toBe(404);
  });

  it('should handle search with no results', async () => {
    const response = await fetch(`${baseUrl}/search/thisdoesnotexistanywhere12345`);
    const text = await response.text();

    expect(response.status).toMatchInlineSnapshot(`200`);
    expect(text).toMatchInlineSnapshot(`"No results found."`);
  });
}, 1000 * 100);
