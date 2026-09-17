# Repository Instructions

Read and follow `CLAUDE.md` for the existing project, engineering, language, safety,
and branch/PR conventions. Keep that file intact when updating skills setup.

## Agent skills

### Issue tracker

Use GitHub Issues for `luizomf/wgfront` through `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the existing category labels and configured state mappings. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

### Git worktrees

Create new Git worktrees only under
`~/sannux-data/worktrees/<repo>/<worktree_name>`, never inside the checkout or
in its sibling directories. This central root is host-local and excluded by
`synchosts`; transfer a worktree explicitly when another host needs it. Do not
relocate existing worktrees solely to apply this rule.

### Delegation models

Before a model-selectable delegation, read [model-routing](../omskills/skills/productivity/model-routing/SKILL.md)
even when absent from the discovery list, and select for the delegated task rather
than the parent's model. Resolve the link relative to this instruction file, not
the working directory. Honor explicit user choices and authorized provider/model
scope. Follow the active harness's model-selection authorization requirements;
use inheritance when no selection is authorized.
