import { z } from 'zod';
export const WorkflowResourceSelectionSchema = z.strictObject({
    kind: z.enum(['skill', 'mcp', 'wiki']),
    sourceId: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    collectionId: z.string().min(1).max(256).optional(),
});
export const WorkflowResourceSchema = WorkflowResourceSelectionSchema.extend({
    name: z.string(),
    unavailableReason: z.string().optional(),
});
export const WorkflowResourceListSchema = z.object({
    resources: z.array(WorkflowResourceSchema),
    warnings: z.array(z.string()),
});
