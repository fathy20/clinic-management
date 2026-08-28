// Currency lives on the clinic row, never hardcoded — the product is sold in
// Cairo, London and Dubai. Western digits always: Egyptian clinic and
// accounting practice uses them, and mixing digit systems across a financial
// screen is genuinely unreadable.
export function formatMoney(amount: number, currency = "EGP") {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Short symbol/label shown next to a total. Kept separate from the number so
// the number itself stays purely tabular and aligns in a column.
const LABELS: Record<string, string> = {
  EGP: "ج.م",
  GBP: "£",
  AED: "د.إ",
  USD: "$",
  SAR: "ر.س",
};

export function currencyLabel(currency = "EGP") {
  return LABELS[currency] ?? currency;
}
