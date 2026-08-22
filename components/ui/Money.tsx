import { currencyLabel, formatMoney } from "@/lib/money";

// The ONLY component allowed to emit --money. If a monetary value renders
// anywhere without going through here, the gold-means-money rule has a hole
// in it — see DESIGN.md §1.
export function Money({
  amount,
  currency = "EGP",
  size = "md",
  withLabel = false,
}: {
  amount: number;
  currency?: string;
  size?: "md" | "lg";
  withLabel?: boolean;
}) {
  return (
    <span className={size === "lg" ? "money money-lg" : "money"}>
      {formatMoney(amount, currency)}
      {withLabel && (
        <span style={{ fontSize: "0.72em", marginInlineStart: 4 }}>
          {currencyLabel(currency)}
        </span>
      )}
    </span>
  );
}
