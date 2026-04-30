import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ImageGenerationTransportError, ResponsesImageClient } from "../ai/responses-image.client";
import { DB } from "../db/db.module";
import { assets, jobEvents, jobs, outputs, skills, skillVersions } from "../db/schema";
import { AppDb } from "../db/types";
import { ProviderProfilesService } from "../provider-profiles/provider-profiles.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { GenerationJob, JobEvent, JobOutput, RunImageGenerationJobInput } from "./job.types";

const imageGenerationTimeoutMs = 600_000;
const imageGenerationJobInputSchema = z.object({
  workspaceId: z.string().uuid(),
  providerProfileId: z.string().uuid(),
  skillId: z.string().uuid(),
  prompt: z.string().min(1).max(4000)
});

@Injectable()
export class JobsService {
  constructor(
    private readonly imageClient: ResponsesImageClient,
    private readonly providerProfiles: ProviderProfilesService,
    private readonly workspaces: WorkspacesService,
    @Inject(DB) private readonly db: AppDb
  ) {}

  async list(workspaceId: string, userId: string): Promise<GenerationJob[]> {
    await this.workspaces.assertMember(workspaceId, userId);
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.workspaceId, workspaceId))
      .orderBy(desc(jobs.createdAt));
    return Promise.all(rows.map((row) => this.toJobView(row)));
  }

  async runImageGeneration(input: RunImageGenerationJobInput, userId: string): Promise<GenerationJob> {
    const parsed = imageGenerationJobInputSchema.parse({
      workspaceId: input.workspaceId,
      providerProfileId: input.providerProfileId,
      skillId: input.skillId,
      prompt: input.prompt.trim()
    });
    await this.workspaces.assertCanWriteJobs(parsed.workspaceId, userId);
    const provider = await this.providerProfiles.getStored(parsed.providerProfileId);
    if (!provider) {
      throw new NotFoundException("Provider profile not found");
    }
    if (provider.workspaceId !== parsed.workspaceId) {
      throw new ForbiddenException("Provider profile is not in this workspace");
    }
    this.assertProviderCanGenerateImages(provider.capabilities);
    const skill = await this.getLatestValidSkillArchive(parsed.workspaceId, parsed.skillId);
    this.assertSkillCanGenerateImages(skill.version.permissions);
    const skillMd = await readFile(this.assetPath(skill.asset.storagePath), "utf8");
    const fullPrompt = this.buildGenerationPrompt(skillMd, parsed.prompt);

    const [job] = await this.db
      .insert(jobs)
      .values({
        workspaceId: parsed.workspaceId,
        requesterId: userId,
        skillVersionId: skill.version.id,
        providerProfileId: provider.id,
        status: "running",
        input: {
          prompt: parsed.prompt,
          skillId: parsed.skillId,
          providerProfileId: parsed.providerProfileId,
          imageAction: "generate"
        }
      })
      .returning();
    if (!job) {
      throw new Error("Job creation failed");
    }

    await this.appendEvent(job.id, "created", "Generation job created");
    await this.appendEvent(job.id, "started", "Generation request started");

    try {
      const apiKey = await this.providerProfiles.getApiKey(provider.id);
      const result = await this.imageClient.generateImage({
        baseUrl: provider.baseUrl,
        apiKey,
        model: provider.defaultModel,
        toolModel: provider.defaultImageModel ?? provider.defaultModel,
        imageAction: "generate",
        prompt: fullPrompt,
        timeoutMs: imageGenerationTimeoutMs
      });
      const outputAsset = await this.writeOutputAsset(parsed.workspaceId, userId, result.imageBytes);
      await this.db.insert(outputs).values({
        jobId: job.id,
        assetId: outputAsset.id,
        label: "generated-image",
        metadata: { seenEvents: result.seenEvents }
      });
      await this.appendEvent(job.id, "completed", "Generation completed", { seenEvents: result.seenEvents });
      await this.updateStatus(job.id, "succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.appendEvent(job.id, "failed", message, {
        retryable: error instanceof ImageGenerationTransportError ? error.retryable : false
      });
      await this.updateStatus(job.id, "failed");
    }

    return this.getJobView(job.id);
  }

  private async getLatestValidSkillArchive(workspaceId: string, skillId: string) {
    const [row] = await this.db
      .select({ skill: skills, version: skillVersions, asset: assets })
      .from(skills)
      .innerJoin(skillVersions, eq(skillVersions.id, skills.latestVersionId))
      .innerJoin(assets, eq(assets.id, skillVersions.archiveAssetId))
      .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Skill not found");
    }
    if (row.version.validationStatus !== "valid") {
      throw new BadRequestException("Skill must have a valid latest version before generation");
    }
    return row;
  }

  private assertProviderCanGenerateImages(capabilities: string[]) {
    if (!capabilities.includes("image-generate") || !capabilities.includes("tools")) {
      throw new BadRequestException("Provider profile must include image-generate and tools capabilities");
    }
  }

  private assertSkillCanGenerateImages(permissions: string[]) {
    if (!permissions.includes("use-provider") || !permissions.includes("write-workspace-assets")) {
      throw new BadRequestException("Skill must request use-provider and write-workspace-assets permissions");
    }
  }

  private buildGenerationPrompt(skillMd: string, userPrompt: string): string {
    return [
      "Use the following Agent Skill instructions for this image generation request.",
      "",
      "<skill_md>",
      skillMd,
      "</skill_md>",
      "",
      "User image request:",
      userPrompt
    ].join("\n");
  }

  private async writeOutputAsset(workspaceId: string, ownerId: string, bytes: Buffer) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const mimeType = this.sniffImageMimeType(bytes);
    if (mimeType === "application/octet-stream") {
      throw new ImageGenerationTransportError("Image generation result was not a supported image payload.", false);
    }
    const extension = this.extensionForMimeType(mimeType);
    const storagePath = `output-images/${sha256}.${extension}`;
    const outputDir = join(this.assetRoot(), "output-images");
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(this.assetRoot(), storagePath), bytes);
    const [asset] = await this.db
      .insert(assets)
      .values({
        workspaceId,
        ownerId,
        kind: "output-image",
        mimeType,
        byteSize: bytes.length,
        sha256,
        storagePath
      })
      .returning();
    if (!asset) {
      throw new Error("Output asset creation failed");
    }
    return asset;
  }

  private sniffImageMimeType(bytes: Buffer): string {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return "image/png";
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return "image/jpeg";
    }
    if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
      return "image/gif";
    }
    if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
    return "application/octet-stream";
  }

  private extensionForMimeType(mimeType: string): string {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/png") return "png";
    return "bin";
  }

  private async appendEvent(jobId: string, type: "created" | "started" | "completed" | "failed", message: string, data: Record<string, unknown> = {}) {
    await this.db.insert(jobEvents).values({ jobId, type, message, data });
  }

  private async updateStatus(jobId: string, status: "succeeded" | "failed") {
    await this.db.update(jobs).set({ status, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  }

  private async getJobView(jobId: string): Promise<GenerationJob> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      throw new Error("Job not found after generation");
    }
    return this.toJobView(job);
  }

  private async toJobView(row: typeof jobs.$inferSelect): Promise<GenerationJob> {
    const eventRows = await this.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, row.id))
      .orderBy(jobEvents.createdAt);
    const outputRows = await this.db
      .select({ output: outputs, asset: assets })
      .from(outputs)
      .innerJoin(assets, eq(assets.id, outputs.assetId))
      .where(eq(outputs.jobId, row.id))
      .orderBy(outputs.createdAt);
    const prompt = typeof row.input.prompt === "string" ? row.input.prompt : "";
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status,
      prompt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      events: eventRows.map((event) => this.toJobEvent(event)),
      outputs: outputRows.map((output) => this.toJobOutput(output.output, output.asset)),
      ...(row.skillVersionId ? { skillVersionId: row.skillVersionId } : {}),
      ...(row.providerProfileId ? { providerProfileId: row.providerProfileId } : {})
    };
  }

  private toJobEvent(row: typeof jobEvents.$inferSelect): JobEvent {
    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt.toISOString(),
      ...(row.message ? { message: row.message } : {})
    };
  }

  private toJobOutput(row: typeof outputs.$inferSelect, asset: typeof assets.$inferSelect): JobOutput {
    return {
      id: row.id,
      assetId: asset.id,
      label: row.label,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      storagePath: asset.storagePath,
      createdAt: row.createdAt.toISOString()
    };
  }

  private assetPath(storagePath: string): string {
    return join(this.assetRoot(), storagePath);
  }

  private assetRoot(): string {
    return process.env.ASSET_STORAGE_DIR ?? ".data/assets";
  }
}
