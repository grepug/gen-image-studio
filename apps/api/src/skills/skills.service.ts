import { BadRequestException, Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { DB } from "../db/db.module";
import { assets, skills, skillVersions } from "../db/schema";
import { AppDb } from "../db/types";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { parseSkillMd } from "./skill-md.parser";
import { Skill, SkillUploadInput, SkillUploadResult, SkillVersion } from "./skill.types";

const maxSkillUploadBytes = 256 * 1024;

@Injectable()
export class SkillsService {
  constructor(
    private readonly workspaces: WorkspacesService,
    @Inject(DB) private readonly db: AppDb
  ) {}

  async list(workspaceId: string, userId: string): Promise<Skill[]> {
    await this.assertWorkspaceMember(workspaceId, userId);
    const rows = await this.db.select().from(skills).where(eq(skills.workspaceId, workspaceId));
    return rows.map((row) => this.toSkill(row));
  }

  async upload(input: SkillUploadInput, userId: string): Promise<SkillUploadResult> {
    await this.assertWorkspaceMember(input.workspaceId, userId);
    const file = this.decodeUpload(input);
    const skillMdContent = file.bytes.toString("utf8");
    const parsed = parseSkillMd(skillMdContent);
    const name = parsed.name || "Invalid Skill";
    const storagePath = `skill-archives/${file.sha256}.md`;
    await this.writeSkillArchive(storagePath, file.bytes);
    const result = await this.db.transaction(async (tx) => {
      const [archiveAsset] = await tx
        .insert(assets)
        .values({
          workspaceId: input.workspaceId,
          ownerId: userId,
          kind: "skill-archive",
          mimeType: "text/markdown",
          byteSize: file.bytes.length,
          sha256: file.sha256,
          storagePath
        })
        .returning();
      if (!archiveAsset) {
        throw new Error("Skill archive asset creation failed");
      }

      const [skill] = await tx
        .insert(skills)
        .values({
          workspaceId: input.workspaceId,
          ownerId: userId,
          name,
          slug: `${this.slugify(name)}-${randomUUID().slice(0, 8)}`,
          status: "active"
        })
        .returning();
      if (!skill) {
        throw new Error("Skill creation failed");
      }

      const metadata = {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.version ? { version: parsed.version } : {})
      };
      const [version] = await tx
        .insert(skillVersions)
        .values({
          skillId: skill.id,
          archiveAssetId: archiveAsset.id,
          version: parsed.version,
          metadata,
          permissions: input.permissions,
          validationStatus: parsed.errors.length === 0 ? "valid" : "invalid",
          validationErrors: parsed.errors
        })
        .returning();
      if (!version) {
        throw new Error("Skill version creation failed");
      }

      const [updatedSkill] = await tx
        .update(skills)
        .set({ latestVersionId: version.id })
        .where(eq(skills.id, skill.id))
        .returning();
      if (!updatedSkill) {
        throw new Error("Skill latest version update failed");
      }

      return {
        skill: updatedSkill,
        version
      };
    });
    return {
      skill: this.toSkill(result.skill),
      version: this.toSkillVersion(result.version)
    };
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    return slug || "skill";
  }

  private decodeUpload(input: SkillUploadInput): { bytes: Buffer; mimeType: string; sha256: string } {
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
      throw new BadRequestException("Skill upload byte size must be a positive integer");
    }
    if (input.byteSize > maxSkillUploadBytes) {
      throw new BadRequestException("Skill upload exceeds the 256KB limit");
    }
    if (input.contentBase64.length > Math.ceil(maxSkillUploadBytes / 3) * 4 + 4) {
      throw new BadRequestException("Skill upload exceeds the 256KB limit");
    }
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length > maxSkillUploadBytes) {
      throw new BadRequestException("Skill upload exceeds the 256KB limit");
    }
    if (bytes.length !== input.byteSize) {
      throw new BadRequestException("Skill upload byte size does not match the file metadata");
    }
    if (!input.fileName.toLowerCase().endsWith(".md")) {
      throw new BadRequestException("Only .md Agent Skill files are supported");
    }
    if (input.mimeType && !["text/markdown", "text/plain", "application/octet-stream"].includes(input.mimeType)) {
      throw new BadRequestException("Skill upload MIME type must be markdown or plain text");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== input.archiveSha256) {
      throw new BadRequestException("Skill upload sha256 does not match the file content");
    }
    return {
      bytes,
      mimeType: "text/markdown",
      sha256
    };
  }

  private async writeSkillArchive(storagePath: string, bytes: Buffer): Promise<void> {
    const assetRoot = process.env.ASSET_STORAGE_DIR ?? ".data/assets";
    const archiveDir = join(assetRoot, "skill-archives");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(join(assetRoot, storagePath), bytes);
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    await this.workspaces.assertMember(workspaceId, userId);
  }

  private toSkill(row: typeof skills.$inferSelect): Skill {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.latestVersionId ? { latestVersionId: row.latestVersionId } : {})
    };
  }

  private toSkillVersion(row: typeof skillVersions.$inferSelect): SkillVersion {
    return {
      id: row.id,
      skillId: row.skillId,
      version: row.version,
      name: row.metadata.name,
      description: row.metadata.description,
      permissions: row.permissions,
      validationStatus: row.validationStatus,
      validationErrors: row.validationErrors,
      createdAt: row.createdAt.toISOString()
    };
  }
}
