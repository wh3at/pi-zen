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
  await loaded.session.bindExtensions({ mode: "rpc" });
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
    const { session, extensionsResult } = await loadedSession(cwd, ["edit", "write"]);
    const extension = extensionsResult.extensions.find((item) => item.resolvedPath === extensionPath)!;
    const edit = extension.tools.get("edit")!.definition;
    const write = extension.tools.get("write")!.definition;
    expect(edit.renderShell).toBe("self");
    expect(edit.promptSnippet).toBe(
      "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    );
    expect(edit.promptGuidelines).toHaveLength(4);
    const theme = { fg: (_color: string, text: string) => text } as never;
    const context = (args: object, isError = false, isPartial = false) => ({
      args, state: {}, lastComponent: undefined, invalidate() {}, toolCallId: "call", cwd,
      executionStarted: true, argsComplete: true, isPartial, expanded: true, showImages: true, isError,
    });

    const editResult = edit.renderResult!(
      { content: [{ type: "text", text: "ok" }], details: { diff: "-1 old\n+1 new\n+2 extra" } },
      { expanded: true, isPartial: false }, theme, context({ path: "日本語/とても長い名前/source.txt" }),
    );
    const writeError = write.renderResult!(
      { content: [{ type: "text", text: "Permission denied\nextra detail" }], details: {} },
      { expanded: true, isPartial: false }, theme, context({ path: "source.txt" }, true),
    );
    const resumedCall = edit.renderCall!(
      { path: "source.txt" }, theme, context({ path: "source.txt" }),
    );
    const multilineCall = write.renderCall!(
      { path: "first\nsecond" }, theme, context({ path: "first\nsecond" }, false, true),
    );

    const plain = (lines: string[]) => lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
    expect(plain(editResult.render(30))).toEqual(["✓ edit 日本語/…urce.txt +2 -1"]);
    expect(plain(writeError.render(24))).toEqual(["✗ write source.txt", "Permission denied"]);
    expect(resumedCall.render(30)).toEqual([]);
    expect(plain(multilineCall.render(40))).toEqual(["... write first second"]);
    session.dispose();
  });

  it("状態色は完了マークだけに適用し、実行中の点だけを明暗表示する", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-zen-"));
    const { session, extensionsResult } = await loadedSession(cwd, ["write", "edit"]);
    try {
      const extension = extensionsResult.extensions.find((item) => item.resolvedPath === extensionPath)!;
      const applied: [string, string][] = [];
      const theme = { fg: (color: string, text: string) => {
        applied.push([color, text]);
        return text;
      } } as never;
      for (const name of ["write", "edit"]) {
        const tool = extension.tools.get(name)!.definition;
        const args = { path: "source.txt" };
        const context = {
          args, state: {}, lastComponent: undefined, invalidate() {}, toolCallId: "call", cwd,
          executionStarted: true, argsComplete: true, isPartial: true, expanded: false, showImages: false, isError: false,
        };
        applied.length = 0;
        tool.renderCall!(args, theme, context).render(80);
        expect(applied.filter(([color]) => color !== "text")).toEqual([["dim", "."], ["dim", "."], ["dim", "."]]);
        for (const isError of [false, true]) {
          applied.length = 0;
          tool.renderResult!(
            { content: [{ type: "text", text: "failure reason" }], details: { diff: "-1 old\n+1 new" } },
            { expanded: false, isPartial: false }, theme, { ...context, isPartial: false, isError },
          ).render(80);
          expect(applied.filter(([color]) => color !== "text")).toEqual([
            [isError ? "error" : "success", isError ? "✗" : "✓"],
          ]);
        }
      }
    } finally {
      session.dispose();
    }
  });
});
