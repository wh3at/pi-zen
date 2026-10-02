import { expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { hideCodemodeScript } from "../src/codemode.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;
const context = (expanded: boolean, isError = false) => ({ expanded, isError }) as Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
const base = {
  name: "codemode", parameters: {}, execute: vi.fn(), prepareLoadout: vi.fn(),
  renderCall: vi.fn(), renderResult: vi.fn(), exposure: "model-only", defaultActive: false,
} as unknown as ToolDefinition;

it.each([false, true])("never shows JS or successful output: expanded=%s", (expanded) => {
  const tool = hideCodemodeScript(base);
  const ctx = context(expanded);
  expect(tool.renderCall!({ code: 'text("private script")' }, theme, ctx).render(80).map((line) => line.trimEnd())).toEqual(["codemode"]);
  const result = {
    content: [{ type: "text" as const, text: '{"output":"private output"}' }],
    details: { calls: [{ name: "bash", args: '{"command":"echo hello"}', status: "ok", durationMs: 77 }] },
  };
  expect(tool.renderResult!(result, { expanded, isPartial: false }, theme, ctx).render(80)).toEqual(['✓ bash {"command":"echo hello"} 77ms']);
});

it("retains live status, caught nested failures and script errors without output body", () => {
  const tool = hideCodemodeScript(base);
  const result = {
    content: [{ type: "text" as const, text: 'Script failed\nWall time 0 seconds\nOutput:\nprivate output\nScript error: boom\nstack' }],
    details: { calls: [{ name: "read", args: '{}', status: "error", error: "missing\nfile" }] },
  };
  expect(tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context(true, true)).render(80)).toEqual(["✗ read {}", "missing", "boom"]);
  expect(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context(false)).render(80)).toEqual(["✗ read {}", "missing"]);
  result.details.calls[0]!.status = "running";
  delete (result.details.calls[0] as { error?: string }).error;
  expect(tool.renderResult!(result, { expanded: false, isPartial: true }, theme, context(false)).render(80)).toEqual(["… read {}"]);
});

it("bounds width and lists omitted calls without an expansion hint", () => {
  const tool = hideCodemodeScript(base);
  const result = { content: [], details: { calls: Array.from({ length: 10 }, () => ({ name: "read", args: "あ".repeat(100), status: "ok" })) } };
  const lines = tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context(true)).render(40);
  expect(lines).toHaveLength(9);
  expect(lines[0]).toBe("… 2 earlier calls");
  expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  expect(lines.join("\n")).not.toMatch(/ctrl|expand/i);
});

it("preserves execution, schema and other non-rendering definition fields", () => {
  const tool = hideCodemodeScript(base);
  for (const key of Object.keys(base).filter((key) => !["renderCall", "renderResult"].includes(key))) {
    expect((tool as unknown as Record<string, unknown>)[key]).toBe((base as unknown as Record<string, unknown>)[key]);
  }
});

it.each([
  ['Script error:\n\nError: boom\n    at script.js:1\n\nNo tool calls were made.', 'Error: boom'],
  ['Invalid script options\nMore details', 'Invalid script options'],
  ['Script error:\n\n', 'codemode failed'],
])('shows only the first nonempty error line: %s', (text, expected) => {
  const tool = hideCodemodeScript(base);
  const result = { content: [{ type: 'text' as const, text }], details: {} };
  expect(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context(false, true)).render(80)).toEqual([expected]);
});
