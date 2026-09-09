import {
  contextServiceToken,
  sessionId,
  sessionStoreToken,
  text,
  toolServiceToken,
  type JsonObject,
  type JsonValue,
  type SealHarnessEvents,
  type SessionId,
  type SessionSnapshot,
  type StoredSessionEvent,
  type ToolDefinition,
  type ToolExecutionContext,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface SessionQueryToolsConfig { readonly maxSearchResults?: number; readonly maxNeighborEvents?: number }
type Surface = "current" | "shadowed" | "log-only";
interface IndexedEvent { readonly stored: StoredSessionEvent; readonly surface: Surface; readonly searchText: string }

export const sessionQueryToolsPlugin = definePlugin<SessionQueryToolsConfig, SealHarnessEvents>({
  name: "session-query-tools",
  requires: [sessionStoreToken, toolServiceToken, contextServiceToken],
  setup(context, config) {
    const maxResults = positive(config.maxSearchResults ?? 100, "maxSearchResults");
    const maxNeighbors = positive(config.maxNeighborEvents ?? 20, "maxNeighborEvents");
    const sessions = context.use(sessionStoreToken);
    for (const tool of createSessionQueryTools(sessions, { maxSearchResults: maxResults, maxNeighborEvents: maxNeighbors })) context.effect(context.use(toolServiceToken).register(tool));
    context.effect(context.use(contextServiceToken).register({
      name: "session-query-guidance",
      async contribute() { return { systemPrompt: "Use session_search to find relevant work from prior Sessions, or session_event_search for one Session. Results are workspace-scoped. Follow hits with session_trace, session_event_trace, or session_event_read for exact history." }; },
    }));
  },
});

export function createSessionQueryTools(store: import("@seal-harness/core").SessionStore, config: SessionQueryToolsConfig = {}): ToolDefinition[] {
  const maxResults = positive(config.maxSearchResults ?? 100, "maxSearchResults");
  const maxNeighbors = positive(config.maxNeighborEvents ?? 20, "maxNeighborEvents");
  return [
    {
      name: "session_search",
      description: "Search prior Sessions in the caller workspace and return the strongest matching event from each Session.",
      inputSchema: objectSchema({
        query: stringSchema(), session_ids: stringArray(), created_at_from: stringSchema(), created_at_to: stringSchema(),
        parent_session_ids: stringArray(), include_root_sessions: { type: "boolean" },
        availability: { type: "array", items: { type: "string", enum: ["live", "persisted"] }, minItems: 1 },
        event_seq_from: integer(), event_seq_to: integer(), event_time_from: stringSchema(), event_time_to: stringSchema(),
        event_types: stringArray(), event_surfaces: surfaceArray(),
      }, ["query"]),
      classify: (_input, ctx) => action("session_search", "Search prior Session history", ctx.cwd),
      async execute(input, ctx) {
        const query = queryText(input.query); const all = await workspaceSessions(store, ctx.cwd);
        const ids = strings(input.session_ids); const parents = strings(input.parent_session_ids);
        const created = range(input.created_at_from, input.created_at_to, "created_at");
        const eventFilter = filters(input, "event_");
        const availability = strings(input.availability);
        const hits = all.filter(session => session.id !== ctx.sessionId)
          .filter(() => availability === undefined || availability.includes("persisted"))
          .filter(session => ids === undefined || ids.includes(session.id))
          .filter(session => inTime(createdAt(session), created))
          .filter(session => parentMatches(parentOf(session), parents, input.include_root_sessions === true))
          .flatMap(session => {
            const matches = indexed(session).filter(event => eventMatches(event, query, eventFilter));
            if (matches.length === 0) return [];
            return [{ session: header(session), bestMatch: eventSummary(matches[0]!) }];
          });
        return result({ items: hits.slice(0, maxResults), truncated: hits.length > maxResults });
      },
    },
    {
      name: "session_event_search",
      description: "Search prior events in one workspace-authorized Session; the current Session excludes this tool call's new events.",
      inputSchema: objectSchema({ session_id: stringSchema(), query: stringSchema(), seq_from: integer(), seq_to: integer(), time_from: stringSchema(), time_to: stringSchema(), event_types: stringArray(), surfaces: surfaceArray() }, ["query"]),
      classify: (_input, ctx) => action("session_event_search", "Search Session events", ctx.cwd),
      async execute(input, ctx) {
        const session = await authorized(store, optionalString(input.session_id) ?? ctx.sessionId, ctx.cwd);
        const matches = indexed(session).filter(event => eventMatches(event, queryText(input.query), filters(input, "")));
        return result({ session: header(session), items: matches.slice(0, maxResults).map(eventSummary), truncated: matches.length > maxResults });
      },
    },
    {
      name: "session_trace", description: "Read Session lineage around one workspace-authorized Session, including ancestors and descendants.",
      inputSchema: targetSchema(), classify: (_input, ctx) => action("session_trace", "Read Session lineage", ctx.cwd),
      async execute(input, ctx) {
        const target = await authorized(store, optionalString(input.session_id) ?? ctx.sessionId, ctx.cwd);
        const all = await workspaceSessions(store, ctx.cwd); const byId = new Map(all.map(value => [value.id, value]));
        const ancestors: JsonValue[] = []; let cursor = parentOf(target); const seen = new Set<SessionId>();
        while (cursor !== undefined && !seen.has(cursor)) { seen.add(cursor); const value = byId.get(cursor); if (value === undefined) break; ancestors.push(header(value)); cursor = parentOf(value); }
        const descendants = all.filter(value => isDescendant(value, target.id, byId)).map(header);
        return result({ session: header(target), ancestors, descendants });
      },
    },
    {
      name: "session_event_trace", description: "Read direct replacement and identifier relationships for one event in a workspace-authorized Session.",
      inputSchema: objectSchema({ session_id: stringSchema(), seq: integer() }, ["seq"]), classify: (_input, ctx) => action("session_event_trace", "Trace Session event", ctx.cwd),
      async execute(input, ctx) {
        const session = await authorized(store, optionalString(input.session_id) ?? ctx.sessionId, ctx.cwd); const seq = requiredInteger(input.seq, "seq");
        const target = eventAt(session, seq); const targetIds = identifiers(target.stored.event.payload);
        const related = indexed(session).filter(value => value.stored.sequence !== seq && intersects(targetIds, identifiers(value.stored.event.payload))).map(eventSummary);
        const replacements = target.surface === "shadowed" ? indexed(session).filter(value => value.stored.event.type === "context.compacted" && value.stored.sequence > seq).slice(0, 1).map(eventSummary) : [];
        return result({ event: fullEvent(target), related, replacements });
      },
    },
    {
      name: "session_event_read", description: "Read one full unabridged event and optional neighboring event summaries from a workspace-authorized Session.",
      inputSchema: objectSchema({ session_id: stringSchema(), seq: integer(), before: integer(), after: integer() }, ["seq"]), classify: (_input, ctx) => action("session_event_read", "Read Session event", ctx.cwd),
      async execute(input, ctx) {
        const session = await authorized(store, optionalString(input.session_id) ?? ctx.sessionId, ctx.cwd); const seq = requiredInteger(input.seq, "seq");
        const before = bounded(input.before, "before", maxNeighbors); const after = bounded(input.after, "after", maxNeighbors); const events = indexed(session); const target = eventAt(session, seq);
        return result({ event: fullEvent(target), before: events.filter(value => value.stored.sequence < seq).slice(-before).map(eventSummary), after: events.filter(value => value.stored.sequence > seq).slice(0, after).map(eventSummary) });
      },
    },
  ];
}

async function workspaceSessions(store: import("@seal-harness/core").SessionStore, cwd: string): Promise<readonly SessionSnapshot[]> { return (await store.list()).filter(value => sessionCwd(value) === cwd).sort((a, b) => createdAt(b) - createdAt(a) || String(a.id).localeCompare(String(b.id))); }
async function authorized(store: import("@seal-harness/core").SessionStore, rawId: string, cwd: string): Promise<SessionSnapshot> { const value = await store.read(sessionId(rawId)); if (value === undefined || sessionCwd(value) !== cwd) throw new Error(`Session not found in caller workspace: ${rawId}`); return value; }
function sessionCwd(value: SessionSnapshot): string | undefined { const event = value.events.find(item => item.event.type === "session.created"); return event?.event.type === "session.created" ? event.event.payload.cwd : undefined; }
function createdAt(value: SessionSnapshot): number { const stamp = value.events[0]?.timestamp; return stamp === undefined ? 0 : Date.parse(stamp); }
function parentOf(value: SessionSnapshot): SessionId | undefined { const event = value.events.find(item => item.event.type === "session.forked"); if (event?.event.type === "session.forked") return event.event.payload.sourceSessionId; const created = value.events.find(item => item.event.type === "session.created"); if (created?.event.type !== "session.created") return undefined; const raw = created.event.payload.metadata?.["sealHarness.parentSessionId"]; return typeof raw === "string" ? sessionId(raw) : undefined; }
function header(value: SessionSnapshot): JsonObject { const parent = parentOf(value); return { id: value.id, version: value.version, createdAt: value.events[0]?.timestamp ?? "", cwd: sessionCwd(value) ?? "", ...(parent === undefined ? {} : { parentSessionId: parent }) }; }
function isDescendant(value: SessionSnapshot, target: SessionId, all: ReadonlyMap<SessionId, SessionSnapshot>): boolean { const seen = new Set<SessionId>(); let cursor = parentOf(value); while (cursor !== undefined && !seen.has(cursor)) { if (cursor === target) return true; seen.add(cursor); cursor = all.get(cursor) === undefined ? undefined : parentOf(all.get(cursor)!); } return false; }

function indexed(session: SessionSnapshot): IndexedEvent[] { const currentMessages = new Set<number>(); let messages: number[] = []; for (const item of session.events) { if (item.event.type === "message.appended") messages.push(item.sequence); else if (item.event.type === "context.compacted") messages = messages.slice(-item.event.payload.retainedMessageCount); } for (const seq of messages) currentMessages.add(seq); return session.events.map(stored => ({ stored, surface: stored.event.type === "message.appended" ? (currentMessages.has(stored.sequence) ? "current" : "shadowed") : stored.event.type === "context.compacted" ? "current" : "log-only", searchText: semanticText(stored) })); }
function semanticText(value: StoredSessionEvent): string { return `${value.event.type} ${JSON.stringify(value.event.payload)}`.replace(/\s+/gu, " "); }
function eventSummary(value: IndexedEvent): JsonObject { return { seq: value.stored.sequence, time: value.stored.timestamp, type: value.stored.event.type, surface: value.surface, snippet: value.searchText.slice(0, 320) }; }
function fullEvent(value: IndexedEvent): JsonObject { return { seq: value.stored.sequence, time: value.stored.timestamp, surface: value.surface, event: value.stored.event as unknown as JsonObject }; }
function eventAt(session: SessionSnapshot, seq: number): IndexedEvent { const value = indexed(session).find(item => item.stored.sequence === seq); if (value === undefined) throw new Error(`Session event not found: ${session.id}@${seq}`); return value; }
function identifiers(value: object): Set<string> { const ids = new Set<string>(); for (const [key, raw] of Object.entries(value)) if ((key.endsWith("Id") || key === "callId") && typeof raw === "string") ids.add(`${key}:${raw}`); return ids; }
function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean { for (const value of left) if (right.has(value)) return true; return false; }

interface EventFilters { seq?: { from?: number; to?: number }; time?: { from?: number; to?: number }; types?: string[]; surfaces?: string[] }
function filters(input: JsonObject, prefix: string): EventFilters { const seq = numberRange(input[`${prefix}seq_from`], input[`${prefix}seq_to`], `${prefix}seq`); const time = range(input[`${prefix}time_from`], input[`${prefix}time_to`], `${prefix}time`); return { ...(seq === undefined ? {} : { seq }), ...(time === undefined ? {} : { time }), ...(strings(input[`${prefix}types`]) === undefined ? {} : { types: strings(input[`${prefix}types`])! }), ...(strings(input[prefix === "event_" ? "event_surfaces" : "surfaces"]) === undefined ? {} : { surfaces: strings(input[prefix === "event_" ? "event_surfaces" : "surfaces"])! }) }; }
function eventMatches(value: IndexedEvent, query: string, filter: EventFilters): boolean { const normalized = value.searchText.toLocaleLowerCase().replace(/\s+/gu, " "); return normalized.includes(query) && inNumber(value.stored.sequence, filter.seq) && inTime(Date.parse(value.stored.timestamp), filter.time) && (filter.types === undefined || filter.types.includes(value.stored.event.type)) && (filter.surfaces === undefined || filter.surfaces.includes(value.surface)); }
function parentMatches(parent: SessionId | undefined, selected: string[] | undefined, includeRoots: boolean): boolean { if (selected === undefined) return true; return parent === undefined ? includeRoots : selected.includes(parent); }
function inNumber(value: number, limits?: { from?: number; to?: number }): boolean { return limits === undefined || (limits.from === undefined || value >= limits.from) && (limits.to === undefined || value <= limits.to); }
function inTime(value: number, limits?: { from?: number; to?: number }): boolean { return inNumber(value, limits); }
function range(from: JsonValue | undefined, to: JsonValue | undefined, name: string): { from?: number; to?: number } | undefined { if (from === undefined && to === undefined) return undefined; const lower = from === undefined ? undefined : timestamp(from, `${name}_from`); const upper = to === undefined ? undefined : timestamp(to, `${name}_to`); if (lower !== undefined && upper !== undefined && lower > upper) throw new Error(`${name}_from must be <= ${name}_to`); return { ...(lower === undefined ? {} : { from: lower }), ...(upper === undefined ? {} : { to: upper }) }; }
function numberRange(from: JsonValue | undefined, to: JsonValue | undefined, name: string): { from?: number; to?: number } | undefined { if (from === undefined && to === undefined) return undefined; const lower = from === undefined ? undefined : requiredInteger(from, `${name}_from`); const upper = to === undefined ? undefined : requiredInteger(to, `${name}_to`); if (lower !== undefined && upper !== undefined && lower > upper) throw new Error(`${name}_from must be <= ${name}_to`); return { ...(lower === undefined ? {} : { from: lower }), ...(upper === undefined ? {} : { to: upper }) }; }
function timestamp(value: JsonValue, name: string): number { if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must be a timezone-qualified ISO 8601 timestamp`); return Date.parse(value); }
function queryText(value: JsonValue | undefined): string { if (typeof value !== "string") throw new Error("query must be a string"); const query = value.trim().replace(/\s+/gu, " ").toLocaleLowerCase(); if (!query || query.includes("\0")) throw new Error("query must contain non-whitespace text and no NUL"); return query; }
function optionalString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function strings(value: JsonValue | undefined): string[] | undefined { if (value === undefined) return undefined; if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string")) throw new Error("filter arrays must be non-empty string arrays"); return [...new Set(value as string[])]; }
function requiredInteger(value: JsonValue | undefined, name: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`); return value; }
function bounded(value: JsonValue | undefined, name: string, maximum: number): number { if (value === undefined) return 0; const result = requiredInteger(value, name); if (result > maximum) throw new Error(`${name} must be <= ${maximum}`); return result; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`); return value; }
function result(value: JsonObject) { return { content: [text(JSON.stringify(value))], details: value }; }
function action(toolName: string, summary: string, target: string) { return { kind: "tool" as const, toolName, risk: "read" as const, summary, target }; }
function objectSchema(properties: JsonObject, required: readonly string[] = []): JsonObject { return { type: "object", properties, required, additionalProperties: false }; }
function targetSchema(): JsonObject { return objectSchema({ session_id: stringSchema() }); }
function stringSchema(): JsonObject { return { type: "string", minLength: 1 }; }
function integer(): JsonObject { return { type: "integer", minimum: 0 }; }
function stringArray(): JsonObject { return { type: "array", items: stringSchema(), minItems: 1 }; }
function surfaceArray(): JsonObject { return { type: "array", items: { type: "string", enum: ["current", "shadowed", "log-only"] }, minItems: 1 }; }
