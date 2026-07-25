// plugin-handlers/before/scope.ts — write scope enforcement
// Migrated from plugins/scope-before.ts
import { validateWriteScope } from "../../service/gate";

export const name = "scope";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  const result = validateWriteScope(input, output);
  if (result.blocked) {
    throw new Error(result.message);
  }
}
