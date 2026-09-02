// Stands in for the `server-only` package under Vitest. The real package
// exists to make a Next.js build fail if a server module is imported from a
// client component; that check happens at build time and is verified by
// tests/secret-containment.test.ts, not here.
export {};
