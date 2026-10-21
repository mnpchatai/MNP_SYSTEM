# MNP_SYSTEM

@AGENTS.md

## Subagents

Project subagents live in `.claude/agents/`. AGENTS.md stays the single source of rules; an agent file names its role and points back to AGENTS.md instead of restating it.

| Agent | Use for | Edits tracked files |
|---|---|---|
| `researcher` | Reading code, docs and git history; tracing a bug to its root cause | No |
| `auditor` | Independent review and verification of a change before merge | No |

Workflow for a non-trivial change: plan, implement, commit locally, `auditor`, fix what it finds, confirm with the user, push.

- Commit before running `auditor`. `scripts/ci/check-pr-guards.sh` only inspects committed state, so on uncommitted work its `?v=` and migration checks pass without checking anything.
- Give `auditor` the task and the diff, not your own conclusion, so its read stays independent.
- When the change touches migrations, security-definer functions or RPCs, RLS or grants, Edge Functions, or authentication and account flows (for example `supabase/migrations/`, `supabase/functions/`, `src/lib/supabase/`, `src/app/auth/`), call `auditor` with `model: "opus"`. Other changes use the agent's default.
- Read-only is held by each agent's instructions, not by its tool list: Bash can still write. Hard enforcement needs a `permissions.deny` rule or a `PreToolUse` hook in settings.
- A change that ships a migration together with client code that depends on it must stop for the user's approval to apply the migration (see "Deployment order" in AGENTS.md).
- The session model is not set in this repository; choose it when starting a session (`/model` switches it later). An agent's default model is the `model:` line in its own file.
