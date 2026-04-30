import { defineConfig, devices } from "@playwright/test";

const testAccounts = Array.from({ length: 5 }, (_, index) => {
  const number = index + 1;
  return {
    id: `00000000-0000-4000-8000-00000000000${number}`,
    email: `tester${number}@example.test`,
    password: `test-password-${number}`,
    displayName: `Tester ${number}`
  };
});

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "sh -c 'pids=$(lsof -ti:4000 || true); if [ -n \"$pids\" ]; then kill $pids; fi; docker compose down -v && docker compose up -d --wait postgres && pnpm --filter @gen-image-studio/api db:migrate && pnpm --filter @gen-image-studio/api build && pnpm --filter @gen-image-studio/api start'",
      url: "http://localhost:4000/graphql",
      reuseExistingServer: false,
      env: {
        API_PORT: "4000",
        WEB_ORIGIN: "http://localhost:5173",
        SESSION_SECRET: "playwright-session-secret",
        PASSKEY_RP_ID: "localhost",
        PASSKEY_ORIGIN: "http://localhost:5173",
        PROVIDER_SECRET_KEY: process.env.PROVIDER_SECRET_KEY ?? "playwright-provider-secret",
        ENABLE_E2E_PASSWORD_LOGIN: "true",
        E2E_TEST_ACCOUNTS_JSON: process.env.E2E_TEST_ACCOUNTS_JSON ?? JSON.stringify(testAccounts)
      }
    },
    {
      command: "sh -c 'pids=$(lsof -ti:5173 || true); if [ -n \"$pids\" ]; then kill $pids; fi; pnpm --filter @gen-image-studio/web dev'",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      env: {
        VITE_GRAPHQL_URL: "http://localhost:4000/graphql"
      }
    }
  ]
});
