# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `wh3at/pi-zen`.
Use the `gh` CLI. Infer the repository from `git remote -v`.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub issues and PRs share a number space. When the type is
ambiguous, try `gh pr view <number>`, then `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Children: link tickets as GitHub sub-issues. If unavailable,
  use a task list in the map and `Part of #<map>` in each child.
- Types: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use native GitHub issue dependencies. Add an edge
  with `gh api --method POST repos/wh3at/pi-zen/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Obtain the database ID with
  `gh api repos/wh3at/pi-zen/issues/<blocker> --jq .id`.
  If dependencies are unavailable, record `Blocked by: #<number>`
  in the child body.
- Frontier: take the first open, unassigned child in map order
  with no open blockers.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the answer, close the child, and append
  a summary and link to the map’s Decisions-so-far.
