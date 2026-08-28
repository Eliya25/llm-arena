# ADR 0005: SQL leaderboard aggregation

Status: Accepted

The original leaderboard transferred every voted turn and message into Node. At 100,000 turns it shipped 160,003 rows and took 1,585ms. One SQL aggregation reduced this to three rows and 316ms. Caching was rejected because the measured result is adequate and freshness has value.
