# ADR 0007: Compatible production migrations

Status: Accepted

GitHub Actions owns deployment. It builds one Vercel artifact, applies a backward compatible migration, deploys that artifact and runs a protected smoke check. Application rollback changes the Vercel alias. Database recovery uses a forward fix or provider snapshot because an automatic down migration can destroy data.
