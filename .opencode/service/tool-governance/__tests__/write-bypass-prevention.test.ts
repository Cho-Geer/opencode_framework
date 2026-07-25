import { describe, test, expect } from "bun:test";

describe("write API obfuscation bypass prevention", () => {
  // Phase 9 加固后的正则
  const writeApis =
    /writeFile|appendFile|fs\.write|fs\.append|fs\.rm|fs\.unlink|fs\.rename|fs\.mkdir|createWriteStream|child_process|exec\(|spawn\(|open\(|\[\s*['"]write['"]?\s*\+\s*['"]?File|\[\s*['"]writeFile['"]\s*\]|\[\s*['"]appendFile['"]\s*\]/;

  test("string concatenation writeFileSync is detected", () => {
    const cmd = `require('fs')['write'+'FileSync']('src/pwn.ts','x')`;
    expect(writeApis.test(cmd)).toBe(true);
  });

  test("bracket notation writeFile is detected", () => {
    const cmd = `require('fs')['writeFile']('src/pwn.ts','x')`;
    expect(writeApis.test(cmd)).toBe(true);
  });

  test("bracket notation appendFile is detected", () => {
    const cmd = `require('fs')['appendFile']('src/pwn.ts','x')`;
    expect(writeApis.test(cmd)).toBe(true);
  });

  test("plain writeFileSync is still detected", () => {
    const cmd = `require('fs').writeFileSync('src/pwn.ts','x')`;
    expect(writeApis.test(cmd)).toBe(true);
  });

  test("read-only require('fs').readFileSync is NOT detected", () => {
    const cmd = `require('fs').readFileSync('src/foo.ts','utf8')`;
    expect(writeApis.test(cmd)).toBe(false);
  });
});
