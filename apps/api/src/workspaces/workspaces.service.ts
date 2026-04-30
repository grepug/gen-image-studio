import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DB } from "../db/db.module";
import { workspaceMemberships, workspaces, users } from "../db/schema";
import { AppDb } from "../db/types";
import { Workspace, WorkspaceMember, WorkspaceMembership } from "./workspace.types";

const membershipManagerRoles = new Set<WorkspaceMembership["role"]>(["owner", "admin"]);
const jobWriterRoles = new Set<WorkspaceMembership["role"]>(["owner", "admin", "member"]);
const providerWriterRoles = new Set<WorkspaceMembership["role"]>(["owner", "admin"]);
const skillWriterRoles = new Set<WorkspaceMembership["role"]>(["owner", "admin", "member"]);

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DB) private readonly db: AppDb) {}

  async createWorkspace(input: { name: string; ownerId: string }): Promise<Workspace> {
    await this.ensureUser(input.ownerId);
    const slug = `${this.slugify(input.name)}-${input.ownerId.slice(-6)}-${randomUUID().slice(0, 8)}`;
    const [workspace] = await this.db
      .insert(workspaces)
      .values({ name: input.name, slug })
      .returning();
    if (!workspace) {
      throw new Error("Workspace creation failed");
    }
    await this.ensureMembership(workspace.id, input.ownerId, "owner");
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

  async listMemberships(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.db
      .select({ membership: workspaceMemberships, user: users })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
    return rows.map((row) => this.toWorkspaceMember(row.membership, row.user));
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

  async assertCanWriteJobs(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.findMembership(workspaceId, userId);
    if (!membership || !jobWriterRoles.has(membership.role)) {
      throw new ForbiddenException("User cannot run workspace jobs");
    }
  }

  async assertCanWriteProviders(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.findMembership(workspaceId, userId);
    if (!membership || !providerWriterRoles.has(membership.role)) {
      throw new ForbiddenException("User cannot manage workspace providers");
    }
  }

  async assertCanWriteSkills(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.findMembership(workspaceId, userId);
    if (!membership || !skillWriterRoles.has(membership.role)) {
      throw new ForbiddenException("User cannot upload workspace skills");
    }
  }

  async addMember(input: { workspaceId: string; email: string; role: WorkspaceMembership["role"] }, actorId: string): Promise<WorkspaceMember> {
    await this.assertCanManageMembers(input.workspaceId, actorId);
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.trim().toLowerCase()))
      .limit(1);
    if (!user) {
      throw new NotFoundException("User with that email does not exist");
    }
    const existing = await this.findMembership(input.workspaceId, user.id);
    if (existing) {
      return this.toWorkspaceMember(existing, user);
    }
    const [membership] = await this.db
      .insert(workspaceMemberships)
      .values({ workspaceId: input.workspaceId, userId: user.id, role: input.role })
      .returning();
    if (!membership) {
      throw new Error("Workspace member add failed");
    }
    return this.toWorkspaceMember(membership, user);
  }

  async updateMemberRole(input: { membershipId: string; role: WorkspaceMembership["role"] }, actorId: string): Promise<WorkspaceMember> {
    const membership = await this.getMembership(input.membershipId);
    await this.assertCanManageMembers(membership.workspaceId, actorId);
    if (membership.role === "owner" && input.role !== "owner") {
      await this.assertNotLastOwner(membership.workspaceId, membership.id);
    }
    const [updated] = await this.db
      .update(workspaceMemberships)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(workspaceMemberships.id, membership.id))
      .returning();
    if (!updated) {
      throw new Error("Workspace member role update failed");
    }
    const user = await this.getUser(updated.userId);
    return this.toWorkspaceMember(updated, user);
  }

  async removeMember(membershipId: string, actorId: string): Promise<boolean> {
    const membership = await this.getMembership(membershipId);
    await this.assertCanManageMembers(membership.workspaceId, actorId);
    if (membership.role === "owner") {
      await this.assertNotLastOwner(membership.workspaceId, membership.id);
    }
    await this.db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, membership.id));
    return true;
  }

  async ensureWorkspaceForUser(userId: string): Promise<Workspace> {
    await this.ensureUser(userId);
    const existing = (await this.listForUser(userId))[0];
    if (existing) {
      return existing;
    }

    const slug = `personal-${userId}`;
    const [inserted] = await this.db
      .insert(workspaces)
      .values({ name: "Personal Workspace", slug })
      .onConflictDoNothing()
      .returning();
    const workspace = inserted ?? (await this.findBySlug(slug));
    if (!workspace) {
      throw new Error("Personal workspace creation failed");
    }
    await this.ensureMembership(workspace.id, userId, "owner");
    return this.toWorkspace(workspace);
  }

  private async findBySlug(slug: string): Promise<typeof workspaces.$inferSelect | undefined> {
    const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    return workspace;
  }

  private async ensureMembership(workspaceId: string, userId: string, role: "owner"): Promise<void> {
    await this.db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId, role })
      .onConflictDoNothing();
  }

  private async assertCanManageMembers(workspaceId: string, userId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
      .limit(1);
    const membership = rows[0];
    if (!membership || !membershipManagerRoles.has(membership.role)) {
      throw new ForbiddenException("User cannot manage workspace members");
    }
  }

  private async assertNotLastOwner(workspaceId: string, membershipId: string): Promise<void> {
    const owners = await this.db
      .select({ id: workspaceMemberships.id })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.role, "owner")));
    if (owners.length === 1 && owners[0]?.id === membershipId) {
      throw new BadRequestException("Workspace must keep at least one owner");
    }
  }

  private async getMembership(membershipId: string): Promise<typeof workspaceMemberships.$inferSelect> {
    const [membership] = await this.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.id, membershipId))
      .limit(1);
    if (!membership) {
      throw new NotFoundException("Workspace membership not found");
    }
    return membership;
  }

  private async findMembership(
    workspaceId: string,
    userId: string
  ): Promise<typeof workspaceMemberships.$inferSelect | undefined> {
    const [membership] = await this.db
      .select()
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
      .limit(1);
    return membership;
  }

  private async getUser(userId: string): Promise<typeof users.$inferSelect> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
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

  private toWorkspaceMember(
    membership: typeof workspaceMemberships.$inferSelect,
    user: typeof users.$inferSelect
  ): WorkspaceMember {
    return {
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
      role: membership.role
    };
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    return slug || "workspace";
  }
}
