# Dhund Research AI

NestJS modular monolith with a single Docker image and two runtime roles: `api` and `worker`.

## Prerequisites

- Node.js 22+
- Docker and Docker Compose

## Local development

```bash
npm install
npm run start:dev:api      # HTTP + Socket.IO on :3000
npm run start:dev:worker   # background worker (no HTTP)
```

## Build and run roles

```bash
npm run build
npm run start:api
npm run start:worker
```

Both roles use the same entrypoint:

```bash
node dist/main.js --role=api
node dist/main.js --role=worker
```

## Docker Compose (Postgres + pgvector + Redis)

```bash
docker compose up --build
```

Services:

- `api` — HTTP on port 3000
- `worker` — no HTTP listener
- `postgres` — pgvector-enabled Postgres on 5432
- `redis` — Redis on 6379

Copy `.env.example` to `.env` for non-Docker local runs.

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
```

## Layering

Source is organized L0 → L5:

```
src/l0/              # ports + adapters (vendor SDKs only here)
src/platform/        # L1
src/iam/             # L2
src/projects/        # L3
src/ingestion/       # L4
src/retrieval/
src/evidence/
src/orchestration/   # L5
src/ai/
```

Dependency direction is strictly downward. Import-direction checks run in ESLint and Jest static tests.

## Architecture notes

- One Docker image, two entrypoints (`--role=api` / `--role=worker`)
- Worker never binds an HTTP port
- PostgreSQL is the authoritative store; Redis is not a source of truth
