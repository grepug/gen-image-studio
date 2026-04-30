import { ForbiddenException, Injectable } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DB } from "../db/db.module";
import { workspaceMemberships, workspaces, users } from "../db/schema";
import { AppDb } from "../db/types";
import { Workspace, WorkspaceMembership } from "./workspace.types";

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DB) private readonly db: AppDb) {}

  async createWorkspace(input: { name: string; ownerId: string }): Promise<Workspace> {
    await this.ensureUser(input.ownerId);
    const slug = `${this.slugify(input.name)}-${input.ownerId.slice(-6)}`;
    const [workspace] = await this.db
      .insert(workspaces)
      .values({ name: input.name, slug })
      .returning();
    if (!workspace) {
      throw new Error("Workspace creation failed");
    }
    await this.db.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId: input.ownerId,
      role: "owner"
    });
    return this.toWorkspace(workspace);
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    const rows = await this.db
      .select({ workspace: workspaces })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .where(eq(workspaceMemberships.userId, userId));
    return rows.map((row) => this.toWorkspace(row.workspace));
  }

  async listMemberships(workspaceId: string): Promise<WorkspaceMembership[]> {
    const rows = await this.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role
    }));
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: workspaceMemberships.id })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  async assertMember(workspaceId: string, userId: string): Promise<void> {
    if (!(await this.isMember(workspaceId, userId))) {
      throw new ForbiddenException("User is not a member of this workspace");
    }
  }

  async ensureWorkspaceForUser(userId: string): Promise<Workspace> {
    await this.ensureUser(userId);
    const existing = (await this.listForUser(userId))[0];
    if (existing) {
      return existing;
    }
    return this.createWorkspace({ name: "Personal Workspace", ownerId: userId });
  }

  private async ensureUser(userId: string): Promise<void> {
    await this.db
      .insert(users)
      .values({ id: userId, displayName: "Workspace Member" })
      .onConflictDoNothing();
  }

  private toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString()
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
}
