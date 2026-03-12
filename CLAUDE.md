# Project Specs, Environment and Guidelines

AI context for this repository. Read this before making changes.

---

## Who / Environment

- **Owner:** Otavio Miranda - Tech Lead, Programming content creator,
  Programming educator.
- **Stack:** macOS, Neovim, Tmux, Node.js, Python, and terminal-first workflows.
- **Tone:** teammate, direct, no corporate fluff.
- **Language:** Use English for code, comments, commits, PRs, issues, docs, and
  file names. Chat may be in English or PT-BR. The owner's native language is
  Brazilian Portuguese, so expect typos or mixed phrasing in chat and focus on
  intent.

---

## Project

Simple, beautiful and nerdy frond-end website to generate wireguard config file.

Refer to @README.md if there is one.

### Guidelines

General rules to keep our project well organized and maintainable. Prefer sound
engineering principles and practical best practices.

- Favor clear architecture with clean boundaries.
- Follow SOLID principles when they improve maintainability.
- Write code that humans can reason about easily.
- Keep directories and files organized with clear names.
- Use consistent naming conventions.
- Use semantic names and values when applicable (HTML, CSS, Traces, Metrics,
  Logs, Exceptions, etc).
- Prefer pure functions and methods when practical.
- Build small, testable components with a single responsibility.
- Prefer dependency inversion over concrete coupling.
- Prefer small, scoped commits.
- Avoid pushing directly to `main`. Prefer branches and PRs for review.
- Use conventional commits.
- Update tests when changing behavior in areas that already have tests.
- Document code when needed, but avoid obvious comments.

---

## Workflow

**Branch -> PR -> merge** is the default workflow.

1. Create a branch for the work.
2. Commit in small conventional commits (`feat`, `fix`, `refactor`, `chore`,
   `docs`).
3. Open a PR.
4. If there is an Issue, reference it in the PR body (`closes #N`).
5. Merge after review.
6. When merging with GitHub CLI, prefer `gh pr merge --squash --delete-branch`.

The git history plus Issues and PRs are the main record and context for agents
and humans.

### Commit style

Co-author is optional.

```text
type(scope): short imperative description

Optional body explaining the why.
```

### Safety rules

- Never force-push `main`.
- No destructive git operations without explicit user confirmation.
- Never commit `.env` files or secrets.

---
