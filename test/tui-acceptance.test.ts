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
  return screen.split("\n").filter((line) => /(?:\.{3}|[✓✗]) bash /.test(line));
}

describe("実PTYでpi-zenを読み込んだpiセッション", () => {
  for (const width of [40, 64, 100]) {
    it(`${width}桁でbashを標準表示のまま実行し、出力を表示する`, async () => {
      const terminal = await runPi(width);
      await terminal.getByText("$ sleep 2; echo").expect();
      expect(summaryRows(await terminal.text({ full: true }))).toEqual([]);
      await terminal.getByText("FIXTURE_DONE").expect();
      const completed = await terminal.text({ full: true });
      expect(completed).toContain("HIDDEN_TOOL_BODY");
      expect(summaryRows(completed)).toEqual([]);
      expect((await terminal.getSize()).cols).toBe(width);
    }, 20_000);
  }

  it("実行中と完了後のresizeでもbashの標準表示を維持する", async () => {
    const terminal = await runPi(100);
    await terminal.getByText("$ sleep 2; echo").expect();
    await terminal.resize(40, 20);
    await terminal.getByText("$ sleep 2; echo").expect();
    await terminal.getByText("FIXTURE_DONE").expect();
    await terminal.resize(64, 20);
    await terminal.waitIdle();
    const completed = await terminal.text({ full: true });
    expect(completed).toContain("HIDDEN_TOOL_BODY");
    expect(summaryRows(completed)).toEqual([]);
  }, 20_000);
});
