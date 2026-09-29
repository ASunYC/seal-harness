import { z } from 'zod';
export const TerminalPlatformCreateSchema = z.strictObject({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(80),
});
export const TerminalPlatformRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('platform-create'), input: TerminalPlatformCreateSchema }),
    z.strictObject({ action: z.literal('platform-catalog') }),
    z.strictObject({ action: z.literal('platform-snapshot') }),
    z.strictObject({ action: z.literal('platform-dismiss-failure') }),
    z.strictObject({
        action: z.enum(['platform-start', 'platform-stop', 'platform-restart', 'platform-delete']),
        id: z.uuid(),
    }),
]);
