import { z } from "zod";

export const skillPermissionSchema = z.enum(["network", "read-workspace-assets", "write-workspace-assets", "use-provider"]);
export type SkillPermission = z.infer<typeof skillPermissionSchema>;

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional()
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export const skillValidationStatusSchema = z.enum(["pending", "valid", "invalid"]);
export type SkillValidationStatus = z.infer<typeof skillValidationStatusSchema>;

export const skillVersionViewSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  version: z.string(),
  metadata: skillFrontmatterSchema,
  permissions: z.array(skillPermissionSchema),
  validationStatus: skillValidationStatusSchema,
  validationErrors: z.array(z.string()),
  createdAt: z.string().datetime()
});
export type SkillVersionView = z.infer<typeof skillVersionViewSchema>;

export const skillViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "archived"]),
  latestVersionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type SkillView = z.infer<typeof skillViewSchema>;

