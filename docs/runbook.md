# Operations runbook

## Implemented and used now: portfolio Preview

GitHub Actions owns the deployment pipeline. The chosen operating target is a public Vercel Preview on a `*.vercel.app` URL. It uses isolated staging services and Clerk development or test credentials. Vercel Authentication is disabled for the public Preview, and the deployment workflow requires the protected health route to return exactly `{"status":"ok"}`. There is no required custom domain, Clerk Production instance or Vercel Production deployment.

Disable Vercel Git deployments so GitHub Actions remains the only deployment owner. In Vercel Project Settings, disable Vercel Authentication for Preview deployments so the portfolio URL is publicly reachable. Protect `main` in GitHub and require these six CI checks before merge:

- `format`
- `lint`
- `typecheck`
- `unit-tests`
- `database-tests`
- `build`

Create one GitHub environment named `preview` with these secrets:

| Secret                 | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `VERCEL_TOKEN`         | Authenticates the pinned Vercel CLI                    |
| `VERCEL_ORG_ID`        | Selects the linked Vercel account or team              |
| `VERCEL_PROJECT_ID`    | Selects the `llm-arena` project                        |
| `STAGING_DATABASE_URL` | Applies compatible migrations to the staging database  |
| `HEALTHCHECK_SECRET`   | Authenticates the protected post deploy health request |

Configure these values for the Vercel Preview environment only:

- `DATABASE_URL`, using the isolated staging PostgreSQL database
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, using the Clerk development or test instance
- `ARCJET_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`
- `OPENROUTER_API_KEY`
- `HEALTHCHECK_SECRET`, matching the GitHub Preview environment secret

Load testing adds `LOAD_TEST_MODE`, `LOAD_TEST_SECRET` and `OPENROUTER_CHAT_URL` only on the separate `llm-arena-load` Preview project. Do not enable those values on the normal portfolio Preview or any Production deployment.

The official capacity run used a public seeded share path, three mock model IDs and saved Clerk development session tokens supplied outside the repository. None of those ephemeral inputs is stored in Git. The exact method and measured result are listed in `docs/capacity.md`.

After CI succeeds, the deployment workflow checks out the exact passing commit, pulls Vercel Preview configuration, applies migrations with `prisma migrate deploy`, builds a prebuilt artifact with the pinned CLI and deploys it. The final smoke check calls `/api/health` with the bearer secret and requires the exact `{"status":"ok"}` response.

## Migration policy

Application startup never changes the schema. CI applies every migration to a new PostgreSQL database. The portfolio Preview applies reviewed migrations to staging with `prisma migrate deploy`.

Schema changes use three releases when compatibility requires it:

1. Expand with nullable columns, new tables or compatible indexes.
2. Deploy code and migrate existing data.
3. Remove old fields only after no deployed Preview reads them.

Review generated SQL. Take a provider snapshot before destructive data work. Repair a failed migration with a forward migration or restore the staging database from its provider snapshot. Never edit an already applied migration and never automatically roll a database backward.

## Preview deployment recovery

If CI, migration or build fails, do not treat the candidate as deployed. Because migrations are compatible by policy, a successful expand migration may safely remain when a later build step fails.

If deployment or the real health check fails:

1. Keep the last known working Preview URL available.
2. Inspect the failed GitHub job and Vercel runtime logs.
3. Fix forward and rerun the workflow, or redeploy the last known good commit as another Preview.
4. Confirm `/api/health`, `/arena` and one owned thread.

There is no active production alias rollback. Database recovery remains a provider snapshot or forward migration, never an automatic schema rollback.

## Dependency failures

| Failure                       | Expected behavior                                          | Response                                                                       |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PostgreSQL unavailable        | Health returns 503, writes and data pages fail plainly     | Check provider status and connection limits, then restore the staging database |
| OpenRouter credential invalid | Each lane fails without exposing the provider response     | Rotate the Vercel Preview secret and redeploy                                  |
| Clerk unavailable or invalid  | Authenticated surfaces reject access                       | Check the Clerk development instance and keys, never bypass ownership checks   |
| Arcjet unavailable            | Follow the documented failure policy per protected surface | Check Arcjet status and Preview configuration before changing policy           |
| PostHog unavailable           | Product continues, analytics logs its own failure          | Restore Preview credentials or host, no generation rollback needed             |

## Investigating a generation

Start with the `requestId` from the user visible failure or platform log. Search structured logs for that value, then follow `threadId`, `turnId`, `messageId`, `model` and `attempt`. Match the same generation in PostHog by its correlation properties. Inspect the message row last to confirm its current attempt and lifecycle state before retrying or repairing data.

## Optional future: full production environment

A future owner may choose to add a custom domain, Clerk Production credentials, a separate production database, approval gates and production alias recovery. None of those are implemented, used or required for the current portfolio deployment or V2 completion. If that operating model is adopted later, design and verify it as a separate change rather than treating this note as an active runbook.
