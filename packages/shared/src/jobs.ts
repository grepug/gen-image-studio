import { z } from "zod";

export const jobStatusSchema = z.enum(["draft", "queued", "running", "succeeded", "failed", "canceled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobEventTypeSchema = z.enum(["created", "queued", "started", "progress", "completed", "failed", "canceled"]);
export type JobEventType = z.infer<typeof jobEventTypeSchema>;

