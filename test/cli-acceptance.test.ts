import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { cliArgs, isolatedPi, toolNames } from "./fixtures/isolated-pi.js";
import { cases, seedTools } from "./fixtures/tool-scenarios.js";

const exec = promisify(execFile);
const jsonLines = (text: string) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const withoutTimestamp = ({ timestamp, ...message }: any) => message;

async function runJson(fixture: Awaited<ReturnType<typeof isolatedPi>>, enabled: boolean, options: string[] = []) {
  await writeFile(fixture.requests, "");
  const sessionDir = join(fixture.sessionDir, String(enabled));
  const execution = exec(process.execPath, [
    ...cliArgs(enabled), "--session-dir", sessionDir, ...options, "--mode", "json", "-p", "run fixture",
  ], { cwd: fixture.cwd, env: fixture.env, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
  execution.child.stdin!.end();
  const { stdout } = await execution;
  const events = jsonLines(stdout);
  const [file] = await readdir(sessionDir);
  const saved = jsonLines(await readFile(join(sessionDir, file!), "utf8"));
  const requests = jsonLines(await readFile(fixture.requests, "utf8"));
  return { events, saved, requests };
}

it("JSON CLIで全7ツールの成功・失敗、画像、大量read、既存write、旧edit引数の非干渉を比較する", async () => {
  const fixture = await isolatedPi(cases.map(({ call }) => [call]));
  try {
    const runs = [];
    for (const enabled of [false, true]) {
      await seedTools(fixture.cwd);
      const { events, saved, requests } = await runJson(fixture, enabled, ["--tools", toolNames.join(",")]);
      const results = events.filter((event) => event.type === "tool_execution_end");
      expect(results.map(({ toolName, isError }) => ({ toolName, isError }))).toEqual(
        cases.map(({ call, error }) => ({ toolName: call.name, isError: error })),
      );
      expect(results[0].result.content).toEqual([{ type: "text", text: "before\n" }]);
      expect(results[14].result.content, "image read result").toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
      expect(results[15].result.details.truncation.truncated).toBe(true);
      const source = await readFile(join(fixture.cwd, "source.txt"), "utf8");
      const written = await readFile(join(fixture.cwd, "written.txt"), "utf8");
      expect(source).toBe("after\nlegacy\n");
      expect(written).toBe("HIDDEN_WRITE_BODY\n");
      expect(await readFile(join(fixture.cwd, "blocked.txt"), "utf8")).toBe("blocker\n");
      const savedMessages = saved.filter((entry) => entry.type === "message").map(({ message }) => withoutTimestamp(message));
      expect(savedMessages.filter((message) => message.role === "toolResult")).toHaveLength(cases.length);
      expect(requests).toHaveLength(cases.length + 1);
      runs.push({
        calls: events.filter((event) => event.type === "tool_execution_start").map(({ args, toolName }) => ({ args, toolName })),
        results: results.map(({ result, isError }) => ({ result, isError })),
        savedMessages, source, written,
        tools: requests[0].tools,
        modelResults: requests.at(-1).messages.filter((message: any) => message.role === "toolResult").map(withoutTimestamp),
      });
    }
    expect(runs[1]).toEqual(runs[0]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 45_000);

for (const { settings, options, expected } of [
  { settings: { defaultTools: ["read", "ls"] }, options: [], expected: ["read", "ls"] },
  { settings: { defaultTools: ["read", "ls"] }, options: ["--tools", "bash,grep"], expected: ["bash", "grep"] },
  { settings: { defaultTools: ["read", "ls"] }, options: ["--exclude-tools", "ls"], expected: ["read"] },
  { settings: { defaultTools: [] }, options: [], expected: [] },
  { settings: {}, options: ["--no-tools"], expected: [] },
]) {
  it(`設定／CLIの有効ツール集合を維持する: ${JSON.stringify({ settings, options })}`, async () => {
    const fixture = await isolatedPi([], settings);
    try {
      const definitions = [];
      for (const enabled of [false, true]) {
        const { requests } = await runJson(fixture, enabled, options);
        expect((requests[0].tools ?? []).map((tool: any) => tool.name).sort()).toEqual([...expected].sort());
        definitions.push(requests[0].tools);
      }
      expect(definitions[1]).toEqual(definitions[0]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 45_000);
}
