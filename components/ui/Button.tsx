"use client";

type Variant = "primary" | "quiet" | "money" | "danger";

// `money` and `danger` are deliberately NOT styled like the rest — a
// receptionist must not be able to take a payment or cancel a session by
// muscle memory. See DESIGN.md §5.
export function Button({
  variant = "quiet",
  small = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
}) {
  return (
    <button
      {...props}
      className={`btn btn-${variant}${small ? " btn-sm" : ""}${
        className ? " " + className : ""
      }`}
    />
  );
}
