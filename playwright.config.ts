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
    baseURL: "http://127.0.0.1:5173",
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
      command: "docker compose down -v && docker compose up -d --wait postgres && pnpm --filter @gen-image-studio/api db:migrate && pnpm --filter @gen-image-studio/api build && pnpm --filter @gen-image-studio/api start",
      url: "http://127.0.0.1:4000/graphql",
      reuseExistingServer: !process.env.CI,
      env: {
        API_PORT: "4000",
        WEB_ORIGIN: "http://127.0.0.1:5173",
        PASSKEY_RP_ID: "localhost",
        PASSKEY_ORIGIN: "http://127.0.0.1:5173",
        ENABLE_E2E_PASSWORD_LOGIN: "true",
        E2E_TEST_ACCOUNTS_JSON: process.env.E2E_TEST_ACCOUNTS_JSON ?? JSON.stringify(testAccounts)
      }
    },
    {
      command: "pnpm --filter @gen-image-studio/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_GRAPHQL_URL: "http://127.0.0.1:4000/graphql"
      }
    }
  ]
});
