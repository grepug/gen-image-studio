import { expect, Page, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  await expect(page.locator(".topbar .eyebrow")).toHaveText(account.displayName);
  await expect(page.getByRole("heading", { name: "Personal Workspace" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Gen Image Studio" })).toBeVisible();
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
    await expect(page.locator(".topbar .eyebrow")).toHaveText(accounts[0].displayName);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Gen Image Studio" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("does not leak cached workspace data when switching users", async ({ page }) => {
    await resetBrowserState(page);
    await login(page, accounts[0]);
    await expect(page.locator(".topbar .eyebrow")).toHaveText(accounts[0].displayName);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Email").fill(accounts[1].email);
    await page.getByLabel("Password").fill(accounts[1].password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.locator(".topbar .eyebrow")).toHaveText(accounts[1].displayName);
    const workspaceIds = await page.evaluate(async () => {
      const response = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "{ workspacesForCurrentUser { id } }"
        })
      });
      const json = await response.json();
      return json.data.workspacesForCurrentUser.map((workspace: { id: string }) => workspace.id);
    });
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length);
  });

  test("registers a passkey and signs back in with it", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await resetBrowserState(page);
    await login(page);

    await page.getByRole("button", { name: "Register Passkey" }).click();
    await expect(page.getByText("Passkey registered")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.locator(".topbar .eyebrow")).toHaveText(accounts[0].displayName);
    await expect(page.getByRole("heading", { name: "Personal Workspace" })).toBeVisible();
  });

  test("lets an owner add, update, and remove a workspace collaborator", async ({ page }) => {
    await resetBrowserState(page);
    await login(page, accounts[1]);
    await signOut(page);
    await login(page, accounts[0]);

    await page.getByLabel("Member email").fill(accounts[1].email);
    await page.getByLabel("New member role").selectOption("member");
    await page.getByRole("button", { name: "Add Member" }).click();
    await expect(page.getByText(accounts[1].displayName)).toBeVisible();
    await expect(page.getByLabel(`Role for ${accounts[1].displayName}`)).toHaveValue("member");
    const ownerWorkspaceId = await currentWorkspaceId(page);

    await signOut(page);
    await login(page, accounts[1]);
    await page.getByLabel("Active workspace").selectOption(ownerWorkspaceId);
    await expect(page.getByRole("heading", { name: "Personal Workspace" })).toBeVisible();
    await expect(page.locator(".member-item").filter({ hasText: accounts[0].displayName })).toBeVisible();

    await page.getByLabel("Member email").fill(accounts[2].email);
    await page.getByRole("button", { name: "Add Member" }).click();
    await expect(page.getByText("User cannot manage workspace members")).toBeVisible();

    await signOut(page);
    await login(page, accounts[0]);
    await page.getByLabel(`Role for ${accounts[1].displayName}`).selectOption("viewer");
    await expect(page.getByLabel(`Role for ${accounts[1].displayName}`)).toHaveValue("viewer");
    await page.locator(".member-item").filter({ hasText: accounts[1].displayName }).getByRole("button", { name: "Remove" }).click();
    await expect(page.locator(".member-item").filter({ hasText: accounts[1].displayName })).toHaveCount(0);

    await signOut(page);
    await login(page, accounts[1]);
    await expect(page.locator(".member-item").filter({ hasText: accounts[0].displayName })).toHaveCount(0);
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

  test("indexes a valid Agent Skill from an uploaded SKILL.md file", async ({ page }) => {
    await login(page);
    const filePath = await writeSkillFile("valid-skill.md", `---
name: e2e-image-skill
description: Generates images for the Playwright flow.
version: 2.0.0
---

# E2E Image Skill
`);
    await page.getByLabel("SKILL.md file").setInputFiles(filePath);
    await page.getByRole("button", { name: "Upload Skill" }).click();

    await expect(page.getByText("Indexed e2e-image-skill")).toBeVisible();
    await expect(page.locator(".skill-item").filter({ hasText: "e2e-image-skill" })).toBeVisible();
    await expectStoredSkillArchive(filePath);
  });

  test("shows validation errors for an invalid Agent Skill file", async ({ page }) => {
    await login(page);
    const filePath = await writeSkillFile("invalid-skill.md", "# No frontmatter here");

    await page.getByLabel("SKILL.md file").setInputFiles(filePath);
    await page.getByRole("button", { name: "Upload Skill" }).click();

    await expect(page.getByText("SKILL.md must start with YAML frontmatter")).toBeVisible();
    await expect(page.getByText("SKILL.md frontmatter must include name")).toBeVisible();
    await expect(page.getByText("SKILL.md frontmatter must include description")).toBeVisible();
  });

  test("rejects skill uploads with invalid archive metadata", async ({ page }) => {
    await login(page);
    const workspaceId = await currentWorkspaceId(page);
    const filePath = await writeSkillFile("tampered-skill.md", `---
name: tampered-skill
description: Hash mismatch check.
---

# Tampered Skill
`);
    const bytes = await readFile(filePath);
    const contentBase64 = bytes.toString("base64");

    const mismatch = await uploadSkillViaGraphql(page, {
      workspaceId,
      archiveSha256: "0".repeat(64),
      fileName: "tampered-skill.md",
      mimeType: "text/markdown",
      byteSize: bytes.length,
      contentBase64
    });
    expect(mismatch.errors?.[0]?.message).toContain("sha256");

    const oversizedBytes = Buffer.from("small body with oversized metadata");
    const oversized = await uploadSkillViaGraphql(page, {
      workspaceId,
      archiveSha256: createHash("sha256").update(oversizedBytes).digest("hex"),
      fileName: "oversized-skill.md",
      mimeType: "text/markdown",
      byteSize: 256 * 1024 + 1,
      contentBase64: oversizedBytes.toString("base64")
    });
    expect(oversized.errors?.[0]?.message).toContain("256KB");
  });
});

async function currentWorkspaceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("http://localhost:4000/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "{ workspacesForCurrentUser { id } }"
      })
    });
    const json = await response.json();
    return json.data.workspacesForCurrentUser[0].id as string;
  });
}

async function writeSkillFile(name: string, content: string): Promise<string> {
  const dir = join(process.cwd(), "test-results", "skill-fixtures");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

async function expectStoredSkillArchive(filePath: string): Promise<void> {
  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storedBytes = await readFile(join(process.cwd(), "apps/api/.data/assets/skill-archives", `${sha256}.md`));
  expect(storedBytes.equals(bytes)).toBe(true);
}

async function uploadSkillViaGraphql(
  page: Page,
  input: {
    workspaceId: string;
    archiveSha256: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    contentBase64: string;
  }
): Promise<{ errors?: { message: string }[] }> {
  return page.evaluate(async (uploadInput) => {
    const response = await fetch("http://localhost:4000/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `mutation UploadSkill($input: SkillUploadInput!) {
          uploadSkill(input: $input) {
            skill { id }
          }
        }`,
        variables: {
          input: {
            ...uploadInput,
            permissions: []
          }
        }
      })
    });
    return response.json();
  }, input);
}
