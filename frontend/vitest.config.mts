import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // `server-only` is a build-time guard: importing it from a client
      // component fails the Next build. Vitest has no such notion and cannot
      // resolve the package at all, so every test touching a server-only
      // module had to mock it by hand. Aliasing it to an empty module once
      // means the guard keeps working where it matters — the real build —
      // and the tests can import the modules it protects.
      // join, not new URL(...).pathname — this repository lives under a path
      // containing a space ("New Volume"), and pathname percent-encodes it,
      // which resolves to nothing.
      "server-only": join(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
