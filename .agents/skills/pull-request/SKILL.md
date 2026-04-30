---
name: pull-request
description: >
  Create, format, or open a pull request. Use when the user asks to open a PR,
  create a pull request, or submit their branch for review.
---

## Creating a Pull Request

1. Ensure formatting and linting checks have passed before creating a PR.
2. Ensure all changes are committed and the branch is pushed to origin.
3. Derive the PR title from the branch name: convert the branch slug (e.g. `303-add-field-groups`) to `<ID>: <Title>` format (e.g. `303: Add field groups`).
4. The PR description should include brief bullet points of the key changes.
5. Use the `mcp_io_github_git_create_pull_request` tool to open the PR targeting `main`.
6. Print the `http_url` of the created PR to the user.

## PR Description Format

- Use bullet points, not prose
- Start each bullet point with a verb (e.g. "Added", "Fixed", "Updated", "Removed")
- Group related changes under sub-headings if there are many
- Mention any database migrations or schema changes explicitly
- Mention any breaking changes
