import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";

let cwd: string;
let agentDir: string;
const sessions: AgentSession[] = [];
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "pi-zen-settings-"));
  agentDir = join(cwd, ".agent");
  await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllEnvs();
  await rm(cwd, { recursive: true, force: true });
});

async function loadedSession(config?: string) {
  if (config !== undefined) await writeFile(join(agentDir, "pi-zen.json"), config);
  const shellPath = join(cwd, "configured-shell");
  await writeFile(shellPath, '#!/bin/sh\nexport PI_ZEN_SHELL=custom\nexec /bin/sh "$@"\n');
  await chmod(shellPath, 0o755);
  const settingsManager = SettingsManager.inMemory({
    shellPath,
    shellCommandPrefix: "export PI_ZEN_PREFIX=kept",
    images: { autoResize: false },
  });
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    additionalExtensionPaths: [resolve("src/index.ts")],
  });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd, tools: ["bash", "read", "edit"], resourceLoader: loader, settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  sessions.push(session);
  const original = { bash: session.getToolDefinition("bash")!, read: session.getToolDefinition("read")! };
  await session.bindExtensions({ mode: "rpc", shutdownHandler() {} });
  return { session, extensionsResult, original };
}

it.each([
  { config: undefined, bash: true, read: true },
  { config: "{}", bash: true, read: true },
  { config: '{"bash":true,"read":true}', bash: true, read: true },
  { config: '{"bash":false}', bash: false, read: true },
  { config: '{"read":false}', bash: true, read: false },
  { config: '{"bash":false,"read":false}', bash: false, read: false },
])("省略時は要約を有効にし、falseのツールだけ設定済み標準定義を残す: $config", async ({ config, bash, read }) => {
  const { session, extensionsResult, original } = await loadedSession(config);
  expect(extensionsResult.errors).toEqual([]);
  for (const [name, enabled] of [["bash", bash], ["read", read]] as const) {
    const tool = session.getToolDefinition(name)!;
    expect(tool === original[name]).toBe(!enabled);
    expect(tool.renderShell === "self").toBe(enabled);
    expect(session.getAllTools().find((tool) => tool.name === name)!.sourceInfo.source === "builtin").toBe(!enabled);
  }
  const result = await session.agent.state.tools.find((tool) => tool.name === "bash")!.execute("call", {
    command: 'printf "%s:%s" "$PI_ZEN_SHELL" "$PI_ZEN_PREFIX"',
  });
  // Enabled summaries use factory defaults; opting out retains both session settings.
  expect(result.content).toEqual([{ type: "text", text: bash ? ":" : "custom:kept" }]);
  expect(session.getToolDefinition("edit")!.renderShell).toBe("self");
  expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["bash", "read", "edit"]);
});

it.each(['{', 'null', '[]', '{"bash":"false"}', '{"read":0}'])("不正な設定を黙って有効扱いせず、拡張ロードエラーにする: %s", async (config) => {
  const { session, extensionsResult, original } = await loadedSession(config);
  expect(extensionsResult.errors).toHaveLength(1);
  expect(extensionsResult.errors[0]!.error).toContain("pi-zen.json");
  expect(session.getToolDefinition("bash")).toBe(original.bash);
  expect(session.getToolDefinition("read")).toBe(original.read);
});

it("reloadで設定を読み直し、無効化と再有効化を反映する", async () => {
  const { session } = await loadedSession();
  for (const enabled of [false, true]) {
    await writeFile(join(agentDir, "pi-zen.json"), JSON.stringify({ bash: enabled, read: enabled }));
    await session.reload();
    for (const name of ["bash", "read"]) {
      expect(session.getToolDefinition(name)!.renderShell === "self").toBe(enabled);
    }
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["bash", "read", "edit"]);
  }
});
