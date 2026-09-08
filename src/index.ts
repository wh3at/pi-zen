import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
type Args = Record<string, unknown>;

class SummaryLine implements Component {
  constructor(
    private readonly status: string,
    private readonly name: string,
    private readonly target: string,
    private readonly suffix: string,
    private readonly color: (text: string) => string,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [""];
    const prefix = `${this.status} ${this.name} `;
    const suffix = this.suffix ? ` ${this.suffix}` : "";
    const available = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
    const target = this.name === "bash"
      ? truncateToWidth(this.target, available, "…")
      : middleTruncate(this.target, available);
    return [truncateToWidth(this.color(`${prefix}${target}${suffix}`), width, "")];
  }

  invalidate(): void {}
}

function middleTruncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;
  if (width === 1) return "…";
  const leftWidth = Math.ceil((width - 1) / 2);
  const rightWidth = width - 1 - leftWidth;
  const left = truncateToWidth(value, leftWidth, "");
  let right = "";
  for (const character of [...value].reverse()) {
    if (visibleWidth(character + right) > rightWidth) break;
    right = character + right;
  }
  return `${left}…${right}`;
}

function targetFor(name: string, args: Args): string {
  const text = (key: string, fallback = "") => typeof args[key] === "string" ? args[key] as string : fallback;
  switch (name) {
    case "bash": return text("command");
    case "grep": return `${text("pattern")} · ${text("path", ".")}`;
    case "find": return `${text("pattern")} · ${text("path", ".")}`;
    case "ls": return text("path", ".");
    default: return text("path");
  }
}

function diffCount(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("diff" in details) || typeof details.diff !== "string") return undefined;
  let added = 0;
  let removed = 0;
  for (const line of details.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return `+${added} -${removed}`;
}

function firstReason(content: Array<{ type: string; text?: string }>): string | undefined {
  const text = content.find((part) => part.type === "text" && part.text)?.text;
  return text?.split(/\r?\n/, 1)[0] || undefined;
}

function decorate(base: ToolDefinition, getTool: (cwd: string) => ToolDefinition): ToolDefinition {
  return {
    ...base,
    renderShell: "self",
    async execute(id, params, signal, onUpdate, context) {
      return getTool(context.cwd).execute(id, params, signal, onUpdate, context);
    },
    renderCall(args, theme, context) {
      if (!context.isPartial && context.executionStarted) return new Container();
      return new SummaryLine("…", base.name, targetFor(base.name, args as Args), "", (text) => theme.fg("warning", text));
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Container();
      const suffix = !context.isError && base.name === "edit" ? diffCount(result.details) ?? "" : "";
      const summary = new SummaryLine(
        context.isError ? "✗" : "✓",
        base.name,
        targetFor(base.name, context.args as Args),
        suffix,
        (text) => theme.fg(context.isError ? "error" : "success", text),
      );
      const reason = context.isError ? firstReason(result.content) : undefined;
      if (!reason) return summary;
      return {
        render(width) {
          return [...summary.render(width), truncateToWidth(theme.fg("error", reason), width, "…")];
        },
        invalidate() {},
      };
    },
  };
}

export default function piZen(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    const initiallyActive = pi.getActiveTools();
    const configured = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
    const factories = {
      read: createReadTool,
      write: createWriteTool,
      edit: createEditTool,
      bash: createBashTool,
      grep: createGrepTool,
      find: createFindTool,
      ls: createLsTool,
    } as const;

    for (const [name, factory] of Object.entries(factories)) {
      const current = configured.get(name);
      // Never replace a same-name tool already owned by another extension or SDK caller.
      if (!current || current.sourceInfo.source !== "builtin") continue;
      const standard = factory(context.cwd) as ToolDefinition;
      pi.registerTool(decorate(standard, (cwd) => factory(cwd) as ToolDefinition));
    }
    // Force Pi to resolve the newly registered definitions, then restore the exact enabled set.
    pi.setActiveTools(initiallyActive.filter((name) => !factories[name as keyof typeof factories]));
    pi.setActiveTools(initiallyActive);
  });
}
