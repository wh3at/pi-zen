import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

it("bashとreadの設定済み実行処理を置き換えず、shellPathとprefixを維持する", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-zen-settings-"));
  const shellPath = join(cwd, "configured-shell");
  await writeFile(shellPath, '#!/bin/sh\nexport PI_ZEN_SHELL=custom\nexec /bin/sh "$@"\n');
  await chmod(shellPath, 0o755);
  const settingsManager = SettingsManager.inMemory({
    shellPath,
    shellCommandPrefix: "export PI_ZEN_PREFIX=kept",
    images: { autoResize: false },
  });
  const loader = new DefaultResourceLoader({
    cwd, agentDir: join(cwd, ".agent"), settingsManager,
    additionalExtensionPaths: [resolve("src/index.ts")],
  });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd, tools: ["bash", "read", "edit"], resourceLoader: loader, settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  try {
    const bash = session.getToolDefinition("bash")!;
    const read = session.getToolDefinition("read")!;
    await session.bindExtensions({ mode: "rpc" });
    expect(extensionsResult.errors).toEqual([]);
    const result = await session.agent.state.tools.find((tool) => tool.name === "bash")!.execute("call", {
      command: 'printf "%s:%s" "$PI_ZEN_SHELL" "$PI_ZEN_PREFIX"',
    });
    expect(result.content).toEqual([{ type: "text", text: "custom:kept" }]);
    expect(session.getToolDefinition("bash")).toBe(bash);
    expect(session.getToolDefinition("read")).toBe(read);
    expect(session.getAllTools().filter((tool) => ["bash", "read"].includes(tool.name))
      .every((tool) => tool.sourceInfo.source === "builtin")).toBe(true);
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["bash", "read", "edit"]);
  } finally {
    session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
