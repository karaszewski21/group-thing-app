## Coding Standards & Conventions

Read @.maister/docs/INDEX.md before starting any task. It indexes the project's coding standards and conventions:
- Coding standards organized by domain (frontend, backend, testing, etc.)
- Project vision, tech stack, and architecture decisions

Follow standards in `.maister/docs/standards/` when writing code — they represent team decisions. If standards conflict with the task, ask the user.

### Standards Evolution

When you notice recurring patterns, fixes, or conventions during implementation that aren't yet captured in standards — suggest adding them. Examples:
- A bug fix reveals a pattern that should be standardized (e.g., "always validate X before Y")
- PR review feedback identifies a convention the team wants enforced
- The same type of fix is needed across multiple files
- A new library/pattern is adopted that should be documented

When this happens, briefly suggest the standard to the user. If approved, invoke `/maister:standards-update` with the identified pattern.

## Maister Workflows

This project uses the maister plugin for structured development workflows. When any `/maister:*` command is invoked, execute it via the Skill tool immediately — do not skip workflows for "straightforward" tasks. The user chose the workflow intentionally; complexity assessment is the workflow's job.

## Secrets

Never print secret values to tool output — they end up in session transcripts and model context.
- Do not run `env`, `printenv`, `docker compose exec <svc> env`, `docker inspect` (Env section) or `cat .env` unfiltered. To check configuration, test presence only, e.g. `docker compose exec -T backend sh -c '[ -n "$SPACES_KEY" ] && echo set || echo missing'`.
- Never write secret values into reports, task folders, screenshots or commits. `.env` stays git-ignored; only `.env.example` with placeholders is tracked.
- Subagent prompts that touch configuration or infrastructure must repeat this rule.
