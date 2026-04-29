import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isoNow } from "../common/date";
import { Workspace, WorkspaceMembership } from "./workspace.types";

@Injectable()
export class WorkspacesService {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly memberships = new Map<string, WorkspaceMembership[]>();

  createWorkspace(input: { name: string; ownerId: string }): Workspace {
    const id = randomUUID();
    const workspace: Workspace = {
      id,
      name: input.name,
      slug: this.slugify(input.name),
      createdAt: isoNow()
    };
    this.workspaces.set(id, workspace);
    this.memberships.set(id, [
      {
        id: randomUUID(),
        workspaceId: id,
        userId: input.ownerId,
        role: "owner"
      }
    ]);
    return workspace;
  }

  listForUser(userId: string): Workspace[] {
    const workspaceIds = [...this.memberships.entries()]
      .filter(([, rows]) => rows.some((row) => row.userId === userId))
      .map(([workspaceId]) => workspaceId);
    return workspaceIds.flatMap((workspaceId) => {
      const workspace = this.workspaces.get(workspaceId);
      return workspace ? [workspace] : [];
    });
  }

  listMemberships(workspaceId: string): WorkspaceMembership[] {
    return this.memberships.get(workspaceId) ?? [];
  }

  ensureWorkspaceForUser(userId: string): Workspace {
    const existing = this.listForUser(userId)[0];
    if (existing) {
      return existing;
    }
    return this.createWorkspace({ name: "Personal Workspace", ownerId: userId });
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
}

