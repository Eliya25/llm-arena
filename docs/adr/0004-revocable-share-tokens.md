# ADR 0004: Revocable share tokens

Status: Accepted

Threads are private by default. Sharing uses a random 256 bit token at `/share/{token}` and stores only its SHA 256 hash. Revocation is explicit and sharing again rotates the token. This separates public capability URLs from internal database identifiers without building a general permissions system.
