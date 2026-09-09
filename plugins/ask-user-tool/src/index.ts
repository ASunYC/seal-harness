import { text, toolServiceToken, userQuestionServiceToken, type AskUserQuestionItem, type JsonValue, type SealHarnessEvents, type ToolDefinition, type UserQuestionService } from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";
export const askUserToolPlugin = definePlugin<undefined, SealHarnessEvents>({ name: "ask-user-tool", requires: [toolServiceToken, userQuestionServiceToken], setup(context) { context.effect(context.use(toolServiceToken).register(askUserQuestionTool(context.use(userQuestionServiceToken)))); } });
export function askUserQuestionTool(service: UserQuestionService): ToolDefinition {
  return {
    name: "ask_user_question",
    description: "Ask the user one or more concise structured questions when a decision or missing information is required.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["questions"],
      properties: {
        questions: {
          type: "array", minItems: 1,
          items: {
            type: "object", additionalProperties: false, required: ["id", "question"],
            properties: {
              id: { type: "string" }, question: { type: "string" }, detail: { type: "string" },
              header: { type: "string" }, multi_select: { type: "boolean" },
              options: { type: "array", items: { type: "object", additionalProperties: false, required: ["label"], properties: { label: { type: "string" }, description: { type: "string" } } } },
            },
          },
        },
      },
    },
    classify() { return { kind: "tool", toolName: "ask_user_question", risk: "read", summary: "Ask the user a question" }; },
    async execute(input, ctx) {
      const questions = (input.questions as unknown[]).map(parseQuestion);
      const result = await service.ask({ sessionId: ctx.sessionId, questions, signal: ctx.signal });
      const value = JSON.parse(JSON.stringify(result)) as JsonValue;
      return { content: [text(JSON.stringify(value))], details: value };
    },
  };
}
function parseQuestion(raw: unknown): AskUserQuestionItem { if (raw === null || typeof raw !== "object") throw new Error("each question must be an object"); const x = raw as Record<string, unknown>; if (typeof x.id !== "string" || typeof x.question !== "string") throw new Error("each question requires string id and question"); let options; if (x.options !== undefined) { if (!Array.isArray(x.options)) throw new Error("question options must be an array"); options = x.options.map((item) => { if (item === null || typeof item !== "object" || typeof (item as any).label !== "string") throw new Error("each option requires a label"); return { label: (item as any).label as string, ...(typeof (item as any).description === "string" ? { description: (item as any).description as string } : {}) }; }); } return { id: x.id, question: x.question, ...(typeof x.detail === "string" ? { detail: x.detail } : {}), ...(typeof x.header === "string" ? { header: x.header } : {}), ...(options === undefined ? {} : { options }), ...(typeof x.multi_select === "boolean" ? { multiSelect: x.multi_select } : {}) }; }
