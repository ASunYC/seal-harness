import { z } from 'zod';

// DSH 0.1.7-alpha.2 SessionId 是 branded string，不要求旧 local-session 的 UUID。
export const LocalSessionIdSchema = z.string().min(1);
