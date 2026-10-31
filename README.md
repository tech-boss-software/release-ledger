# Release Ledger

An independent software-engineering demo of durable release evidence, idempotent API writes and digest-bound approval. Node.js 24, built-in SQLite, no packages or cloud accounts.

## Run

```sh
node --test
node demo.mjs
```

For the HTTP service, set a random `LEDGER_TOKEN` of at least 32 characters in your local environment, then run `node server.mjs`. It binds to `127.0.0.1:8790`. All routes except `GET /healthz` require `Authorization: Bearer <token>`. Set `LEDGER_DB` for a persistent database path.

## API and lifecycle

1. `POST /releases` with `{ "project": "demo", "digest": "<64 lowercase SHA-256 hex characters>" }` and an `Idempotency-Key` header. Matching retries return the same release; reusing a key for changed content returns 409.
2. `POST /releases/{id}/attest` with `gate` (`qa` or `security`), `actor`, `reference`, and the exact `digest`.
3. `POST /releases/{id}/approve` with `actor`, exact `digest`, and `confirmation: "approve-production-release"`. Both attestations must exist.
4. `GET /releases/{id}` returns the candidate, evidence and ordered events.

Approved records are immutable. New bytes require a new candidate. Transactions prevent partially written releases; SQLite survives restarts. Request bodies are capped at 16 KiB. Tests cover retries, mismatched artifacts, missing evidence, persistence and HTTP authorization.

## Design boundaries

This is a single-operator demonstration. Actor names and evidence references are declarations; the service does not authenticate human approvers, inspect evidence, prove reviewer independence or execute deployments. Production use needs per-user authentication, role separation, trusted evidence verification, TLS, rate limiting, monitored storage and backup/restore validation. Bearer authentication grants all local API actions and is not a multi-tenant authorization model.

`examples/release.json` is generated from synthetic bytes and clearly marked demo evidence. No customer data, performance or production-readiness claims. Comments focus on transaction boundaries and why approvals bind to artifact bytes.
