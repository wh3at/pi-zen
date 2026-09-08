import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TuiTest } from "@microsoft/tui-test";
import { afterEach, expect, it } from "vitest";
import { cliArgs, isolatedPi, piZen, toolNames, type Call } from "./fixtures/isolated-pi.js";
import { cases, japanesePath, seedTools } from "./fixtures/tool-scenarios.js";

const terminals: TuiTest[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((terminal) => terminal.closeQuiet()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(batches: Call[][], settings: Record<string, unknown> = {}) {
  const fixture = await isolatedPi(batches, { extensions: [piZen], ...settings });
  roots.push(fixture.root);
  await seedTools(fixture.cwd);
  return fixture;
}

async function launch(fixture: Awaited<ReturnType<typeof setup>>, width = 100, session?: string) {
  const terminal = TuiTest.ephemeral("pi-zen-lifecycle", {
    backend: "xtermjs", recording: { mode: "disabled" },
    artifacts: { dir: join(fixture.root, "artifacts"), onFailure: "text" },
    timeouts: { text: 10_000, idle: 10_000, command: 10_000, exit: 10_000, ready: 10_000 },
  });
  terminals.push(terminal);
  await terminal.run(process.execPath, [
    ...cliArgs(false).filter((arg) => arg !== "--no-extensions"),
    "--tools", toolNames.join(","), "--session-dir", fixture.sessionDir,
    ...(session ? ["--session", session] : []),
  ], { cwd: fixture.cwd, env: fixture.env, cols: width, rows: 80, waitReady: false });
  await terminal.getByText(fixture.cwd).expect();
  await terminal.waitIdle();
  return terminal;
}

function toolRows(screen: string) {
  return screen.split("\n").map((row) => row.trimEnd()).filter((row) => /^(?:\.{3}|[✓✗]) (read|write|edit|bash|grep|find|ls) /.test(row));
}

for (const width of [40, 64, 100]) {
  it(`${width}桁で全7ツールの成功1行・失敗2行、本文非表示、枠・背景なしを保つ`, async () => {
    const fixture = await setup(cases.slice(0, 14).map(({ call }) => [call]));
    const terminal = await launch(fixture, width);
    await terminal.submit("run fixture");
    await terminal.getByText("FIXTURE_DONE").expect();
    const screen = await terminal.text({ full: true });
    const rows = toolRows(screen);
    expect(rows).toHaveLength(14);
    expect(rows.map((row) => row.split(" ").slice(0, 2).join(" "))).toEqual(
      [...toolNames.map((name) => `✓ ${name}`), ...toolNames.map((name) => `✗ ${name}`)],
    );
    expect(rows[0]).toBe("✓ read source.txt");
    expect(rows[1]).toBe("✓ write written.txt");
    expect(rows[2]).toBe("✓ edit source.txt +2 -1");
    expect(rows[3]).toMatch(/^✓ bash printf /);
    expect(rows[4]).toBe("✓ grep HIDDEN · search");
    expect(rows[5]).toBe("✓ find *.txt · search");
    expect(rows[6]).toBe("✓ ls search");
    const transcript = screen.slice(screen.indexOf("✓ read source.txt"), screen.indexOf("FIXTURE_DONE"));
    expect(transcript.split("\n").filter((row) => row.trim())).toHaveLength(21);
    expect(transcript).toContain("Command exited with code 7");
    for (const marker of ["HIDDEN_WRITE_BODY", "HIDDEN_BASH_BODY", "HIDDEN_SEARCH_BODY", "HIDDEN_FILENAME", "HIDDEN_ERROR_LOG"]) {
      expect(transcript).not.toContain(marker);
    }
    for (const row of rows) {
      const location = await terminal.getByText(row, { whitespace: "exact" }).location();
      const cells = await terminal.cells(0, location.start.row, width, row.startsWith("✗") ? 2 : 1);
      expect(cells.every((cell) => cell.bg === "default")).toBe(true);
    }
  }, 30_000);
}

it("実保存した成功・失敗・edit差分を再開し、展開キーでも本文を再表示しない", async () => {
  const fixture = await setup([
    [{ name: "edit", arguments: { path: "source.txt", edits: [{ oldText: "before", newText: "after\nadded" }] } }],
    [{ name: "edit", arguments: { path: "missing.txt", edits: [{ oldText: "before", newText: "after" }] } }],
  ]);
  const first = await launch(fixture);
  await first.submit("run fixture");
  await first.getByText("FIXTURE_DONE").expect();
  const before = toolRows(await first.text({ full: true }));
  expect(before).toEqual(["✓ edit source.txt +2 -1", "✗ edit missing.txt"]);
  await first.submit("/quit");
  await first.waitExit();
  const [file] = await readdir(fixture.sessionDir);
  const session = join(fixture.sessionDir, file!);
  const savedBefore = await readFile(session, "utf8");
  const resumed = await launch(fixture, 100, session);
  expect(toolRows(await resumed.text({ full: true }))).toEqual(before);
  await resumed.press("Ctrl+O");
  await resumed.waitIdle();
  expect(toolRows(await resumed.text({ full: true }))).toEqual(before);
  expect(await resumed.text({ full: true })).not.toContain("+1 after");
  expect(await resumed.text({ full: true })).toContain("Could not edit file: missing.txt. Error code: ENOENT.");
  expect(await readFile(session, "utf8")).toBe(savedBefore);
}, 30_000);

// Historical rows may use Pi's standard renderer after reload.
it("reloadで保存内容を変えず、その後の呼出しにはツール要約を使う", async () => {
  const fixture = await setup([[cases[2]!.call]]);
  const terminal = await launch(fixture);
  await terminal.submit("run fixture");
  await terminal.getByText("FIXTURE_DONE").expect();
  expect(toolRows(await terminal.text({ full: true }))).toEqual(["✓ edit source.txt +2 -1"]);
  const [file] = await readdir(fixture.sessionDir);
  const session = join(fixture.sessionDir, file!);
  const saved = await readFile(session, "utf8");
  await terminal.submit("/reload");
  await terminal.getByText("Reloaded").expect();
  expect(await readFile(session, "utf8")).toBe(saved);
  expect(await readFile(join(fixture.cwd, "source.txt"), "utf8")).toBe("after\nadded\n");
  await writeFile(fixture.scenario, JSON.stringify([[{ name: "write", arguments: { path: "written.txt", content: "after reload" } }]]));
  await terminal.submit("after reload");
  await terminal.getByText("✓ write written.txt").expect();
  expect(toolRows(await terminal.text({ full: true })).filter((row) => row.includes(" write "))).toEqual(["✓ write written.txt"]);
}, 20_000);

it("日本語の長いパスは途中省略し、editのゼロ差分数とwriteの数値省略を保つ", async () => {
  const fixture = await setup([
    [{ name: "write", arguments: { path: japanesePath, content: "HIDDEN_JAPANESE_BODY" } }],
    [{ name: "edit", arguments: { path: "source.txt", edits: [{ oldText: "before\n", newText: "before\nadded\n" }] } }],
    [{ name: "edit", arguments: { path: "source.txt", edits: [{ oldText: "added\n", newText: "" }] } }],
    [{ name: "write", arguments: { path: "written.txt", content: "HIDDEN_WRITE_BODY" } }],
  ]);
  const terminal = await launch(fixture, 40);
  await terminal.submit("run fixture");
  await terminal.getByText("FIXTURE_DONE").expect();
  const rows = toolRows(await terminal.text({ full: true }));
  expect(rows).toHaveLength(4);
  expect(rows[0]).toMatch(/^✓ write 日本語\/.*….*ファイル名\.txt$/);
  expect(rows.slice(1)).toEqual(["✓ edit source.txt +1 -0", "✓ edit source.txt +0 -1", "✓ write written.txt"]);
  expect(await terminal.text({ full: true })).not.toContain("HIDDEN_JAPANESE_BODY");
  await terminal.resize(100, 80);
  await expect.poll(async () => toolRows(await terminal.text({ full: true }))[0]).toBe(`✓ write ${japanesePath}`);
  expect(toolRows(await terminal.text({ full: true }))).toHaveLength(4);
}, 20_000);

it("同じbashの並行実行は要約の順序を維持し、出力を省略する", async () => {
  const fixture = await setup([[
    { name: "bash", arguments: { command: "sleep 3; printf first" } },
    { name: "bash", arguments: { command: "printf second" } },
  ]]);
  const terminal = await launch(fixture);
  await terminal.submit("run fixture");
  await terminal.getByText("✓ bash printf second").expect();
  expect(toolRows(await terminal.text({ full: true }))).toEqual(["... bash sleep 3; printf first", "✓ bash printf second"]);
  await terminal.getByText("FIXTURE_DONE").expect();
  const screen = await terminal.text({ full: true });
  expect(toolRows(screen)).toEqual(["✓ bash sleep 3; printf first", "✓ bash printf second"]);
  expect(screen.split("\n").filter((line) => /^(first|second)\s*$/.test(line))).toEqual([]);
}, 20_000);

it("bash要約のEscape中断と保存済み理由を維持する", async () => {
  const fixture = await setup([[{ name: "bash", arguments: { command: "sleep 30" } }]]);
  const terminal = await launch(fixture, 40);
  await terminal.submit("run fixture");
  await terminal.getByText("... bash sleep 30").expect();
  await terminal.press("Escape");
  await terminal.getByText("Command aborted").expect();
  await terminal.waitIdle();
  const screen = await terminal.text({ full: true });
  expect(toolRows(screen)).toEqual(["✗ bash sleep 30"]);
  const [file] = await readdir(fixture.sessionDir);
  const entries = (await readFile(join(fixture.sessionDir, file!), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const result = entries.find((entry) => entry.message?.role === "toolResult").message;
  expect(result.isError).toBe(true);
  const reason = result.content[0].text.trim();
  expect(reason).toBe("Command aborted");
  expect(screen).toContain(reason);
  expect(screen).not.toContain("中断しました");
}, 20_000);

for (const [readSummary, showImages] of [[true, true], [true, false], [false, true], [false, false]]) {
  it(`画像readは要約=${readSummary}でも標準画像プロトコルとshowImages=${showImages}を再開後も尊重する`, async () => {
    const fixture = await setup([[{ name: "read", arguments: { path: "image.png" } }]], {
      terminal: { images: "iterm2", showImages },
    });
    await writeFile(join(fixture.agentDir, "pi-zen.json"), JSON.stringify({ read: readSummary }));
    const first = await launch(fixture);
    const capture = join(fixture.root, "image.cast");
    await first.startRecording(capture, { format: "cast" });
    await first.submit("run fixture");
    await first.getByText("FIXTURE_DONE").expect();
    await first.stopRecording();
    const output = (await readFile(capture, "utf8")).trim().split("\n").slice(1)
      .map((line) => JSON.parse(line)).filter((event) => event[1] === "o").map((event) => event[2]).join("");
    expect(output.includes("\x1b]1337;File=")).toBe(showImages);
    expect(toolRows(await first.text({ full: true }))).toEqual(readSummary ? ["✓ read image.png"] : []);
    expect(await first.text({ full: true })).toContain("image.png");
    await first.submit("/quit");
    await first.waitExit();
    const [file] = await readdir(fixture.sessionDir);
    const session = join(fixture.sessionDir, file!);
    const entries = (await readFile(session, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const imageResult = entries.find((entry) => entry.message?.role === "toolResult").message;
    expect(imageResult.content.some((block: any) => block.type === "image")).toBe(true);
    const resumed = await launch(fixture, 100, session);
    expect(toolRows(await resumed.text({ full: true }))).toEqual(readSummary ? ["✓ read image.png"] : []);
    expect(await resumed.text({ full: true })).toContain("image.png");
    // Force a width change to capture the resumed image's redraw.
    const resumedCapture = join(fixture.root, "resumed-image.cast");
    await resumed.startRecording(resumedCapture, { format: "cast" });
    await resumed.resize(64, 80);
    await resumed.waitIdle();
    await resumed.stopRecording();
    const redraw = (await readFile(resumedCapture, "utf8")).trim().split("\n").slice(1)
      .map((line) => JSON.parse(line)).filter((event) => event[1] === "o").map((event) => event[2]).join("");
    expect(redraw.includes("\x1b]1337;File=")).toBe(showImages);
  }, 25_000);
}
