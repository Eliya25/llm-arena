# ADR 0003: Idempotent attempts

Status: Accepted

One model has one message row per turn. A retry increments `attempt` and rewrites that row. Every checkpoint and terminal update names its attempt, so an older stream cannot overwrite the replacement. Unique client keys converge concurrent lanes on one thread and turn.
