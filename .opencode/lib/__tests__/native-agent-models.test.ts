import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

type AgentConfig = {
  model?: string;
};

type OpenCodeConfig = {
  agent?: Record<string, AgentConfig>;
};

const OPENCODE_JSON_PATH = path.resolve(import.meta.dir, "../../../opencode.json");

function readConfig(): OpenCodeConfig {
  return JSON.parse(fs.readFileSync(OPENCODE_JSON_PATH, "utf8")) as OpenCodeConfig;
}

describe("native agent model config", () => {
  test("explore keeps the known-good child-session model", () => {
    const config = readConfig();
    const exploreModel = config.agent?.explore?.model;

    expect(exploreModel).toBe("deepseek/deepseek-v4-pro");
    expect(exploreModel).not.toContain("glm");
  });
});
