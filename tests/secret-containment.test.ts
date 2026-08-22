import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".tools", ".git"].includes(entry)) continue;
    const full = join(dir, entry);
    // The vendored skills under .claude/skills are symlinks that do not
    // resolve on every checkout. A dangling link is not a source file, and
    // it must not take the whole secret scan down with it.
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sourceFiles(ROOT);

// The service/secret key bypasses RLS completely. One leak into a client
// bundle exposes every clinic's data at once, so this is asserted rather
// than trusted.
describe("the secret key cannot reach a browser", () => {
  it("is never referenced from a client component", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      const isClient = /^\s*["']use client["']/m.test(src);
      return isClient && src.includes("SUPABASE_SECRET_KEY");
    });
    expect(offenders).toEqual([]);
  });

  it("is never referenced outside lib/supabase/admin.ts", () => {
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SECRET_KEY"))
      .map((f) => f.replace(ROOT + "/", ""))
      .filter((f) => !f.startsWith("tests/"));
    expect(offenders).toEqual(["lib/supabase/admin.ts"]);
  });

  it("is never given a NEXT_PUBLIC_ prefix anywhere", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8")).not.toMatch(/NEXT_PUBLIC_\w*SECRET/);
    }
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_\w*SECRET/);
  });

  // "server-only" makes the build fail rather than shipping the key, so it
  // is the actual guarantee — the checks above only catch what we thought of.
  it("the admin module is marked server-only", () => {
    const admin = readFileSync(join(ROOT, "lib/supabase/admin.ts"), "utf8");
    expect(admin).toMatch(/^import "server-only";/m);
  });

  it("no real secret value is committed to a tracked file", () => {
    // .env.local holds the live key and is gitignored; prove that's true
    // rather than assuming it.
    const ignored = execSync("git check-ignore -q .env.local; echo $?", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    expect(ignored, ".env.local must be gitignored").toBe("0");

    const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|json|md|sql|css|js|mjs)$/.test(f));
    for (const f of tracked) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} contains a live secret key`).not.toMatch(/sb_secret_[A-Za-z0-9_-]+/);
    }
  });
});

describe("platform admin is gated on a verified identity", () => {
  const admin = readFileSync(join(ROOT, "lib/supabase/admin.ts"), "utf8");

  it("resolves the caller from the session, never from an argument", () => {
    // requirePlatformAdmin must take no parameters — an email passed in by a
    // caller could be anything.
    expect(admin).toMatch(/requirePlatformAdmin\(\s*\)/);
    expect(admin).toContain("supabase.auth.getUser()");
  });

  it("fails closed when no allowlist is configured", () => {
    expect(admin).toContain('return { ok: false, reason: "unconfigured" }');
  });

  it("compares the allowlist case-insensitively", () => {
    expect(admin).toContain("toLowerCase()");
  });

  it("the admin page refuses before it constructs a privileged client", () => {
    const page = readFileSync(join(ROOT, "app/admin/page.tsx"), "utf8");
    const gateAt = page.indexOf("requirePlatformAdmin");
    const clientAt = page.indexOf("adminClient()");
    expect(gateAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(gateAt);
    expect(page).toMatch(/if \(!gate\.ok\)/);
  });
});
