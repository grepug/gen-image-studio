import { z } from "zod";

export const providerTypeSchema = z.enum(["openai-compatible"]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const providerCapabilitySchema = z.enum(["text", "image-generate", "image-edit", "vision", "tools"]);
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerProfileInputSchema = z.object({
  workspaceId: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  providerType: providerTypeSchema,
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1).max(120),
  defaultImageModel: z.string().min(1).max(120).optional(),
  capabilities: z.array(providerCapabilitySchema).default([]),
  apiKey: z.string().min(1)
});
export type ProviderProfileInput = z.infer<typeof providerProfileInputSchema>;

export const providerProfileViewSchema = providerProfileInputSchema
  .omit({ apiKey: true })
  .extend({
    id: z.string().uuid(),
    hasApiKey: z.boolean(),
    verifiedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  });
export type ProviderProfileView = z.infer<typeof providerProfileViewSchema>;

