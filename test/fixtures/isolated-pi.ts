import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const cli = resolve("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
export const piZen = resolve("src/index.ts");
export const provider = resolve("test/fixtures/deterministic-provider.ts");
export const toolNames = ["read", "write", "edit", "bash", "grep", "find", "ls"];
export type Call = { name: string; arguments: Record<string, unknown> };

export async function isolatedPi(batches: Call[][], settings: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-zen-acceptance-"));
  const cwd = join(root, "work");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  for (const dir of [cwd, agentDir, sessionDir]) await mkdir(dir);
  const scenario = join(root, "scenario.json");
  const requests = join(root, "requests.jsonl");
  await writeFile(scenario, JSON.stringify(batches));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    quietStartup: true, compaction: { enabled: false }, ...settings,
  }));
  return {
    root, cwd, agentDir, sessionDir, scenario, requests,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      PI_ZEN_SCENARIO: scenario,
      PI_ZEN_REQUESTS: requests,
    },
  };
}

export function cliArgs(enabled: boolean): string[] {
  return [cli, "--provider", "pi-zen-fixture", "--model", "fixture",
    "--no-extensions", "--extension", provider,
    ...(enabled ? ["--extension", piZen] : []),
    "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
    "--offline", "--approve"];
}
