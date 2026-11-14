// The admin page's sign-in (scripts/admin-auth.mjs): account made once, password kept as a hash,
// wrong sign-ins limited, sessions that end, password change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth, passwordProblem } from "../scripts/admin-auth.mjs";

const file = () => join(mkdtempSync(join(tmpdir(), "edch-admin-")), "admin-credentials.json");
const PASSWORD = "the squadron flies at dawn";

test("admin sign-in: one account, its password never kept as such", async () => {
  const path = file();
  const auth = createAuth(path);
  assert.equal(auth.stage(), "create");
  assert.equal((await auth.create("admin", "short")).error, "tooShort");
  assert.equal((await auth.create("a b", PASSWORD)).error, "badUser");
  const made = await auth.create("admin", PASSWORD);
  assert.ok(made.session && auth.check(made.session));
  assert.equal(auth.stage(), "login");
  assert.equal((await auth.create("other", PASSWORD)).error, "exists");
  const saved = readFileSync(path, "utf8");
  assert.ok(!saved.includes(PASSWORD));
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  // Deleting the file (over SSH) brings the first visit back.
  auth.reset();
  assert.equal(auth.stage(), "create");
  assert.equal(auth.check(made.session), false);
});

test("admin sign-in: wrong passwords, then locked; sign-out and password change", async () => {
  const auth = createAuth(file());
  await auth.create("admin", PASSWORD);
  const ok = await auth.login("admin", PASSWORD);
  assert.ok(ok.session);
  auth.logout(ok.session);
  assert.equal(auth.check(ok.session), false);
  for (let i = 0; i < 5; i++) assert.equal((await auth.login("admin", "wrong password!")).error, "wrong");
  const locked = await auth.login("admin", PASSWORD);
  assert.equal(locked.error, "locked");
  assert.ok(locked.retryIn > 800);
  const fresh = createAuth(file());
  await fresh.create("admin", PASSWORD);
  assert.equal((await fresh.changePassword("not it", "a brand new sentence")).error, "wrong");
  assert.equal((await fresh.changePassword(PASSWORD, "admin is my name ok")).error, "containsUser");
  const changed = await fresh.changePassword(PASSWORD, "a brand new sentence");
  assert.ok(changed.session);
  assert.equal((await fresh.login("admin", PASSWORD)).error, "wrong");
  assert.ok((await fresh.login("admin", "a brand new sentence")).session);
  assert.equal(passwordProblem("aaaaaaaaaaaaaaa"), "tooSimple");
});
