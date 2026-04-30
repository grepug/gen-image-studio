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
import {
  assertAllowedSkillMdLocation,
  readSkillSupportFiles,
  readZipEntries,
  readZipEntryBytes,
  skillPackageArchiveLimits,
  skillSupportFileLimits
} from "./skill-package";
import { Skill, SkillUploadInput, SkillUploadResult, SkillVersion } from "./skill.types";

const maxSkillUploadBytes = 256 * 1024;
const maxSkillPackageUploadBytes = 512 * 1024;
const maxExtractedSkillMdBytes = 256 * 1024;

interface DecodedSkillUpload {
  archiveBytes: Buffer;
  archiveMimeType: string;
  archiveSha256: string;
  archiveStoragePath: string;
  directorySkillMd?: {
    bytes: Buffer;
    sha256: string;
    storagePath: string;
  };
  skillMdContent: string;
}

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
    await this.assertCanWriteSkills(input.workspaceId, userId);
    const file = this.decodeUpload(input);
    const parsed = parseSkillMd(file.skillMdContent);
    const name = parsed.name || "Invalid Skill";
    await this.writeAssetFile(file.archiveStoragePath, file.archiveBytes);
    if (file.directorySkillMd) {
      await this.writeAssetFile(file.directorySkillMd.storagePath, file.directorySkillMd.bytes);
    }
    const result = await this.db.transaction(async (tx) => {
      const [archiveAsset] = await tx
        .insert(assets)
        .values({
          workspaceId: input.workspaceId,
          ownerId: userId,
          kind: "skill-archive",
          mimeType: file.archiveMimeType,
          byteSize: file.archiveBytes.length,
          sha256: file.archiveSha256,
          storagePath: file.archiveStoragePath
        })
        .returning();
      if (!archiveAsset) {
        throw new Error("Skill archive asset creation failed");
      }
      let directoryAssetId: string | undefined;
      if (file.directorySkillMd) {
        const [directoryAsset] = await tx
          .insert(assets)
          .values({
            workspaceId: input.workspaceId,
            ownerId: userId,
            kind: "skill-directory",
            mimeType: "text/markdown",
            byteSize: file.directorySkillMd.bytes.length,
            sha256: file.directorySkillMd.sha256,
            storagePath: file.directorySkillMd.storagePath
          })
          .returning();
        if (!directoryAsset) {
          throw new Error("Skill directory asset creation failed");
        }
        directoryAssetId = directoryAsset.id;
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
          ...(directoryAssetId ? { directoryAssetId } : {}),
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

  private decodeUpload(input: SkillUploadInput): DecodedSkillUpload {
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
      throw new BadRequestException("Skill upload byte size must be a positive integer");
    }
    const normalizedFileName = input.fileName.trim().toLowerCase();
    const isZip = normalizedFileName.endsWith(".zip");
    const maxBytes = isZip ? maxSkillPackageUploadBytes : maxSkillUploadBytes;
    const maxLabel = isZip ? "512KB" : "256KB";
    if (input.byteSize > maxBytes) {
      throw new BadRequestException(`Skill upload exceeds the ${maxLabel} limit`);
    }
    if (input.contentBase64.length > Math.ceil(maxBytes / 3) * 4 + 4) {
      throw new BadRequestException(`Skill upload exceeds the ${maxLabel} limit`);
    }
    if (!this.isCanonicalBase64(input.contentBase64)) {
      throw new BadRequestException("Skill upload content must be canonical base64");
    }
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length > maxBytes) {
      throw new BadRequestException(`Skill upload exceeds the ${maxLabel} limit`);
    }
    if (bytes.length !== input.byteSize) {
      throw new BadRequestException("Skill upload byte size does not match the file metadata");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== input.archiveSha256) {
      throw new BadRequestException("Skill upload sha256 does not match the file content");
    }
    if (isZip) {
      return this.decodeZipUpload(input, bytes, sha256);
    }
    return this.decodeMarkdownUpload(input, bytes, sha256);
  }

  private decodeMarkdownUpload(input: SkillUploadInput, bytes: Buffer, sha256: string): DecodedSkillUpload {
    if (!input.fileName.toLowerCase().endsWith(".md")) {
      throw new BadRequestException("Only .md and .zip Agent Skill uploads are supported");
    }
    if (input.mimeType && !["text/markdown", "text/plain", "application/octet-stream"].includes(input.mimeType)) {
      throw new BadRequestException("Skill upload MIME type must be markdown or plain text");
    }
    return {
      archiveBytes: bytes,
      archiveMimeType: "text/markdown",
      archiveSha256: sha256,
      archiveStoragePath: `skill-archives/${sha256}.md`,
      skillMdContent: bytes.toString("utf8")
    };
  }

  private decodeZipUpload(input: SkillUploadInput, bytes: Buffer, sha256: string): DecodedSkillUpload {
    if (input.mimeType && !["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(input.mimeType)) {
      throw new BadRequestException("Skill package MIME type must be zip or octet-stream");
    }
    const entries = readZipEntries(bytes, skillPackageArchiveLimits);
    const skillMdEntries = entries.filter((entry) => entry.name.endsWith("/SKILL.md") || entry.name === "SKILL.md");
    if (skillMdEntries.length === 0) {
      throw new BadRequestException("Skill package must contain SKILL.md");
    }
    if (skillMdEntries.length > 1) {
      throw new BadRequestException("Skill package must contain exactly one SKILL.md");
    }
    const skillMdEntry = skillMdEntries[0];
    if (!skillMdEntry) {
      throw new BadRequestException("Skill package must contain SKILL.md");
    }
    assertAllowedSkillMdLocation(skillMdEntry.name);
    const skillMdBytes = readZipEntryBytes(bytes, skillMdEntry, maxExtractedSkillMdBytes + 1);
    if (skillMdBytes.length <= 0) {
      throw new BadRequestException("Skill package SKILL.md must not be empty");
    }
    if (skillMdBytes.length > maxExtractedSkillMdBytes) {
      throw new BadRequestException("Skill package SKILL.md exceeds the 256KB limit");
    }
    readSkillSupportFiles(bytes, skillSupportFileLimits);
    const skillMdSha256 = createHash("sha256").update(skillMdBytes).digest("hex");
    return {
      archiveBytes: bytes,
      archiveMimeType: "application/zip",
      archiveSha256: sha256,
      archiveStoragePath: `skill-archives/${sha256}.zip`,
      directorySkillMd: {
        bytes: skillMdBytes,
        sha256: skillMdSha256,
        storagePath: `skill-directories/${sha256}/SKILL.md`
      },
      skillMdContent: skillMdBytes.toString("utf8")
    };
  }

  private isCanonicalBase64(value: string): boolean {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      return false;
    }
    return Buffer.from(value, "base64").toString("base64") === value;
  }

  private async writeAssetFile(storagePath: string, bytes: Buffer): Promise<void> {
    const assetRoot = process.env.ASSET_STORAGE_DIR ?? ".data/assets";
    const assetDir = join(assetRoot, storagePath.split("/").slice(0, -1).join("/"));
    await mkdir(assetDir, { recursive: true });
    await writeFile(join(assetRoot, storagePath), bytes);
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    await this.workspaces.assertMember(workspaceId, userId);
  }

  private async assertCanWriteSkills(workspaceId: string, userId: string): Promise<void> {
    await this.workspaces.assertCanWriteSkills(workspaceId, userId);
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
