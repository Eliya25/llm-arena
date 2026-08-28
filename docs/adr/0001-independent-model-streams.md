# ADR 0001: Independent model streams

Status: Accepted

Each selected model receives its own request and SSE response. One slow, stalled or failed provider lane does not delay another lane. This uses more concurrent functions than a combined stream, but preserves partial success and makes retry ownership clear.
