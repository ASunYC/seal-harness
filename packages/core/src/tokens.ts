import { createServiceToken } from "@piharness/kernel";
import type { ContextService } from "./context.js";
import type { CredentialService } from "./credential.js";
import type { ModelService } from "./model.js";
import type { ApprovalService, PolicyService } from "./policy.js";
import type { AgentRuntime } from "./runtime.js";
import type { SessionStore } from "./session.js";
import type { ToolService } from "./tool.js";

export const modelServiceToken = createServiceToken<ModelService>("piharness.model");
export const runtimeToken = createServiceToken<AgentRuntime>("piharness.runtime");
export const sessionStoreToken = createServiceToken<SessionStore>("piharness.session-store");
export const toolServiceToken = createServiceToken<ToolService>("piharness.tools");
export const policyServiceToken = createServiceToken<PolicyService>("piharness.policy");
export const approvalServiceToken = createServiceToken<ApprovalService>("piharness.approval");
export const contextServiceToken = createServiceToken<ContextService>("piharness.context");
export const credentialServiceToken = createServiceToken<CredentialService>("piharness.credentials");
