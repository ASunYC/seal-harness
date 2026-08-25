import type { JsonObject } from "./json.js";

export interface TelemetryRecord {
  readonly name: string;
  readonly timestamp: string;
  readonly attributes?: JsonObject;
}

export interface TelemetryService {
  record(record: TelemetryRecord): void | Promise<void>;
  flush(): Promise<void>;
}
