# ADR 0006: Isolated CI database

Status: Accepted

Every CI database job starts a PostgreSQL service container and applies committed migrations. It never uses the developer test instance or production data. This permits destructive lifecycle and concurrency tests without collision between CI and local runs.
