import {
  telemetryServiceToken,
  type PiHarnessEvents,
  type TelemetryRecord,
  type TelemetryService,
} from "@piharness/core";
import { definePlugin } from "@piharness/kernel";

export class NoopTelemetryService implements TelemetryService {
  record(_record: TelemetryRecord): void {}
  async flush(): Promise<void> {}
}

export const noopTelemetryPlugin = definePlugin<undefined, PiHarnessEvents>({
  name: "telemetry-noop",
  provides: [telemetryServiceToken],
  setup(context) {
    context.provide(telemetryServiceToken, new NoopTelemetryService());
  },
});
