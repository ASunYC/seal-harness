export interface TokenUsage { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number }
export function formatCacheHitPercent(cacheReadTokens: number, promptTokens: number, decimalPlaces?: number): string | null;
export function promptTokensForUsage(usage: TokenUsage): number;
export function formatRunDuration(ms: number): string;
export function formatLatencySeconds(ms: number): string;
export function formatTokensPerSecond(value: number): string;
export function formatCompactTokens(value: number, thousand?: string, million?: string): string;
export function formatExactTokenCount(value: number, separator?: string): string;
export function formatCompactDuration(ms: number, secondsTemplate?: string, minutesTemplate?: string): string;
