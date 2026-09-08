import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Call } from "./isolated-pi.js";

export const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");
export const japanesePath = "日本語/とても長いディレクトリ名/途中を省略するファイル名.txt";
export const cases: Array<{ call: Call; error: boolean }> = [
  { call: { name: "read", arguments: { path: "source.txt" } }, error: false },
  { call: { name: "write", arguments: { path: "written.txt", content: "HIDDEN_WRITE_BODY\n" } }, error: false },
  { call: { name: "edit", arguments: { path: "source.txt", edits: [{ oldText: "before", newText: "after\nadded" }] } }, error: false },
  { call: { name: "bash", arguments: { command: "printf SElEREVOX0JBU0hfQk9EWQ== | base64 -d" } }, error: false },
  { call: { name: "grep", arguments: { pattern: "HIDDEN", path: "search" } }, error: false },
  { call: { name: "find", arguments: { pattern: "*.txt", path: "search" } }, error: false },
  { call: { name: "ls", arguments: { path: "search" } }, error: false },
  { call: { name: "read", arguments: { path: "missing.txt" } }, error: true },
  { call: { name: "write", arguments: { path: "blocked.txt/child", content: "must not write" } }, error: true },
  { call: { name: "edit", arguments: { path: "source.txt", edits: [{ oldText: "not present", newText: "must not write" }] } }, error: true },
  { call: { name: "bash", arguments: { command: "printf SElEREVOX0VSUk9SX0xPRw== | base64 -d; exit 7" } }, error: true },
  { call: { name: "grep", arguments: { pattern: "[", path: "search" } }, error: true },
  { call: { name: "find", arguments: { pattern: "*.txt", path: "missing" } }, error: true },
  { call: { name: "ls", arguments: { path: "missing" } }, error: true },
  { call: { name: "read", arguments: { path: "image.png" } }, error: false },
  { call: { name: "read", arguments: { path: "large.txt" } }, error: false },
  // Legacy arguments must still pass the standard prepareArguments contract.
  { call: { name: "edit", arguments: { path: "source.txt", oldText: "added", newText: "legacy" } }, error: false },
];

export async function seedTools(cwd: string): Promise<void> {
  await mkdir(join(cwd, "search"), { recursive: true });
  await mkdir(join(cwd, "日本語/とても長いディレクトリ名"), { recursive: true });
  for (const [path, content] of Object.entries({
    "source.txt": "before\n", "written.txt": "old contents\n", "blocked.txt": "blocker\n",
    "search/HIDDEN_FILENAME.txt": "HIDDEN_SEARCH_BODY\n", "large.txt": "HIDDEN_LARGE_BODY\n".repeat(2100),
    [japanesePath]: "HIDDEN_JAPANESE_BODY\n",
  })) await writeFile(join(cwd, path), content);
  await writeFile(join(cwd, "image.png"), image);
}
