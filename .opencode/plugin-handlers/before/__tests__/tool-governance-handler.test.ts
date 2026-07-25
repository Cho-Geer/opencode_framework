import { describe, test, expect } from "bun:test";
import { handle } from "../tool-governance-handler";

describe("tool-governance-handler github repo-op", () => {
  test("github write => throws REPO-OP (governance domain is sole adjudicator)", async () => {
    await expect(
      handle(
        { tool: "github_create_issue", sessionID: "tg-sid", args: { owner: "o", repo: "r", title: "t" } },
        {},
      ),
    ).rejects.toThrow(/REPO-OP/);
  });

  test("github read => resolves (allowed, no block)", async () => {
    await expect(
      handle(
        { tool: "github_get_issue", sessionID: "tg-sid", args: { owner: "o", repo: "r", issue_number: 1 } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("safe_shell gh write => throws REPO-OP", async () => {
    await expect(
      handle(
        {
          tool: "safe_shell",
          sessionID: "tg-sid",
          args: {
            command: "gh issue create --repo microsoft/vscode --title test --body body",
          },
        },
        {},
      ),
    ).rejects.toThrow(/REPO-OP/);
  });

  test("safe_shell git add => throws REPO-OP", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "tg-sid", args: { command: "git add src/index.ts" } },
        {},
      ),
    ).rejects.toThrow(/REPO-OP/);
  });

  test("safe_shell read command => injects verified command plan into output args", async () => {
    const output: Record<string, any> = {};
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "tg-sid", args: { command: "pwd" } },
        output,
      ),
    ).resolves.toBeUndefined();
    expect(output.args.command).toBe("pwd");
    expect(output.args.__verified_command_plan).toBeDefined();
    expect(output.args.__verified_command_plan.executable.startsWith("/")).toBe(true);
    expect(output.args.__verified_command_plan.args).toEqual([]);
  });
});
