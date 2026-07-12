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
});
