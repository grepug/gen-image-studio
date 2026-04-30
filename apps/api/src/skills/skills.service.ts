import { BadRequestException, Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { DB } from "../db/db.module";
import { assets, skills, skillVersions } from "../db/schema";
import { AppDb } from "../db/types";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { parseSkillMd } from "./skill-md.parser";
import { Skill, SkillUploadInput, SkillUploadResult, SkillVersion } from "./skill.types";

const maxSkillUploadBytes = 256 * 1024;
const maxSkillPackageUploadBytes = 512 * 1024;
const maxExtractedSkillMdBytes = 256 * 1024;
const maxSkillPackageEntries = 100;
const maxSkillPackageUncompressedBytes = 2 * 1024 * 1024;

interface ZipEntryMetadata {
  name: string;
  compressionMethod: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

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
    await this.assertWorkspaceMember(input.workspaceId, userId);
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
    const entries = this.readZipEntries(bytes);
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
    this.assertAllowedSkillMdLocation(skillMdEntry.name);
    const skillMdBytes = this.readZipEntryBytes(bytes, skillMdEntry);
    if (skillMdBytes.length <= 0) {
      throw new BadRequestException("Skill package SKILL.md must not be empty");
    }
    if (skillMdBytes.length > maxExtractedSkillMdBytes) {
      throw new BadRequestException("Skill package SKILL.md exceeds the 256KB limit");
    }
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

  private readZipEntries(bytes: Buffer): ZipEntryMetadata[] {
    const eocdOffset = this.findEndOfCentralDirectory(bytes);
    const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
    const centralDirDisk = bytes.readUInt16LE(eocdOffset + 6);
    const entryCount = bytes.readUInt16LE(eocdOffset + 10);
    const centralDirSize = bytes.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = bytes.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || centralDirDisk !== 0) {
      throw new BadRequestException("Skill package must be a single-disk zip archive");
    }
    if (entryCount === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
      throw new BadRequestException("Skill package zip64 archives are not supported");
    }
    if (entryCount <= 0 || entryCount > maxSkillPackageEntries) {
      throw new BadRequestException(`Skill package must contain between 1 and ${maxSkillPackageEntries} entries`);
    }
    if (centralDirOffset + centralDirSize > bytes.length) {
      throw new BadRequestException("Skill package central directory is invalid");
    }

    const entries: ZipEntryMetadata[] = [];
    let offset = centralDirOffset;
    let totalUncompressedBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
        throw new BadRequestException("Skill package central directory is invalid");
      }
      const flags = bytes.readUInt16LE(offset + 8);
      const compressionMethod = bytes.readUInt16LE(offset + 10);
      const compressedSize = bytes.readUInt32LE(offset + 20);
      const uncompressedSize = bytes.readUInt32LE(offset + 24);
      const fileNameLength = bytes.readUInt16LE(offset + 28);
      const extraLength = bytes.readUInt16LE(offset + 30);
      const commentLength = bytes.readUInt16LE(offset + 32);
      const localHeaderOffset = bytes.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      const nextOffset = nameStart + fileNameLength + extraLength + commentLength;
      if (nextOffset > bytes.length) {
        throw new BadRequestException("Skill package central directory is invalid");
      }
      if ((flags & 0x1) !== 0) {
        throw new BadRequestException("Skill package encrypted entries are not supported");
      }
      if (![0, 8].includes(compressionMethod)) {
        throw new BadRequestException("Skill package entry compression method is not supported");
      }
      const name = this.normalizeZipPath(bytes.subarray(nameStart, nameStart + fileNameLength).toString("utf8"));
      if (!name) {
        throw new BadRequestException("Skill package entries must have safe relative paths");
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > maxSkillPackageUncompressedBytes) {
        throw new BadRequestException("Skill package uncompressed content exceeds the 2MB limit");
      }
      if (localHeaderOffset + 30 > bytes.length || localHeaderOffset + compressedSize > bytes.length) {
        throw new BadRequestException("Skill package local file header is invalid");
      }
      entries.push({ name, compressionMethod, flags, compressedSize, uncompressedSize, localHeaderOffset });
      offset = nextOffset;
    }
    return entries;
  }

  private findEndOfCentralDirectory(bytes: Buffer): number {
    const minOffset = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
      if (bytes.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }
    throw new BadRequestException("Skill package must be a valid zip archive");
  }

  private readZipEntryBytes(bytes: Buffer, entry: ZipEntryMetadata): Buffer {
    const offset = entry.localHeaderOffset;
    if (bytes.readUInt32LE(offset) !== 0x04034b50) {
      throw new BadRequestException("Skill package local file header is invalid");
    }
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) {
      throw new BadRequestException("Skill package local file data is invalid");
    }
    const compressedBytes = bytes.subarray(dataStart, dataEnd);
    const output = entry.compressionMethod === 0 ? Buffer.from(compressedBytes) : inflateRawSync(compressedBytes);
    if (output.length !== entry.uncompressedSize) {
      throw new BadRequestException("Skill package entry size metadata does not match content");
    }
    return output;
  }

  private normalizeZipPath(name: string): string {
    const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
      return "";
    }
    return parts.join("/");
  }

  private assertAllowedSkillMdLocation(path: string): void {
    const parts = path.split("/");
    if (parts.length > 2) {
      throw new BadRequestException("Skill package SKILL.md must be at the root or inside one top-level folder");
    }
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
