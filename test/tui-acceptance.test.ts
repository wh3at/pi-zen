import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TuiTest } from "@microsoft/tui-test";

const here = dirname(fileURLToPath(import.meta.url));
const pi = resolve("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const piZen = resolve("src/index.ts");
const provider = join(here, "fixtures/deterministic-provider.ts");
const terminals: TuiTest[] = [];

afterEach(async () => {
  await Promise.all(terminals.splice(0).map((terminal) => terminal.closeQuiet()));
});

async function runPi(cols: number) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-zen-tui-cwd-"));
  const agentDir = await mkdtemp(join(tmpdir(), "pi-zen-tui-agent-"));
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true }));
  const terminal = TuiTest.ephemeral("pi-zen", {
    backend: "xtermjs",
    recording: { mode: "disabled" },
    artifacts: { dir: join(tmpdir(), "pi-zen-tui-artifacts"), onFailure: "text" },
    timeouts: { text: 10_000, idle: 10_000, command: 10_000, exit: 10_000, ready: 10_000 },
  });
  terminals.push(terminal);
  await terminal.run(process.execPath, [
    pi,
    "--provider", "pi-zen-fixture",
    "--model", "fixture",
    "--tools", "bash",
    "--extension", piZen,
    "--extension", provider,
    "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
    "--offline", "--no-session", "--approve",
  ], {
    cols,
    rows: 20,
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, NO_COLOR: "1" },
    waitReady: false,
  });
  await terminal.getByText(cwd).expect({ timeout: 10_000 });
  await terminal.waitIdle({ timeout: 10_000 });
  await terminal.submit("run fixture");
  return terminal;
}

function summaryRows(screen: string): string[] {
  return screen.split("\n").filter((line) => /[.…✓✗] bash /.test(line));
}

async function summaryRow(terminal: TuiTest, status: "…" | "✓"): Promise<{ row: number; text: string }> {
  const location = await terminal.getByText(`${status} bash sleep 2; echo`).location();
  const rows = summaryRows(await terminal.text({ full: true }));
  const text = rows.find((line) => line.includes(`${status} bash sleep 2; echo`));
  expect(text).toBeDefined();
  return { row: location.start.row, text: text!.trimEnd() };
}

function expectSingleLineSummary(text: string, width: number, status: "…" | "✓"): void {
  expect(text).toMatch(new RegExp(`^${status} bash sleep 2; echo`));
  expect(text).not.toContain("\n");
  expect(Array.from(text).length).toBeLessThanOrEqual(width);
}

describe("実PTYでpi-zenを読み込んだpiセッション", () => {
  for (const width of [40, 64, 100]) {
    it(`${width}桁で実行中から完了へ同じツール要約を更新し、ツール詳細を表示しない`, async () => {
      const terminal = await runPi(width);

      await terminal.getByText("… bash sleep 2; echo").expect({ timeout: 8_000 });
      const runningSummary = await summaryRow(terminal, "…");
      const running = await terminal.text({ full: true });
      expect(summaryRows(running)).toHaveLength(1);
      expectSingleLineSummary(runningSummary.text, width, "…");
      expect(running).not.toContain("HIDDEN_TOOL_BODY");
      if (width === 40) expect(running).not.toContain("| base64 -d");

      const completedSummary = terminal.getByText("✓ bash sleep 2; echo");
      await completedSummary.expect({ timeout: 8_000 });
      const completedRow = await summaryRow(terminal, "✓");
      expect(completedRow.row).toBe(runningSummary.row);
      expectSingleLineSummary(completedRow.text, width, "✓");
      if (width === 40) expect(await terminal.text({ full: true })).not.toContain("| base64 -d");
      const location = await completedSummary.location();
      const summaryCells = await terminal.cells(
        0, location.start.row, width, 1,
      );
      expect(summaryCells.every((cell) => cell.bg === "default")).toBe(true);
      await terminal.getByText("FIXTURE_DONE").expect({ timeout: 8_000 });
      const completed = await terminal.text({ full: true });
      expect(summaryRows(completed)).toHaveLength(1);
      expect(completed).not.toContain("HIDDEN_TOOL_BODY");
      expect(completed).not.toContain("… bash");
      expect((await terminal.getSize()).cols).toBe(width);
    }, 20_000);
  }

  it("実行中と完了後のresizeでも要約を折り返さず、詳細を再表示しない", async () => {
    const terminal = await runPi(100);
    await terminal.getByText("… bash sleep 2; echo").expect({ timeout: 8_000 });
    await terminal.resize(40, 20);
    await terminal.getByText("… bash sleep 2; echo").expect({ timeout: 8_000 });
    const resizedRunning = await summaryRow(terminal, "…");
    expectSingleLineSummary(resizedRunning.text, 40, "…");
    expect(summaryRows(await terminal.text({ full: true }))).toHaveLength(1);

    await terminal.getByText("✓ bash sleep 2; echo").expect({ timeout: 8_000 });
    const completedAt40 = await summaryRow(terminal, "✓");
    expectSingleLineSummary(completedAt40.text, 40, "✓");
    await terminal.resize(64, 20);
    await terminal.getByText("✓ bash sleep 2; echo").expect({ timeout: 8_000 });
    const resizedCompleted = await summaryRow(terminal, "✓");
    expectSingleLineSummary(resizedCompleted.text, 64, "✓");
    const completed = await terminal.text({ full: true });
    expect(summaryRows(completed)).toHaveLength(1);
    expect(completed).not.toContain("HIDDEN_TOOL_BODY");
  }, 20_000);
});
