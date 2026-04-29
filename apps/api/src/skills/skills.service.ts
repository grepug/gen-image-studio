import { ForbiddenException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isoNow } from "../common/date";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { parseSkillMd } from "./skill-md.parser";
import { Skill, SkillUploadInput, SkillUploadResult, SkillVersion } from "./skill.types";

@Injectable()
export class SkillsService {
  private readonly skills = new Map<string, Skill>();
  private readonly versions = new Map<string, SkillVersion[]>();

  constructor(private readonly workspaces: WorkspacesService) {}

  list(workspaceId: string, userId: string): Skill[] {
    this.assertWorkspaceMember(workspaceId, userId);
    return [...this.skills.values()].filter((skill) => skill.workspaceId === workspaceId);
  }

  upload(input: SkillUploadInput, userId: string): SkillUploadResult {
    this.assertWorkspaceMember(input.workspaceId, userId);
    const parsed = parseSkillMd(input.skillMdContent);
    const now = isoNow();
    const skill: Skill = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: parsed.name || "Invalid Skill",
      slug: this.slugify(parsed.name || `invalid-${Date.now()}`),
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    const version: SkillVersion = {
      id: randomUUID(),
      skillId: skill.id,
      version: parsed.version,
      name: parsed.name,
      description: parsed.description,
      permissions: input.permissions,
      validationStatus: parsed.errors.length === 0 ? "valid" : "invalid",
      validationErrors: parsed.errors,
      createdAt: now
    };
    skill.latestVersionId = version.id;
    this.skills.set(skill.id, skill);
    this.versions.set(skill.id, [version]);
    void input.archiveSha256;
    return { skill, version };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  private assertWorkspaceMember(workspaceId: string, userId: string): void {
    if (!this.workspaces.isMember(workspaceId, userId)) {
      throw new ForbiddenException("User is not a member of this workspace");
    }
  }
}
