# Triage Labels

| Kind | Canonical role | GitHub label | Meaning |
| --- | --- | --- | --- |
| Category | `bug` | `bug` | Existing behavior is broken |
| Category | `enhancement` | `enhancement` | New or changed behavior |
| State | `needs-triage` | `needs-triage` | Maintainer evaluation pending |
| State | `needs-info` | `question` | Waiting for reporter information; preserves the existing matching label |
| State | `ready-for-agent` | `ready-for-agent` | Eligible; separate authorization selects execution |
| State | `ready-for-human` | `ready-for-human` | Requires human implementation |
| State | `wontfix` | `wontfix` | Will not be actioned |

Use exactly one category and one mapped state when triaging. Preserve existing
label names, colors, descriptions, and unrelated labels. Newly created tickets
start with `enhancement` or `bug` plus `needs-triage`. A readiness label does not
authorize a Mission or replace its prerequisites.
