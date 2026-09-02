export function Chip({
  tone,
  children,
}: {
  tone: "owes" | "pkg" | "risk" | "new";
  children: React.ReactNode;
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
