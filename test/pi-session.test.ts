import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const extensionPath = resolve("src/index.ts");

async function loadedSession(cwd: string, tools: string[]) {
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, ".agent"),
    settingsManager,
    additionalExtensionPaths: [extensionPath],
  });
  await loader.reload();
  const loaded = await createAgentSession({
    cwd,
    tools,
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  const extension = loaded.extensionsResult.extensions.find((item) => item.resolvedPath === extensionPath)!;
  const start = extension.handlers.get("session_start")![0]!;
  await start({ type: "session_start", reason: "startup" }, { cwd } as never);
  return loaded;
}

describe("pi-zenを読み込んだpiセッション", () => {
  it("有効な標準ツールだけを保ち、標準実装へ委譲する", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-zen-"));
    await writeFile(join(cwd, "source.txt"), "before\n");
    const { session } = await loadedSession(cwd, ["read", "edit"]);

    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["read", "edit"]);
    const edit = session.agent.state.tools.find((tool) => tool.name === "edit")!;
    const result = await edit.execute("call", {
      path: "source.txt",
      edits: [{ oldText: "before", newText: "after\nadded" }],
    });

    expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in source.txt." }]);
    expect(await readFile(join(cwd, "source.txt"), "utf8")).toBe("after\nadded\n");
    expect((result.details as { diff?: string }).diff).toContain("+1 after");
    session.dispose();
  });

  it("JSON/RPC向け結果を表示用要約へ書き換えない", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-zen-"));
    await writeFile(join(cwd, "source.txt"), "本文\n");
    const { session, extensionsResult } = await loadedSession(cwd, ["read"]);
    expect(extensionsResult.errors).toEqual([]);
    const read = session.agent.state.tools[0]!;

    const result = await read.execute("call", { path: "source.txt" });

    expect(result.content).toEqual([{ type: "text", text: "本文\n" }]);
    session.dispose();
  });

  it("保存済み引数と結果から幅内の要約だけを描画する", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-zen-"));
    const { session, extensionsResult } = await loadedSession(cwd, ["edit", "bash"]);
    const extension = extensionsResult.extensions.find((item) => item.resolvedPath === extensionPath)!;
    const edit = extension.tools.get("edit")!.definition;
    const bash = extension.tools.get("bash")!.definition;
    expect(edit.renderShell).toBe("self");
    const theme = { fg: (_color: string, text: string) => text } as never;
    const context = (args: object, isError = false) => ({
      args, state: {}, lastComponent: undefined, invalidate() {}, toolCallId: "call", cwd,
      executionStarted: true, argsComplete: true, isPartial: false, expanded: true, showImages: true, isError,
    });

    const editResult = edit.renderResult!(
      { content: [{ type: "text", text: "ok" }], details: { diff: "-1 old\n+1 new\n+2 extra" } },
      { expanded: true, isPartial: false }, theme, context({ path: "日本語/とても長い名前/source.txt" }),
    );
    const bashError = bash.renderResult!(
      { content: [{ type: "text", text: "Command exited with code 7\nlarge log" }], details: {} },
      { expanded: true, isPartial: false }, theme, context({ command: "printf a-very-long-command" }, true),
    );

    const plain = (lines: string[]) => lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
    expect(plain(editResult.render(30))).toEqual(["✓ edit 日本語/…urce.txt +2 -1"]);
    expect(plain(bashError.render(24))).toEqual(["✗ bash printf a-very-lo…", "Command exited with cod…"]);
    session.dispose();
  });
});
