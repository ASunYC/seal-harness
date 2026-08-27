import {
  credentialServiceToken,
  type CredentialRequest,
  type CredentialService,
  type SealHarnessEvents,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export interface EnvironmentCredentialConfig {
  /** Keys use `provider.name`, for example `deepseek.apiKey`. */
  readonly variables?: Readonly<Record<string, string>>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export class EnvironmentCredentialService implements CredentialService {
  constructor(readonly config: EnvironmentCredentialConfig = {}) {}

  async resolve(request: CredentialRequest): Promise<string | undefined> {
    request.signal?.throwIfAborted();
    const key = `${request.provider}.${request.name}`;
    const variable = this.config.variables?.[key] ?? defaultVariable(request);
    const value = this.config.environment?.[variable] ?? process.env[variable];
    return value === undefined || value.length === 0 ? undefined : value;
  }
}

export const environmentCredentialPlugin = definePlugin<EnvironmentCredentialConfig, SealHarnessEvents>({
  name: "credentials-env",
  provides: [credentialServiceToken],
  setup(context, config) {
    context.provide(credentialServiceToken, new EnvironmentCredentialService(config));
  },
});

function defaultVariable(request: CredentialRequest): string {
  const provider = request.provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const name = request.name.replaceAll(/([a-z])([A-Z])/g, "$1_$2").replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return `${provider}_${name}`;
}
