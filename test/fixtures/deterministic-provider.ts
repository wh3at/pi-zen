import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function message(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function streamFixture(model: Model<any>, context: Context, _options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const output = message(model);
    stream.push({ type: "start", partial: output });
    const hasToolResult = context.messages.some((entry) => entry.role === "toolResult");
    if (!hasToolResult) {
      const toolCall = {
        type: "toolCall" as const,
        id: "fixture-call",
        name: "bash",
        arguments: { command: "sleep 2; echo SElEREVOX1RPT0xfQk9EWQ== | base64 -d" },
      };
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: output });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
      output.stopReason = "toolUse";
    } else {
      const block = { type: "text" as const, text: "FIXTURE_DONE" };
      output.content.push(block);
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: block.text, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: output });
      output.stopReason = "stop";
    }
    stream.push({ type: "done", reason: output.stopReason, message: output });
    stream.end();
  });
  return stream;
}

export default function deterministicProvider(pi: ExtensionAPI): void {
  pi.registerProvider("pi-zen-fixture", {
    name: "pi-zen deterministic fixture",
    baseUrl: "http://127.0.0.1",
    apiKey: "fixture",
    api: "openai-completions",
    models: [{
      id: "fixture",
      name: "fixture",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_384,
      maxTokens: 1_024,
    }],
    streamSimple: streamFixture,
  });
}
