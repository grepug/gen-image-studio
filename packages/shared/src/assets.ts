import { z } from "zod";

export const assetKindSchema = z.enum(["skill-archive", "skill-directory", "reference-image", "output-image"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: assetKindSchema,
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string(),
  createdAt: z.string().datetime()
});
export type AssetView = z.infer<typeof assetViewSchema>;

