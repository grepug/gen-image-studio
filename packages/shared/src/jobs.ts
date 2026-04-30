import { z } from "zod";

export const jobStatusSchema = z.enum(["draft", "queued", "running", "succeeded", "failed", "canceled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobEventTypeSchema = z.enum(["created", "queued", "started", "progress", "completed", "failed", "canceled"]);
export type JobEventType = z.infer<typeof jobEventTypeSchema>;

export const imageGenerationJobInputSchema = z.object({
  workspaceId: z.string().uuid(),
  providerProfileId: z.string().uuid(),
  skillId: z.string().uuid(),
  prompt: z.string().min(1).max(4000)
});
export type ImageGenerationJobInput = z.infer<typeof imageGenerationJobInputSchema>;
