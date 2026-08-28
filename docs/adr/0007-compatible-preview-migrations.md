# ADR 0007: Compatible Preview migrations

Status: Accepted

GitHub Actions owns deployment to the public portfolio Preview. It builds one Vercel artifact from the exact passing commit, applies a backward compatible staging migration, deploys that artifact and requires the protected health route to return its exact success response. A failed candidate leaves the previous working Preview available. Database recovery uses a forward fix or provider snapshot because an automatic down migration can destroy data.
