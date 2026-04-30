import { Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB } from "../db/db.module";
import { assets, skills, skillVersions } from "../db/schema";
import { AppDb } from "../db/types";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { parseSkillMd } from "./skill-md.parser";
import { Skill, SkillUploadInput, SkillUploadResult, SkillVersion } from "./skill.types";

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
    const parsed = parseSkillMd(input.skillMdContent);
    const name = parsed.name || "Invalid Skill";
    const result = await this.db.transaction(async (tx) => {
      const [archiveAsset] = await tx
        .insert(assets)
        .values({
          workspaceId: input.workspaceId,
          ownerId: userId,
          kind: "skill-archive",
          mimeType: "text/markdown",
          byteSize: Buffer.byteLength(input.skillMdContent),
          sha256: input.archiveSha256,
          storagePath: `skill-archives/${input.archiveSha256}`
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
          slug: `${this.slugify(name)}-${Date.now().toString(36)}`,
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
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
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
