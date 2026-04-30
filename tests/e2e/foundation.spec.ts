import { expect, Page, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
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

  test("keeps generation selections scoped to the active workspace", async ({ page }) => {
    await resetBrowserState(page);
    await login(page);
    const firstProviderId = await createProviderProfile(page, {
      name: "First Workspace Provider",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "first-workspace-model",
      apiKey: "mock-secret-key"
    });
    await uploadSkillFromUi(page, "first-workspace-skill.md", `---
name: first-workspace-skill
description: First workspace skill.
---

# First Workspace Skill
`);
    await page.getByLabel("Generation provider").selectOption({ label: "First Workspace Provider" });
    await page.getByLabel("Generation skill").selectOption({ label: "first-workspace-skill" });

    const workspaceName = "Second Workspace";
    await page.evaluate(async (name) => {
      await fetch("http://localhost:4000/graphql", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "mutation CreateWorkspace($name: String!) { createWorkspace(name: $name) { id } }",
          variables: { name }
        })
      });
    }, workspaceName);
    await page.reload();
    await page.getByLabel("Active workspace").selectOption({ label: workspaceName });
    await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
    await expect(page.getByLabel("Generation provider")).not.toHaveValue(firstProviderId);
    await expect(page.getByLabel("Generation provider")).toHaveValue("");
    await expect(page.getByLabel("Generation skill")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Run Generation" })).toBeDisabled();
  });

  test("does not show the last generated job after switching workspaces", async ({ page }) => {
    const outputBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    );
    const mock = await startResponsesMock({ outputBytes });
    try {
      await resetBrowserState(page);
      await login(page);
      await createProviderProfile(page, {
        name: "Scoped Job Provider",
        baseUrl: mock.baseUrl,
        model: "scoped-job-model",
        apiKey: "mock-secret-key"
      });
      await uploadSkillFromUi(page, "scoped-job-skill.md", `---
name: scoped-job-skill
description: Scoped job skill.
---

# Scoped Job Skill
`);
      await page.getByLabel("Generation provider").selectOption({ label: "Scoped Job Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "scoped-job-skill" });
      await page.getByLabel("Image prompt").fill("Workspace A generated prompt.");
      await page.getByRole("button", { name: "Run Generation" }).click();
      await expect(page.getByText("Job succeeded")).toBeVisible();
      await expect(page.getByLabel("Latest generation job")).toContainText("Workspace A generated prompt.");

      const workspaceName = "No Jobs Workspace";
      await page.evaluate(async (name) => {
        await fetch("http://localhost:4000/graphql", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: "mutation CreateWorkspace($name: String!) { createWorkspace(name: $name) { id } }",
            variables: { name }
          })
        });
      }, workspaceName);
      await page.reload();
      await page.getByLabel("Active workspace").selectOption({ label: workspaceName });

      await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
      await expect(page.getByLabel("Latest generation job")).toHaveCount(0);
    } finally {
      await mock.close();
    }
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

    await expect(page.locator(".table-row").filter({ hasText: "Workspace Image Provider" })).toBeVisible();
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

  test("accepts a valid Agent Skill upload above the default JSON body limit", async ({ page }) => {
    await login(page);
    const workspaceId = await currentWorkspaceId(page);
    const filePath = await writeSkillFile("large-valid-skill.md", `---
name: large-valid-skill
description: Valid upload that exercises GraphQL body parser limits.
---

# Large Valid Skill

${"A".repeat(192 * 1024)}
`);
    const bytes = await readFile(filePath);
    const upload = await uploadSkillViaGraphql(page, {
      workspaceId,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      fileName: "large-valid-skill.md",
      mimeType: "text/markdown",
      byteSize: bytes.length,
      contentBase64: bytes.toString("base64")
    });
    expect(upload.errors).toBeUndefined();
    expect(upload.data?.uploadSkill.skill.id).toBeTruthy();
    await expectStoredSkillArchive(filePath);
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

    const base64Bytes = Buffer.from("valid bytes with invalid base64 wrapper");
    const invalidBase64 = await uploadSkillViaGraphql(page, {
      workspaceId,
      archiveSha256: createHash("sha256").update(base64Bytes).digest("hex"),
      fileName: "invalid-base64-skill.md",
      mimeType: "text/markdown",
      byteSize: base64Bytes.length,
      contentBase64: `${base64Bytes.toString("base64")}!!!!`
    });
    expect(invalidBase64.errors?.[0]?.message).toContain("canonical base64");
  });

  test("runs an uploaded Agent Skill through a gen-gallery compatible responses stream", async ({ page }) => {
    const outputBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    );
    const mock = await startResponsesMock({ outputBytes });
    try {
      await login(page);
      await createProviderProfile(page, {
        name: "Generation Mock Provider",
        baseUrl: mock.baseUrl,
        model: "gpt-mock-responses",
        apiKey: "mock-secret-key"
      });
      const skillPath = await writeSkillFile("mock-generation-skill.md", `---
name: mock-generation-skill
description: Drives the mock generation request.
---

# Mock Generation Skill

Always produce a sharp product image.
`);
      await page.getByLabel("SKILL.md file").setInputFiles(skillPath);
      await page.getByRole("button", { name: "Upload Skill" }).click();
      await expect(page.getByText("Indexed mock-generation-skill")).toBeVisible();

      await page.getByLabel("Generation provider").selectOption({ label: "Generation Mock Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "mock-generation-skill" });
      await page.getByLabel("Image prompt").fill("Create a chrome object on a neutral background.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("Job succeeded")).toBeVisible();
      await expect(page.getByText("generated-image - image/png")).toBeVisible();
      expect(mock.requests).toHaveLength(1);
      expect(mock.requests[0]?.headers.authorization).toBe("Bearer mock-secret-key");
      expect(mock.requests[0]?.body.model).toBe("gpt-mock-responses");
      expect(mock.requests[0]?.body.stream).toBe(true);
      expect(mock.requests[0]?.body.input).toContain("mock-generation-skill");
      expect(mock.requests[0]?.body.input).toContain("Always produce a sharp product image.");
      expect(mock.requests[0]?.body.input).toContain("Create a chrome object on a neutral background.");
      expect(mock.requests[0]?.body.tools).toEqual([
        { type: "image_generation", model: "gpt-mock-responses", action: "generate" }
      ]);
      const sha256 = createHash("sha256").update(outputBytes).digest("hex");
      const storedBytes = await readFile(join(process.cwd(), "apps/api/.data/assets/output-images", `${sha256}.png`));
      expect(storedBytes.equals(outputBytes)).toBe(true);
    } finally {
      await mock.close();
    }
  });

  test("shows a failed generation job when the responses upstream fails", async ({ page }) => {
    const mock = await startResponsesMock({ status: 500, body: "mock upstream failure" });
    try {
      await login(page);
      await createProviderProfile(page, {
        name: "Failing Mock Provider",
        baseUrl: mock.baseUrl,
        model: "gpt-mock-failure",
        apiKey: "mock-secret-key"
      });
      const skillPath = await writeSkillFile("mock-failure-skill.md", `---
name: mock-failure-skill
description: Drives the mock failed generation request.
---

# Mock Failure Skill
`);
      await page.getByLabel("SKILL.md file").setInputFiles(skillPath);
      await page.getByRole("button", { name: "Upload Skill" }).click();
      await expect(page.getByText("Indexed mock-failure-skill")).toBeVisible();

      await page.getByLabel("Generation provider").selectOption({ label: "Failing Mock Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "mock-failure-skill" });
      await page.getByLabel("Image prompt").fill("This request should fail.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("Job failed")).toBeVisible();
      await expect(page.getByText(/Responses request failed with HTTP 500: mock upstream failure/)).toBeVisible();
    } finally {
      await mock.close();
    }
  });

  test("rejects generation when skill permissions do not allow provider and asset writes", async ({ page }) => {
    const outputBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    );
    const mock = await startResponsesMock({ outputBytes });
    try {
      await login(page);
      await createProviderProfile(page, {
        name: "Permission Mock Provider",
        baseUrl: mock.baseUrl,
        model: "gpt-mock-permission",
        apiKey: "mock-secret-key"
      });
      const workspaceId = await currentWorkspaceId(page);
      const skillPath = await writeSkillFile("no-permissions-skill.md", `---
name: no-permissions-skill
description: Valid skill without provider permissions.
---

# No Permissions Skill
`);
      const bytes = await readFile(skillPath);
      const upload = await uploadSkillViaGraphql(page, {
        workspaceId,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
        fileName: "no-permissions-skill.md",
        mimeType: "text/markdown",
        byteSize: bytes.length,
        contentBase64: bytes.toString("base64")
      });
      expect(upload.data?.uploadSkill.skill.id).toBeTruthy();
      await page.reload();
      await expect(page.getByLabel("Generation skill").locator("option", { hasText: "no-permissions-skill" })).toHaveCount(1);

      await page.getByLabel("Generation provider").selectOption({ label: "Permission Mock Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "no-permissions-skill" });
      await page.getByLabel("Image prompt").fill("This request should be blocked before upstream.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("Skill must request use-provider and write-workspace-assets permissions")).toBeVisible();
      expect(mock.requests).toHaveLength(0);
    } finally {
      await mock.close();
    }
  });

  test("rejects generation for workspace viewers before provider key use", async ({ page }) => {
    const mock = await startResponsesMock({
      outputBytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
      )
    });
    try {
      await resetBrowserState(page);
      await login(page, accounts[1]);
      await signOut(page);
      await login(page, accounts[0]);
      await createProviderProfile(page, {
        name: "Viewer Block Provider",
        baseUrl: mock.baseUrl,
        model: "viewer-block-model",
        apiKey: "mock-secret-key"
      });
      await uploadSkillFromUi(page, "viewer-block-skill.md", `---
name: viewer-block-skill
description: Viewer block skill.
---

# Viewer Block Skill
`);
      await page.getByLabel("Member email").fill(accounts[1].email);
      await page.getByLabel("New member role").selectOption("viewer");
      await page.getByRole("button", { name: "Add Member" }).click();
      const ownerWorkspaceId = await currentWorkspaceId(page);

      await signOut(page);
      await login(page, accounts[1]);
      await page.getByLabel("Active workspace").selectOption(ownerWorkspaceId);
      await page.getByLabel("Generation provider").selectOption({ label: "Viewer Block Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "viewer-block-skill" });
      await page.getByLabel("Image prompt").fill("Viewer should not run this.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("User cannot run workspace jobs")).toBeVisible();
      expect(mock.requests).toHaveLength(0);
    } finally {
      await mock.close();
    }
  });

  test("rejects generation before upstream when provider lacks image tool capabilities", async ({ page }) => {
    const mock = await startResponsesMock({ outputBytes: Buffer.from("not reached") });
    try {
      await login(page);
      await createProviderProfile(page, {
        name: "No Capability Provider",
        baseUrl: mock.baseUrl,
        model: "gpt-mock-no-capability",
        apiKey: "mock-secret-key",
        capabilities: []
      });
      const skillPath = await writeSkillFile("capability-skill.md", `---
name: capability-skill
description: Valid skill for capability rejection.
---

# Capability Skill
`);
      await page.getByLabel("SKILL.md file").setInputFiles(skillPath);
      await page.getByRole("button", { name: "Upload Skill" }).click();
      await expect(page.getByText("Indexed capability-skill")).toBeVisible();

      await page.getByLabel("Generation provider").selectOption({ label: "No Capability Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "capability-skill" });
      await page.getByLabel("Image prompt").fill("This request should be blocked by provider capabilities.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("Provider profile must include image-generate and tools capabilities")).toBeVisible();
      expect(mock.requests).toHaveLength(0);
    } finally {
      await mock.close();
    }
  });

  test("marks generation failed when upstream returns a non-image payload", async ({ page }) => {
    const mock = await startResponsesMock({ outputBytes: Buffer.from("plain text is not an image") });
    try {
      await login(page);
      await createProviderProfile(page, {
        name: "Non Image Mock Provider",
        baseUrl: mock.baseUrl,
        model: "gpt-mock-non-image",
        apiKey: "mock-secret-key"
      });
      const skillPath = await writeSkillFile("non-image-skill.md", `---
name: non-image-skill
description: Valid skill for non-image rejection.
---

# Non Image Skill
`);
      await page.getByLabel("SKILL.md file").setInputFiles(skillPath);
      await page.getByRole("button", { name: "Upload Skill" }).click();
      await expect(page.getByText("Indexed non-image-skill")).toBeVisible();

      await page.getByLabel("Generation provider").selectOption({ label: "Non Image Mock Provider" });
      await page.getByLabel("Generation skill").selectOption({ label: "non-image-skill" });
      await page.getByLabel("Image prompt").fill("This request should fail after upstream.");
      await page.getByRole("button", { name: "Run Generation" }).click();

      await expect(page.getByText("Job failed")).toBeVisible();
      await expect(page.getByText("Image generation result was not a supported image payload.")).toBeVisible();
    } finally {
      await mock.close();
    }
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
): Promise<{ data?: { uploadSkill: { skill: { id: string } } }; errors?: { message: string }[] }> {
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

async function createProviderProfile(
  page: Page,
  input: { name: string; baseUrl: string; model: string; apiKey: string; capabilities?: string[] }
): Promise<string> {
  const workspaceId = await activeWorkspaceId(page);
  const providerId = await page.evaluate(async ({ providerInput, workspaceId }) => {
    const response = await fetch("http://localhost:4000/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `mutation CreateProviderProfile($input: ProviderProfileInput!) {
          createProviderProfile(input: $input) { id }
        }`,
        variables: {
          input: {
            workspaceId,
            displayName: providerInput.name,
            providerType: "OPENAI_COMPATIBLE",
            baseUrl: providerInput.baseUrl,
            defaultModel: providerInput.model,
            defaultImageModel: providerInput.model,
            capabilities: providerInput.capabilities ?? ["image-generate", "tools"],
            apiKey: providerInput.apiKey
          }
        }
      })
    });
    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    return json.data.createProviderProfile.id as string;
  }, { providerInput: input, workspaceId });
  await page.reload();
  if ((await page.getByLabel("Active workspace").count()) > 0) {
    await page.getByLabel("Active workspace").selectOption(workspaceId);
  }
  return providerId;
}

async function activeWorkspaceId(page: Page): Promise<string> {
  if ((await page.getByLabel("Active workspace").count()) > 0) {
    return page.getByLabel("Active workspace").inputValue();
  }
  return currentWorkspaceId(page);
}

async function uploadSkillFromUi(page: Page, fileName: string, content: string): Promise<void> {
  const filePath = await writeSkillFile(fileName, content);
  const skillName = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  await page.getByLabel("SKILL.md file").setInputFiles(filePath);
  await page.getByRole("button", { name: "Upload Skill" }).click();
  if (skillName) {
    await expect(page.getByText(`Indexed ${skillName}`)).toBeVisible();
  }
}

async function selectValueForLabel(page: Page, label: string, optionLabel: string): Promise<string> {
  return page.getByLabel(label).evaluate((select, text) => {
    const option = [...(select as HTMLSelectElement).options].find((item) => item.textContent === text);
    return option?.value ?? "";
  }, optionLabel);
}

async function startResponsesMock(options: { outputBytes?: Buffer; status?: number; body?: string }): Promise<{
  baseUrl: string;
  requests: Array<{ headers: Record<string, string | undefined>; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ headers: Record<string, string | undefined>; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
      response.writeHead(404).end("not found");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push({
      headers: {
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        contentType: request.headers["content-type"]
      },
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
    });
    if (options.status && options.status >= 400) {
      response.writeHead(options.status, { "content-type": "text/plain" }).end(options.body ?? "upstream failure");
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: {
          type: "image_generation_call",
          result: (options.outputBytes ?? Buffer.from("mock image")).toString("base64")
        }
      })}\n\n`
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => closeServer(server)
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
