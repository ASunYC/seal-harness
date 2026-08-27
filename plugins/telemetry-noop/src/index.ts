import {
  telemetryServiceToken,
  type SealHarnessEvents,
  type TelemetryRecord,
  type TelemetryService,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export class NoopTelemetryService implements TelemetryService {
  record(_record: TelemetryRecord): void {}
  async flush(): Promise<void> {}
}

export const noopTelemetryPlugin = definePlugin<undefined, SealHarnessEvents>({
  name: "telemetry-noop",
  provides: [telemetryServiceToken],
  setup(context) {
    context.provide(telemetryServiceToken, new NoopTelemetryService());
  },
});
