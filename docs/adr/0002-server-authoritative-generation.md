# ADR 0002: Server authoritative generation

Status: Accepted

The backend reads the upstream stream, measures it and persists the result. The browser receives a copy for display but cannot submit final content or metrics. This closes the leaderboard trust boundary and lets a generation finish after the browser disconnects.
