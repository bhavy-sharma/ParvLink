// Every Server Action is a public HTTP endpoint: anyone can POST to it, whether
// or not a page ever showed them the form. This test reads the source of every
// "use server" file and fails if an exported action does not start by checking
// who is calling. It is a seat-belt against forgetting the check in a new
// action — the database rules (tests/db) are what actually enforce access.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../../src");
const GUARD = /^(?:const\s+(?:\{[^}]*\}|\w+)\s*=\s*)?await\s+(requireUser|requireProfileOrSignedOut|requireProfile|requireAdmin|requireSuperAdmin|requireAdminWith|requireEventManager|requireManagedEvent)\(/;

// Actions that must work without a session. Each is reviewed by hand; none
// reads or changes anything on behalf of an existing user.
const PUBLIC_ACTIONS = new Set(["registerAction", "loginAction", "logoutAction", "resendVerificationAction", "requestPasswordResetAction"]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
}

function actionsIn(source) {
  const found = [];
  const pattern = /export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const body = source.slice(match.index + match[0].length);
    const firstStatement = body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));
    const lines = body.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("//"));
    found.push({ name: match[1], firstStatement, secondStatement: lines[1] ?? "" });
  }
  return found;
}

const files = walk(ROOT).filter((file) => /^\s*["']use server["'];/.test(readFileSync(file, "utf8")));
const actions = files.flatMap((file) => actionsIn(readFileSync(file, "utf8")).map((action) => ({ ...action, file: path.relative(ROOT, file) })));

describe("Server Actions check the caller before anything else", () => {
  test("the scan finds the action files", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(actions.length).toBeGreaterThanOrEqual(39);
    expect(actions.map((a) => a.name)).toEqual(expect.arrayContaining(["deleteAccountAction", "submitFeedbackAction", "completeAccountDeletionAction", "sendMessageAction"]));
  });

  test.each(actions.filter((action) => !PUBLIC_ACTIONS.has(action.name)).map((action) => [action.name, action.file, action.firstStatement]))(
    "%s (%s) starts with a guard",
    (_name, _file, firstStatement) => {
      expect(firstStatement).toMatch(GUARD);
    },
  );

  test("actions using the non-redirecting guard stop at once when there is no session", () => {
    const soft = actions.filter((action) => action.firstStatement.includes("requireProfileOrSignedOut("));
    expect(soft.map((a) => a.name).sort()).toEqual(["loadMessagesAction", "sendMessageAction"]);
    for (const action of soft) {
      expect(action.firstStatement, action.name).toMatch(/^const session = await requireProfileOrSignedOut\(\);/);
      expect(action.secondStatement, action.name).toBe("if (!session) return SIGNED_OUT;");
    }
  });

  test("the public actions are exactly the sign-in ones, all in the auth file", () => {
    const publicOnes = actions.filter((action) => PUBLIC_ACTIONS.has(action.name));
    expect(publicOnes.map((a) => a.name).sort()).toEqual([...PUBLIC_ACTIONS].sort());
    for (const action of publicOnes) expect(action.file).toBe(path.join("app", "(auth)", "actions.js"));
  });

  test("only async functions are exported from action files", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const exports = source.match(/^export\s+(?!async\s+function)\S+.*$/gm) ?? [];
      expect(exports, path.relative(ROOT, file)).toEqual([]);
    }
  });
});
