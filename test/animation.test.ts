import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import piZen from "../src/index.js";

const names = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const theme = { fg: (color: string, text: string) => `\x1b[${color === "dim" ? 90 : 37}m${text}\x1b[39m` } as never;
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

function setup() {
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Function>();
  piZen({
    on: (name: string, handler: Function) => handlers.set(name, handler),
    getActiveTools: () => names,
    getAllTools: () => names.map((name) => ({ name, sourceInfo: { source: "builtin" } })),
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    setActiveTools() {},
  } as unknown as ExtensionAPI);
  handlers.get("session_start")!({}, { cwd: process.cwd() });
  return { tools, handlers };
}

function context(): Parameters<NonNullable<ToolDefinition["renderCall"]>>[2] {
  return {
    args: { command: "sleep 3", path: "source.txt", pattern: "*.txt" },
    state: {}, lastComponent: undefined, invalidate: vi.fn(), toolCallId: "call", cwd: process.cwd(),
    executionStarted: true, argsComplete: true, isPartial: true,
    expanded: false, showImages: false, isError: false,
  };
}

let agentDir: string;
beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-zen-animation-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

it.each(names)("%sの明るい点が300msごとに0〜3個に増え、再描画でも周期と幅を保つ", (name) => {
  const { tools } = setup();
  const tool = tools.get(name)!;
  const ctx = context();
  const frames: string[] = [];
  for (let frame = 0; frame < 5; frame++) {
    const line = tool.renderCall!(ctx.args, theme, ctx);
    ctx.lastComponent = line;
    const rendered = line.render(40)[0]!;
    frames.push(rendered);
    const marker = [0, 1, 2].map((index) => (theme as any).fg(index < frame % 4 ? "text" : "dim", ".")).join("");
    expect(rendered.startsWith(marker)).toBe(true);
    expect(plain(rendered)).toBe(plain(frames[0]!));
    expect(visibleWidth(rendered)).toBeLessThanOrEqual(40);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300);
  }
  expect(frames[0]).toBe(frames[4]);
  expect(ctx.invalidate).toHaveBeenCalledTimes(5);
});

it.each([false, true])("完了・失敗・中断で点を止め、結果の再描画や復元ではタイマーを作らない: error=%s", (isError) => {
  const { tools } = setup();
  const tool = tools.get("edit")!;
  const ctx = context();
  tool.renderCall!(ctx.args, theme, ctx);
  vi.advanceTimersByTime(350);
  ctx.isPartial = false;
  ctx.isError = isError;
  expect(tool.renderCall!(ctx.args, theme, ctx).render(40)).toEqual([]);
  const result = tool.renderResult!({ content: [], details: {} }, { expanded: false, isPartial: false }, theme, ctx);
  expect(plain(result.render(40)[0]!)).toBe(`${isError ? "✗" : "✓"} edit source.txt`);
  vi.advanceTimersByTime(2000);
  expect(ctx.invalidate).toHaveBeenCalledTimes(1);
  tool.renderCall!(ctx.args, theme, { ...ctx, state: {}, lastComponent: undefined });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["agent_end", "session_shutdown"])("%sで並行実行中の全タイマーを解除する", (event) => {
  const { tools, handlers } = setup();
  const contexts = [context(), context()];
  for (const ctx of contexts) tools.get("edit")!.renderCall!(ctx.args, theme, ctx);
  expect(vi.getTimerCount()).toBe(2);
  handlers.get(event)!();
  handlers.get(event)!();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(2000);
  for (const ctx of contexts) expect(ctx.invalidate).not.toHaveBeenCalled();
});

it("引数ストリーミング中はタイマーを作らず、実行開始で動かす", () => {
  const { tools } = setup();
  const tool = tools.get("edit")!;
  const ctx = context();
  ctx.executionStarted = false;
  tool.renderCall!(ctx.args, theme, ctx);
  expect(vi.getTimerCount()).toBe(0);
  ctx.executionStarted = true;
  tool.renderCall!(ctx.args, theme, ctx);
  expect(vi.getTimerCount()).toBe(1);
});
