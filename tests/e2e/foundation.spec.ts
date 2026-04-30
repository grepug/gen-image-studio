import { expect, Page, test } from "@playwright/test";

const accounts = [
  { email: "tester1@example.test", password: "test-password-1", displayName: "Tester 1" },
  { email: "tester2@example.test", password: "test-password-2", displayName: "Tester 2" },
  { email: "tester3@example.test", password: "test-password-3", displayName: "Tester 3" },
  { email: "tester4@example.test", password: "test-password-4", displayName: "Tester 4" },
  { email: "tester5@example.test", password: "test-password-5", displayName: "Tester 5" }
];

async function login(page: Page, account = accounts[0]) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gen Image Studio" })).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(account.displayName)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal Workspace" })).toBeVisible();
}

async function resetBrowserState(page: Page) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
}

async function addVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true
    }
  });
}

test.describe("foundation workspace flows", () => {
  test("allows all five configured test accounts to log in", async ({ page }) => {
    for (const account of accounts) {
      await resetBrowserState(page);
      await login(page, account);
    }
  });

  test("persists and clears the server session cookie", async ({ page }) => {
    await resetBrowserState(page);
    await login(page);

    await page.reload();
    await expect(page.getByText(accounts[0].displayName)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Gen Image Studio" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("registers a passkey and signs back in with it", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await resetBrowserState(page);
    await login(page);

    await page.getByRole("button", { name: "Register Passkey" }).click();
    await expect(page.getByText("Passkey registered")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.getByText(accounts[0].displayName)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal Workspace" })).toBeVisible();
  });

  test("rejects invalid password login", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(accounts[0].email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid test login credentials")).toBeVisible();
  });

  test("creates a workspace provider profile without rendering the API key", async ({ page }) => {
    await login(page);

    await page.getByLabel("Provider name").fill("Workspace Image Provider");
    await page.getByLabel("Base URL").fill("https://models.example.test/v1");
    await page.getByLabel("Default model").fill("gpt-image-workspace");
    await page.getByLabel("API key").fill("super-secret-e2e-key");
    await page.getByRole("button", { name: "Save Provider" }).click();

    await expect(page.getByText("Workspace Image Provider")).toBeVisible();
    await expect(page.getByText("https://models.example.test/v1")).toBeVisible();
    await expect(page.getByText("gpt-image-workspace")).toBeVisible();
    await expect(page.getByText("super-secret-e2e-key")).toHaveCount(0);
  });

  test("indexes a valid Agent Skill from SKILL.md content", async ({ page }) => {
    await login(page);

    await page.getByLabel("SKILL.md").fill(`---
name: e2e-image-skill
description: Generates images for the Playwright flow.
version: 2.0.0
---

# E2E Image Skill
`);
    await page.getByRole("button", { name: "Validate Skill" }).click();

    await expect(page.getByText("Indexed e2e-image-skill")).toBeVisible();
    await expect(page.locator(".skill-item").filter({ hasText: "e2e-image-skill" })).toBeVisible();
  });

  test("shows validation errors for invalid Agent Skill content", async ({ page }) => {
    await login(page);

    await page.getByLabel("SKILL.md").fill("# No frontmatter here");
    await page.getByRole("button", { name: "Validate Skill" }).click();

    await expect(page.getByText("SKILL.md must start with YAML frontmatter")).toBeVisible();
    await expect(page.getByText("SKILL.md frontmatter must include name")).toBeVisible();
    await expect(page.getByText("SKILL.md frontmatter must include description")).toBeVisible();
  });
});
