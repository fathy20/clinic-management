import { describe, expect, it } from "vitest";
import { currencyLabel, formatMoney } from "@/lib/money";

describe("money formatting", () => {
  it("always shows two decimals so a column aligns on the point", () => {
    expect(formatMoney(300)).toBe("300.00");
    expect(formatMoney(300.5)).toBe("300.50");
    expect(formatMoney(0)).toBe("0.00");
  });

  it("groups thousands", () => {
    expect(formatMoney(4850)).toBe("4,850.00");
    expect(formatMoney(1234567.89)).toBe("1,234,567.89");
  });

  // Egyptian clinic and accounting practice uses Western digits, and mixing
  // digit systems across a financial screen is genuinely unreadable.
  it("uses Western digits, never Arabic-Indic", () => {
    const out = formatMoney(1234.56);
    expect(out).toBe("1,234.56");
    expect(out).not.toMatch(/[٠-٩۰-۹]/);
  });

  it("formats identically regardless of currency — the label carries it", () => {
    expect(formatMoney(500, "GBP")).toBe(formatMoney(500, "EGP"));
    expect(currencyLabel("EGP")).toBe("ج.م");
    expect(currencyLabel("GBP")).toBe("£");
    expect(currencyLabel("AED")).toBe("د.إ");
  });

  it("falls back to the ISO code for a currency it has no label for", () => {
    expect(currencyLabel("JPY")).toBe("JPY");
  });

  it("defaults to EGP when a clinic has no currency set yet", () => {
    expect(currencyLabel()).toBe("ج.م");
  });
});
