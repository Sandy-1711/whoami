# Langfuse — self-hosted

Traces for every model call the toolkit makes: the rendered prompt, the model's reply, tokens,
latency and cost. Self-hosted so JD text and the fact base never leave the machine
(see [../../docs/DECISIONS.md](../../docs/DECISIONS.md)).

```sh
pnpm langfuse:up      # start the stack (Docker must be running)
pnpm langfuse:down    # stop it; volumes and traces survive
```

`docker-compose.yml` is the upstream self-host file, copied verbatim from
<https://github.com/langfuse/langfuse/blob/main/docker-compose.yml> so it can be diffed against
upstream when Langfuse is updated. Do not hand-edit it — override with an env file instead
(below). The stack is Postgres, ClickHouse, Redis, MinIO, plus the Langfuse web and worker
containers; it is heavy, so run it only while you want traces.

## First run

1. `pnpm langfuse:up`, then open <http://localhost:3000> and create an account. It is local and
   empty — any email and password will do.
2. Create an organization and a project, then **Settings → API keys → Create**.
3. Put the pair in the repo-root `.env` and turn tracing on:

   ```sh
   LANGFUSE_ENABLED=1
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_BASE_URL=http://localhost:3000
   ```

Leave `LANGFUSE_ENABLED` blank and nothing is exported — the tracer is never even loaded. With it
on but the stack down, spans are dropped in the background; a résumé run still completes.

## Credentials

Every password in the compose file is an upstream placeholder marked `# CHANGEME`, and every one
of them is overridable by an environment variable. For a laptop-local instance bound to
`127.0.0.1` the defaults are fine. To change them, write `infra/langfuse/.env` — Docker Compose
reads it automatically because it sits beside the compose file, and the repo's `.gitignore`
already covers `.env` at any depth:

```sh
POSTGRES_PASSWORD=...
CLICKHOUSE_PASSWORD=...
REDIS_AUTH=...
MINIO_ROOT_PASSWORD=...
NEXTAUTH_SECRET=...            # openssl rand -base64 32
SALT=...                       # openssl rand -base64 32
ENCRYPTION_KEY=...             # openssl rand -hex 32
```

## Ports

| Port | Service |
| --- | --- |
| 3000 | Langfuse web UI |
| 3030 | Langfuse worker |
| 5432 | Postgres |
| 6379 | Redis |
| 8123, 9000 | ClickHouse |
| 9090, 9091 | MinIO (S3 API, console) |

Only 3000 and 9090 accept connections from other machines; the rest bind `127.0.0.1`.
