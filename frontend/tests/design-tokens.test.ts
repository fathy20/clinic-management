import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(import.meta.dirname, "..", "app", "globals.css"),
  "utf8"
);

function block(startMarker: string, endMarker: string) {
  const s = css.indexOf(startMarker);
  const e = css.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error(`block not found: ${startMarker}`);
  return css.slice(s, e);
}

function tokensIn(text: string) {
  return new Set(
    Array.from(text.matchAll(/(--[a-z0-9-]+)\s*:/g)).map((m) => m[1])
  );
}

const bareRoot = block(":root {", "@media (prefers-color-scheme: dark)");
const mediaDark = block(
  "@media (prefers-color-scheme: dark)",
  ':root[data-theme="dark"]'
);
const stampedDark = block(':root[data-theme="dark"]', "body {");

describe("theme tokens are structured so all three viewer states resolve", () => {
  it("defines the complete light palette on bare :root", () => {
    const light = tokensIn(bareRoot);
    for (const t of [
      "--ground",
      "--raised",
      "--ink",
      "--muted",
      "--line",
      "--jade",
      "--money",
      "--brick",
      "--on-fill",
    ]) {
      expect(light, `${t} missing from bare :root`).toContain(t);
    }
  });

  // This is the bug that renders one theme's text on the other theme's
  // ground for every viewer on the default "system" setting — the majority.
  it("defines no colour ONLY inside a dark block", () => {
    const light = tokensIn(bareRoot);
    const darkOnly = [...tokensIn(mediaDark)].filter((t) => !light.has(t));
    expect(darkOnly).toEqual([]);
  });

  it("keeps the two dark blocks identical, so the toggle wins both ways", () => {
    expect([...tokensIn(mediaDark)].sort()).toEqual(
      [...tokensIn(stampedDark)].sort()
    );
  });

  it("guards the media query so an explicit light choice beats a dark OS", () => {
    expect(mediaDark).toContain(':root:not([data-theme="light"])');
  });

  it("paints body from a token — a transparent body borrows the host ground", () => {
    expect(css).toMatch(/body\s*{[^}]*background:\s*var\(--ground\)/);
  });
});

describe("component CSS never hardcodes a colour", () => {
  it("uses only var() below the token blocks", () => {
    const components = css.slice(css.indexOf("body {"));
    const rawHex = components.match(/#[0-9A-Fa-f]{3,8}/g) ?? [];
    expect(rawHex).toEqual([]);
  });
});

// Contrast floors. DESIGN.md documents money-on-ground as the tightest pair in
// the system at 4.56 — if a future tweak lightens --money, the most important
// colour in the product stops being readable. This fails loudly instead.
function luminance(hex: string) {
  const h = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function tokenValue(text: string, name: string) {
  const m = text.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not found`);
  return m[1];
}

describe("contrast floors hold in both themes", () => {
  for (const [label, source] of [
    ["light", bareRoot],
    ["dark", stampedDark],
  ] as const) {
    it(`${label}: money, ink and muted all clear 4.5:1 on both surfaces`, () => {
      const ground = tokenValue(source, "--ground");
      const raised = tokenValue(source, "--raised");
      for (const name of ["--money", "--ink", "--muted", "--jade", "--brick"]) {
        const value = tokenValue(source, name);
        expect(
          contrast(value, ground),
          `${name} on --ground in ${label}`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(value, raised),
          `${name} on --raised in ${label}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    // The two themes separate a card from the ground by different means:
    // light leans on the border (line->raised 1.27, surface lift only 1.07),
    // dark leans on the surface lift (1.19). Either mechanism is fine; having
    // neither is not, so the floor is on whichever is doing the work.
    it(`${label}: a card is separable from the ground by surface or border`, () => {
      const ground = tokenValue(source, "--ground");
      const raised = tokenValue(source, "--raised");
      const line = tokenValue(source, "--line");
      const strongest = Math.max(
        contrast(ground, raised),
        contrast(line, ground)
      );
      expect(strongest).toBeGreaterThanOrEqual(1.15);
      expect(ground).not.toBe(raised);
    });
  }
});
