# MNP_SYSTEM

@AGENTS.md

## Subagents

Project subagents live in `.claude/agents/`. AGENTS.md stays the single source of rules; an agent file names its role and points back to AGENTS.md instead of restating it.

| Agent | Use for | Edits files |
|---|---|---|
| `researcher` | Reading code, docs and git history; tracing a bug to its root cause | No |
| `auditor` | Independent review and verification of a change before commit or merge | No |

Workflow for a non-trivial change: plan, implement, `auditor`, fix what it finds, confirm with the user, commit.

- Give `auditor` the task and the diff, not your own conclusion, so its read stays independent.
- A change that ships a migration together with client code that depends on it must stop for the user's approval to apply the migration (see "Deployment order" in AGENTS.md).
- The session model is chosen when the session starts and is not set in this repository. An agent's default model is the `model:` line in its own file.
