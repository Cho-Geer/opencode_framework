/**
 * tolerant-json.ts — Tolerant JSON Parser Utility
 * =================================================
 *
 * Provides tolerantParse() which attempts strict JSON.parse() first,
 * then falls back to stripping trailing commas before retrying.
 *
 * Trailing commas (e.g., ["a", "b", ]) are valid in JavaScript but
 * invalid in standard JSON. They can be introduced by safe_edit
 * operations that use JS-style formatting. This utility provides
 * defense-in-depth for all JSON file reads in the framework.
 *
 * @author @Super-Admin
 * @since 2026-06-11 (SA-IMPL-LEGACY-FIXES)
 */

/**
 * Parse JSON content with trailing comma tolerance.
 * Attempts strict parse first; on failure, strips trailing commas
 * and retries. Throws if parse fails after both attempts.
 *
 * @param raw - Raw JSON string to parse
 * @returns Parsed JSON value
 * @throws Error if parse fails even after trailing comma removal
 */
export function tolerantParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch (e: any) {
    // Strip trailing commas: ",  ]" becomes "  ]", ",  }" becomes "  }"
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    if (cleaned === raw) {
      // No trailing commas found — rethrow original error
      throw e;
    }
    try {
      return JSON.parse(cleaned);
    } catch (e2: any) {
      throw new Error(
        `JSON parse failed after trailing comma fix: ${e2.message}`,
      );
    }
  }
}
