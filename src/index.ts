import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
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
    private readonly statusColor: (text: string) => string,
    private readonly textColor: (text: string) => string,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [""];
    const prefix = `${this.statusColor(this.status)}${this.textColor(` ${this.name} `)}`;
    const suffix = this.suffix ? ` ${this.suffix}` : "";
    const available = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
    const target = this.name === "bash"
      ? truncateToWidth(this.target, available, "…")
      : middleTruncate(this.target, available);
    return [truncateToWidth(`${prefix}${this.textColor(`${target}${suffix}`)}`, width, "")];
  }

  invalidate(): void {}
}

class RunningDots {
  frame = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(invalidate: () => void, private readonly active: Set<RunningDots>) {
    active.add(this);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % 3;
      invalidate();
    }, 350);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.active.delete(this);
  }
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

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

function targetFor(name: string, args: Args): string {
  const text = (key: string, fallback = "") => singleLine(typeof args[key] === "string" ? args[key] as string : fallback);
  switch (name) {
    case "bash": return text("command");
    case "grep":
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

function failureReason(name: string, content: Array<{ type: string; text?: string }>): string | undefined {
  const text = content.find((part) => part.type === "text" && part.text)?.text;
  if (!text) return undefined;
  const lines = text.split(/\r?\n/).map(singleLine).filter(Boolean);
  return name === "bash" ? lines.at(-1) : lines[0];
}

function decorate(base: ToolDefinition, getTool: (cwd: string) => ToolDefinition, active: Set<RunningDots>): ToolDefinition {
  return {
    ...base,
    renderShell: "self",
    async execute(id, params, signal, onUpdate, context) {
      return getTool(context.cwd).execute(id, params, signal, onUpdate, context);
    },
    renderCall(args, theme, context) {
      let dots = context.state.dots as RunningDots | undefined;
      if (!context.isPartial) {
        dots?.stop();
        return new Container();
      }
      if (context.executionStarted && !dots) {
        dots = new RunningDots(context.invalidate, active);
        context.state.dots = dots;
      }
      return new SummaryLine(
        "...", base.name, targetFor(base.name, args as Args), "",
        (text) => [...text].map((dot, index) => theme.fg(index === (dots?.frame ?? 0) ? "text" : "dim", dot)).join(""),
        (text) => theme.fg("text", text),
      );
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Container();
      (context.state.dots as RunningDots | undefined)?.stop();
      const suffix = !context.isError && base.name === "edit" ? diffCount(result.details) ?? "" : "";
      const summary = new SummaryLine(
        context.isError ? "✗" : "✓",
        base.name,
        targetFor(base.name, context.args as Args),
        suffix,
        (text) => theme.fg(context.isError ? "error" : "success", text),
        (text) => theme.fg("text", text),
      );
      const reason = context.isError ? failureReason(base.name, result.content) : undefined;
      if (!reason) return summary;
      return {
        render(width) {
          return [...summary.render(width), truncateToWidth(theme.fg("text", reason), width, "…")];
        },
        invalidate() {},
      };
    },
  };
}

export default function piZen(pi: ExtensionAPI): void {
  const active = new Set<RunningDots>();
  const stopAnimations = () => {
    for (const dots of active) dots.stop();
  };
  pi.on("agent_end", stopAnimations);
  pi.on("session_shutdown", stopAnimations);
  pi.on("session_start", (_event, context) => {
    const initiallyActive = pi.getActiveTools();
    const configured = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
    const factories = {
      read: createReadToolDefinition,
      write: createWriteToolDefinition,
      edit: createEditToolDefinition,
      bash: createBashToolDefinition,
      grep: createGrepToolDefinition,
      find: createFindToolDefinition,
      ls: createLsToolDefinition,
    } as const;

    for (const [name, factory] of Object.entries(factories)) {
      const current = configured.get(name);
      // Never replace a same-name tool already owned by another extension or SDK caller.
      if (!current || current.sourceInfo.source !== "builtin") continue;
      const standard = factory(context.cwd) as ToolDefinition;
      pi.registerTool(decorate(standard, (cwd) => factory(cwd) as ToolDefinition, active));
    }
    // Force Pi to resolve the newly registered definitions, then restore the exact enabled set.
    pi.setActiveTools(initiallyActive.filter((name) => !factories[name as keyof typeof factories]));
    pi.setActiveTools(initiallyActive);
  });
}
