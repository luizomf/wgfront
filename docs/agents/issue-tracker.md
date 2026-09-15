# Issue Tracker: GitHub

Specs, tickets, issues, and durable delivery records live in GitHub Issues for
`luizomf/wgfront`. Use `gh` through the repository's required RTK wrapper.

## Operations

- Create: `rtk gh issue create --title "..." --body-file /tmp/issue.md`.
- Read the complete body and comments: `rtk gh issue view <number> --comments`.
- List: `rtk gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `rtk gh issue comment <number> --body-file /tmp/comment.md`.
- Labels: `rtk gh issue edit <number> --add-label "..." --remove-label "..."`.
- Close: `rtk gh issue close <number> --comment "..."`.
- Infer repository identity from the Git remote, or pass `--repo luizomf/wgfront`.

## Relations and delivery

Create all issue identities before adding relations. Use native GitHub blocking
relations: `rtk gh api --method POST repos/luizomf/wgfront/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-database-id>`.
Obtain the numeric database ID with `rtk gh api repos/luizomf/wgfront/issues/<number> --jq .id`.
If native dependencies are unavailable, record `Blocked by: #N` in the issue body.
Record conflicts in a `Conflicts with` section with linked issue numbers and the
shared surface; conflicts prohibit concurrent writers, not independent completion.

Use GitHub sub-issues for parent/child relationships when available; otherwise use
a parent task list and a `Part of #N` child reference. Wayfinder maps and children
use the skill's `wayfinder:map` and `wayfinder:<type>` labels when that workflow is
requested; do not provision unrelated labels proactively.

Follow `CLAUDE.md`: branch, conventional commits, reviewed PR, squash merge to
`main`. Reference `closes #N`; record the source commit and resulting squash commit
in the issue delivery evidence. Verify the automatic Pages deployment separately.
Do not dispatch a duplicate deployment merely because a merge triggers one.

## Pull requests as a triage surface

**PRs as a request surface: no.** External PR discovery is not enabled. An explicitly
named PR may still be reviewed. GitHub issues and PRs share number space: resolve
an ambiguous bare number with `rtk gh pr view <number>`, falling back to
`rtk gh issue view <number>`.

Publishing to the tracker means creating a GitHub issue. Fetching a ticket means
reading its full body and comments, not relying on a list snippet. Triage/readiness
and explicit execution authorization are separate; an available maintainer can
request ordinary Direct Assisted work without an unattended-readiness audit.
