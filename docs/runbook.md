# Operations runbook

## GitHub and Vercel setup

Create GitHub environments named `preview` and `production`. Require reviewer approval on `production`. Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `HEALTHCHECK_SECRET`, `STAGING_DATABASE_URL` and `PRODUCTION_DATABASE_URL` to the appropriate environments. Configure staging Clerk, Arcjet and PostHog values in Vercel Preview, and production values only in Vercel Production.

Disable Vercel Git deployments so GitHub Actions is the only deployment owner. Protect `main` and require the six CI jobs before merge.

## Migration policy

Application startup never changes the schema. CI applies every migration to a new PostgreSQL database. Preview and production use `prisma migrate deploy`.

Schema changes use three releases when compatibility requires it:

1. Expand with nullable columns, new tables or compatible indexes.
2. Deploy code and migrate existing data.
3. Remove old fields only after no deployed version reads them.

Review generated SQL. Take a provider snapshot before destructive data work. A failed database migration is repaired with a forward migration or restored from the provider snapshot. Never edit an already applied migration and never automatically roll a database backward.

## Deployment recovery

If build or migration fails, production is unchanged. If deployment or the protected smoke check fails, the workflow runs `vercel rollback` to restore the previous production alias. Confirm `/api/health`, `/arena` and one owned thread after recovery.

## Dependency failures

| Failure                       | Expected behavior                                          | Response                                                               |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| PostgreSQL unavailable        | Health returns 503, writes and data pages fail plainly     | Check provider status and connection limits, then restore or fail over |
| OpenRouter credential invalid | Each lane fails without exposing the provider response     | Rotate the Vercel secret and redeploy                                  |
| Clerk unavailable or invalid  | Authenticated surfaces reject access                       | Check Clerk status and keys, never bypass ownership checks             |
| Arcjet unavailable            | Follow the documented failure policy per protected surface | Check Arcjet status and configuration before changing policy           |
| PostHog unavailable           | Product continues, analytics logs its own failure          | Restore credentials or host, no generation rollback needed             |

## Investigating a generation

Start with the `requestId` from the user visible failure or platform log. Search structured logs for that value, then follow `threadId`, `turnId`, `messageId`, `model` and `attempt`. Match the same generation in PostHog by its correlation properties. Inspect the message row last to confirm its current attempt and lifecycle state before retrying or repairing data.
