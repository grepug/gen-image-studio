# Gen Image Studio

Gen Image Studio is a workspace-based image generation app where users bring their own model provider credentials, upload Agent Skills-compatible packages, and collaborate inside shared workspaces.

## Stack

- pnpm monorepo
- Vite + React + Apollo Client + Base UI in `apps/web`
- NestJS + GraphQL + Drizzle + PostgreSQL in `apps/api`
- Vercel AI SDK provider wiring for user-configured language models, plus a direct gen-gallery-compatible Responses image transport
- Shared frontend/backend contracts in `packages/shared`

## Local Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev
```

The app does not use global model provider environment variables such as `OPENAI_API_KEY`. Users configure provider base URLs, API keys, models, and capabilities in the app. The API stores those secrets server-side and only returns redacted status to the frontend.

## Local Test Login

`.env.example` enables local/e2e password login for repeatable browser validation. It is gated by:

```bash
ENABLE_E2E_PASSWORD_LOGIN=true
```

With no `E2E_TEST_ACCOUNTS_JSON` override, the API creates five local accounts on demand:

- `tester1@example.test` / `test-password-1`
- `tester2@example.test` / `test-password-2`
- `tester3@example.test` / `test-password-3`
- `tester4@example.test` / `test-password-4`
- `tester5@example.test` / `test-password-5`

Set `ENABLE_E2E_PASSWORD_LOGIN=false` outside local development and automated tests.

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

Uploaded skills follow the AI SDK Agent Skills directory model. Each package must include a `SKILL.md` file with frontmatter metadata. The backend indexes metadata, stores the original package and extracted instruction asset, and uses those instructions when running image generation jobs.

Image generation requests use the direct gen-gallery-compatible Responses request shape against each workspace provider profile: the API posts to the user-configured provider base URL with that provider's stored API key, text model, image tool model, and image-generation tool capability. It does not read global provider keys from process environment.

For zipped packages, generation also includes bounded text files from safe support paths such as `references/` and text-like `assets/`. Package scripts and binary files are not executed or added to prompts.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

CI is intentionally skipped for now.
