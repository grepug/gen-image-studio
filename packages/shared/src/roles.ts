import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspacePermissionSchema = z.enum([
  "workspace:read",
  "workspace:manage",
  "members:manage",
  "providers:read",
  "providers:write",
  "skills:read",
  "skills:write",
  "jobs:read",
  "jobs:write"
]);
export type WorkspacePermission = z.infer<typeof workspacePermissionSchema>;

const rolePermissions: Record<WorkspaceRole, WorkspacePermission[]> = {
  owner: [
    "workspace:read",
    "workspace:manage",
    "members:manage",
    "providers:read",
    "providers:write",
    "skills:read",
    "skills:write",
    "jobs:read",
    "jobs:write"
  ],
  admin: [
    "workspace:read",
    "members:manage",
    "providers:read",
    "providers:write",
    "skills:read",
    "skills:write",
    "jobs:read",
    "jobs:write"
  ],
  member: ["workspace:read", "providers:read", "skills:read", "skills:write", "jobs:read", "jobs:write"],
  viewer: ["workspace:read", "providers:read", "skills:read", "jobs:read"]
};

export function permissionsForRole(role: WorkspaceRole): WorkspacePermission[] {
  return rolePermissions[role];
}

