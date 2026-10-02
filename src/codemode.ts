import * as codingAgent from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

type NestedCall = {
  name: string;
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
};

function singleLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").trim();
}

function firstNonemptyLine(text: string): string | undefined {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function scriptFailure(content: Array<{ type: string; text?: string }>): string | undefined {
  const output = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  const marker = output.lastIndexOf("Script error:");
  if (marker !== -1) return firstNonemptyLine(output.slice(marker + "Script error:".length));
  return output.split(/\r?\n/).find((line) => line.trim() && !/^(Script failed|Wall time |Output:)/.test(line));
}

export function hideCodemodeScript<TParams extends TSchema, TDetails, TState>(
  base: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
  return {
    ...base,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("codemode")), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const calls = (result.details as { calls?: NestedCall[] } | undefined)?.calls ?? [];
      const lines: string[] = [];
      const shown = calls.slice(-8);
      if (calls.length > shown.length) lines.push(theme.fg("muted", `… ${calls.length - shown.length} earlier calls`));
      for (const call of shown) {
        const status = {
          running: ["…", "warning"], ok: ["✓", "success"],
          error: ["✗", "error"], cancelled: ["⊘", "muted"],
        } as const;
        const [icon, color] = status[call.status];
        const args = singleLine(call.args);
        const preview = args.length > 80 ? `${args.slice(0, 77)}...` : args;
        const duration = call.durationMs === undefined ? "" : call.durationMs < 1000
          ? ` ${Math.round(call.durationMs)}ms` : ` ${(call.durationMs / 1000).toFixed(1)}s`;
        lines.push(`${theme.fg(color, icon)} ${theme.fg("toolTitle", call.name)} ${theme.fg("muted", preview)}${theme.fg("dim", duration)}`);
        const reason = call.error ? firstNonemptyLine(call.error) : undefined;
        if (reason) lines.push(theme.fg("error", singleLine(reason)));
      }
      if (context.isError) {
        const reason = scriptFailure(result.content) ?? "codemode failed";
        lines.push(theme.fg("error", singleLine(reason)));
      }
      return {
        render(width) {
          return lines.map((line) => truncateToWidth(line, width, "…"));
        },
        invalidate() {},
      };
    },
  };
}

export function registerCodemode(pi: ExtensionAPI): void {
  const { createCodemodeExtension } = codingAgent as typeof codingAgent & {
    createCodemodeExtension?: () => (api: ExtensionAPI) => void;
  };
  if (!createCodemodeExtension) return;
  createCodemodeExtension()({
    ...pi,
    registerTool(definition) {
      pi.registerTool(hideCodemodeScript(definition));
    },
  });
}
