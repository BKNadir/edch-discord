// The admin page's sign-in: an account made at the first visit (only with the key that SSH access
// can read in bot.env), its password kept as a salted scrypt hash in admin-credentials.json
// (readable by this user only), sessions in memory, and sign-in attempts limited.
// Lost the password? Delete admin-credentials.json on the machine (over SSH): the next visit makes
// a new account, again with the key.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

/** scrypt's cost: about 50 ms and 32 MB per try, so guessing is slow. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
/** A session ends after this long, or after this long unused. */
const SESSION_MS = 8 * 3600_000;
const IDLE_MS = 3600_000;
/** After this many wrong sign-ins in a row, sign-in waits this long. */
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD = 12;
export const USER_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

const hash = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** Compares two texts in constant time (the key, a session id). */
export function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(expected ?? ""));
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
}

/** Why a new password is refused, or "" when it's fine. */
export function passwordProblem(password, user = "") {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return "tooShort";
  if (password.length > 200) return "tooLong";
  if (user && password.toLowerCase().includes(user.toLowerCase())) return "containsUser";
  if (new Set(password).size < 6) return "tooSimple";
  return "";
}

/** The sign-in of the admin page, kept in `path`. */
export function createAuth(path) {
  const sessions = new Map();
  let failures = 0;
  let lockedUntil = 0;

  const read = () => {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      return typeof saved.user === "string" && typeof saved.hash === "string" && typeof saved.salt === "string"
        ? saved
        : null;
    } catch {
      return null;
    }
  };

  async function save(user, password) {
    const salt = randomBytes(16);
    const key = await hash(password, salt);
    const record = {
      user,
      salt: salt.toString("hex"),
      hash: key.toString("hex"),
      scrypt: "N=32768,r=8,p=1",
      changedAt: new Date().toISOString(),
    };
    writeFileSync(path, JSON.stringify(record) + "\n", { mode: 0o600 });
  }

  function newSession() {
    const id = randomBytes(32).toString("hex");
    const now = Date.now();
    sessions.set(id, { created: now, seen: now });
    return id;
  }

  return {
    /** "create" (no account yet) or "login". */
    stage: () => (read() ? "login" : "create"),

    /** Makes the account; a session id, or the reason it's refused. */
    async create(user, password) {
      if (read()) return { error: "exists" };
      if (!USER_PATTERN.test(String(user ?? ""))) return { error: "badUser" };
      const problem = passwordProblem(password, user);
      if (problem) return { error: problem };
      await save(user, password);
      sessions.clear();
      return { session: newSession() };
    },

    /** Checks a sign-in; a session id, or why not (wrong, locked with the seconds left). */
    async login(user, password) {
      const now = Date.now();
      if (now < lockedUntil) return { error: "locked", retryIn: Math.ceil((lockedUntil - now) / 1000) };
      const saved = read();
      // Hashed anyway when the user is wrong: the answer takes as long either way.
      const key = await hash(String(password ?? ""), saved ? Buffer.from(saved.salt, "hex") : randomBytes(16));
      const ok =
        Boolean(saved) &&
        sameSecret(String(user ?? ""), saved.user) &&
        timingSafeEqual(key, Buffer.from(saved.hash, "hex"));
      if (!ok) {
        failures += 1;
        if (failures >= MAX_FAILURES) {
          lockedUntil = now + LOCK_MS;
          failures = 0;
          console.error("admin page: too many wrong sign-ins, locked for 15 minutes");
        }
        return { error: "wrong" };
      }
      failures = 0;
      return { session: newSession() };
    },

    /** Whether a session id is valid (and keeps it alive). */
    check(id) {
      if (!id) return false;
      for (const [known, session] of sessions) {
        if (!sameSecret(id, known)) continue;
        const now = Date.now();
        if (now - session.created > SESSION_MS || now - session.seen > IDLE_MS) {
          sessions.delete(known);
          return false;
        }
        session.seen = now;
        return true;
      }
      return false;
    },

    logout(id) {
      for (const known of sessions.keys()) if (sameSecret(id, known)) sessions.delete(known);
    },

    /** Changes the password (the current one is asked again); every other session ends. */
    async changePassword(current, next) {
      const saved = read();
      if (!saved) return { error: "noAccount" };
      const key = await hash(String(current ?? ""), Buffer.from(saved.salt, "hex"));
      if (!timingSafeEqual(key, Buffer.from(saved.hash, "hex"))) return { error: "wrong" };
      const problem = passwordProblem(next, saved.user);
      if (problem) return { error: problem };
      await save(saved.user, next);
      sessions.clear();
      return { session: newSession() };
    },

    /** For the tests: forgets the account (the machine's owner deletes the file instead). */
    reset() {
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
      sessions.clear();
    },
  };
}
