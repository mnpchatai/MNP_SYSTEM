# MNP_SYSTEM Agent Instructions

## Scope and project context

These instructions apply to the entire repository.

MNP_SYSTEM is an internal Mini ERP and paperless request/approval system. The primary application uses Next.js App Router, React, strict TypeScript, Supabase Auth/Postgres/Storage/Edge Functions, and is intended to run on Vercel. The repository also contains a static GitHub Pages pilot (`index.html`, `app.js`, and `styles.css`) and Google Apps Script support code under `apps-script/`.

Before changing code:

1. Read `README.md` and the relevant implementation and tests.
2. Read `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/MODULES.md` when those files exist.
3. Inspect the current working tree and do not overwrite, delete, stage, or commit unrelated user changes.
4. Identify the current behavior and preserve it unless the task explicitly requires a behavior change.

## Repository architecture

- `src/app/`: Next.js routes, layouts, Route Handlers, and Server Actions.
- `src/components/`: shared UI components. Reuse these before adding a similar component.
- `src/lib/`: shared authentication, Supabase, formatting, integration, and data-access helpers.
- `supabase/migrations/`: ordered, reviewable database migrations.
- `supabase/functions/`: Supabase Edge Functions.
- `supabase/tests/database/`: database, grant, RLS, RPC, and workflow tests.
- Root `index.html`, `app.js`, and `styles.css`: the static pilot client; it is not a trusted server boundary.
- `apps-script/`: Google Apps Script integrations and operational support code.

Keep UI, authorization, domain workflow, and persistence concerns separate. Prefer existing shared helpers, components, Server Actions, Route Handlers, and database functions over duplicating logic. When behavior is shared by the Next.js app and the static pilot, keep the implementations consistent or document an intentional difference.

Use Server Components by default. Add Client Components only where browser state, browser APIs, or event handlers require them. Do not move secrets or privileged operations into Client Components, browser bundles, the static pilot, or public environment variables. Keep Vercel serverless/runtime constraints in mind and do not rely on process-local state for durable business behavior.

## Authentication and authorization

- Treat authentication and authorization as separate checks.
- For every protected operation, verify the server-side session, the mapped active employee, the required role/permission and data scope, and the requested state transition.
- Never rely on hidden buttons, client-side checks, route visibility, request payload roles, or user-editable JWT metadata as authorization.
- Privileged writes must run only in trusted server code or tightly scoped database functions after authorization succeeds.
- Keep service-role/secret-key clients server-only and minimize their use. Prefer the user's Supabase session and RLS when it can perform the operation safely.
- Preserve auditability for approvals, rejections, status changes, assignments, comments, attachments, and administrative actions.

## Secrets and sensitive data

- Never commit or expose Supabase secret/service-role keys, database credentials, LINE channel secrets or access tokens, Vercel tokens, invite codes, client secrets, private keys, or production credentials.
- Never place a privileged secret in a variable prefixed with `NEXT_PUBLIC_`, in client code, in the static pilot, in logs, or in error messages.
- Commit only safe placeholders in `.env.example`; keep real values in approved environment-secret stores.
- Do not log passwords, access/refresh tokens, authorization headers, full webhook payloads containing personal data, or unnecessary employee data.

## Database and Supabase safety

- Never modify production data or schema directly. Use reviewed migrations and the approved deployment process.
- Never run destructive or production-targeting commands without explicit user approval, a verified target, and an appropriate backup/rollback plan. `npm run db:reset` is for a verified local Supabase stack only.
- Add schema changes as a new timestamped file in `supabase/migrations/`. Do not rewrite a migration that may already have been applied.
- Make migrations deterministic and safe to review. Where practical, provide rollback/recovery notes for destructive or irreversible changes.
- Enable and verify RLS for every table exposed through the Supabase Data API. Review grants as well as policies; RLS alone is not a complete permission model.
- Add both allow and deny tests for RLS, grants, RPCs, and role/data-scope boundaries. Update tests in `supabase/tests/database/` with the migration.
- Security-definer functions must use a safe fixed `search_path`, validate the caller and inputs, expose only the required privileges, and avoid authorization bypasses.
- Perform multi-table workflow transitions atomically. Validate the current state in the same transaction, prevent duplicate/replayed actions where relevant, and write status history/audit records.
- Keep Storage buckets private for internal attachments unless public access is an explicit requirement. Enforce ownership/scope, file size, and MIME restrictions, and use short-lived signed URLs.
- Seed files must contain development/test data only, never production exports or real credentials.

## TypeScript and implementation quality

- Keep TypeScript strict. Do not weaken `tsconfig.json` or use `any` to silence errors; prefer precise types, generics, type guards, and `unknown` at untrusted boundaries.
- Validate external input at every boundary, including forms, Route Handlers, Server Actions, webhooks, Edge Functions, Apps Script calls, and database RPC parameters.
- Handle failures explicitly and return user-safe messages without leaking implementation details or secrets.
- Reuse existing utilities and components. If two modules need the same domain rule, extract one tested shared implementation rather than copy/paste.
- Keep changes focused. Avoid unrelated refactors, formatting churn, dependency upgrades, or generated files unless the task requires them.
- Preserve accessibility, responsive layouts, Thai text behavior, and existing business terminology when editing the UI.

## Required verification

Before committing any change, run from the repository root:

```bash
npm run typecheck
npm run lint
npm run build
```

For database, RLS, grant, RPC, or migration changes, also start/verify the local Supabase stack and run:

```bash
npm run db:test
```

Add or update the smallest relevant automated tests for changed behavior. If a required check cannot run, report the exact reason and do not claim it passed.

Before the final commit:

1. Review `git status` and the complete diff.
2. Confirm that only task-related files are staged.
3. Confirm that no credential, environment file, generated output, production data, or unrelated user change is included.
4. Use a clear commit message that describes the change.
