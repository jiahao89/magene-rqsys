import { z } from "zod";

export const SourceConfigUpdateSchema = z.object({
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  requirementTypeId: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: z.object({
    enabled: z.boolean(),
    weekday: z.number().int().min(1).max(7).nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    timezone: z.string().trim().min(1).nullable(),
  }),
  ownerNames: z.array(z.string().trim().min(1)).max(500),
  fieldMap: z.record(z.string(), z.string().trim().min(1)),
});

export const IdempotencyKeySchema = z.string().trim().min(8).max(128);

export type SourceConfigUpdate = z.infer<typeof SourceConfigUpdateSchema>;

