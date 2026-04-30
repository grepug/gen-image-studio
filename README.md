# Gen Image Studio

Gen Image Studio is a workspace-based image generation app where users bring their own model provider credentials, upload Agent Skills-compatible packages, and collaborate inside shared workspaces.

## Stack

- pnpm monorepo
- Vite + React + Apollo Client + Base UI in `apps/web`
- NestJS + GraphQL + Drizzle + PostgreSQL + Vercel AI SDK in `apps/api`
- Shared frontend/backend contracts in `packages/shared`

## Local Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm dev
```

The app does not use global model provider environment variables such as `OPENAI_API_KEY`. Users configure provider base URLs, API keys, models, and capabilities in the app. The API stores those secrets server-side and only returns redacted status to the frontend.

## Passkeys

For local development:

```bash
PASSKEY_RP_ID=localhost
PASSKEY_ORIGIN=http://localhost:5173
```

Production deployments must set these values to the deployed domain and origin.

## Workspaces

All product data is scoped to a workspace. Users authenticate individually with passkeys and access provider profiles, skills, assets, jobs, events, and outputs through workspace memberships.

Initial roles:

- `owner`
- `admin`
- `member`
- `viewer`

## Agent Skills

Uploaded skills follow the AI SDK Agent Skills directory model. Each package must include a `SKILL.md` file with frontmatter metadata. The backend indexes metadata and stores the original package/extracted directory reference, but this foundation slice does not execute uploaded code.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

CI is intentionally skipped for now.

