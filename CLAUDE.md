# MNP_SYSTEM

@AGENTS.md

## Subagents

Project subagents live in `.claude/agents/`. AGENTS.md stays the single source of rules; an agent file names its role and points back to AGENTS.md instead of restating it.

| Agent | Use for | Edits tracked files |
|---|---|---|
| `researcher` | Reading code, docs and git history; tracing a bug to its root cause | No |
| `coder` | Implementing a change: code, tests, migrations | Yes, left uncommitted for review |
| `auditor` | Independent review and verification of a change before merge | No |
| `security-auditor` | Deep security review, only when the user asks for one | No |

Workflow for a non-trivial change: plan, implement (`coder` or the main session), commit locally, `auditor`, fix the blocking findings, confirm with the user, push.

- Commit before running `auditor`. `scripts/ci/check-pr-guards.sh` only inspects committed state, so on uncommitted work its `?v=` and migration checks pass without checking anything.
- Give `auditor` the task and the diff, not your own conclusion, so its read stays independent.
- One `auditor` round per pull request. Fix its blocking findings. Put its non-blocking findings in the pull request description, or in a follow-up task, instead of fixing them in the same pull request, unless the defect was introduced by this change.
- Run `auditor` again only when fixing a blocking finding changed code or SQL (not wording or comments). Name the fix commits in the prompt as the scope, and stop once it reports no blocking issues.
- When the change touches migrations, security-definer functions or RPCs, RLS or grants, Edge Functions, or authentication and account flows (for example `supabase/migrations/`, `supabase/functions/`, `src/lib/supabase/`, `src/app/auth/`), call `auditor` with `model: "opus"`. Other changes use the agent's default.
- Run `coder`s in parallel only on different files, each with `isolation: "worktree"`. Never in parallel on `index.html` (its `?v=`), `app.js`, `styles.css`, `README.md` or `package.json` (the `test:unit` list is a single line), and never two that add migrations or change the same database function.
- A worktree `coder` may start from `origin/main` instead of your local commits (see the Claude Code worktree docs), so give it only tasks that do not depend on unpushed work. Its changes stay uncommitted in the worktree and it reports where to collect them.
- CI parses every agent file's frontmatter as YAML (`scripts/tests/agent-files.test.mjs`, using `js-yaml`, which may differ from the parser Claude Code uses). Quote a description that contains `: ` or ` #`, or reword it; Claude Code skips a file that does not parse, without any message.
- `security-auditor` runs only when the user asks. Its findings go to the user in the conversation, never into the repository.
- Give `security-auditor` a scope in the prompt. Without one it audits only the files changed against `origin/main`; a whole-repository audit happens only when the user asks for one, as its own task and not on a pull request's path. For a wide scope, split it by area (for example database and RLS, pilot and XSS) and run the calls in parallel; they are read-only. Critical and high findings hold the merge; the user decides on medium and low.
- The read-only agents' no-edit rule and the `coder`'s no-commit rule are held by instructions, not by tool lists: Bash can still write and commit. Hard enforcement needs a `permissions.deny` rule or a `PreToolUse` hook in settings.
- A change that ships a migration together with client code that depends on it must stop for the user's approval to apply the migration (see "Deployment order" in AGENTS.md).
- The session model is not set in this repository; choose it when starting a session (`/model` switches it later). An agent's default model is the `model:` line in its own file.
