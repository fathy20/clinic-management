"use client";

import { Button } from "@/components/ui/Button";

// The only interactive thing on the receipt. A client component purely because
// window.print() needs one — the document itself is server-rendered so it
// prints identically whether or not JavaScript ran.
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="quiet" small onClick={() => window.print()}>
      {label}
    </Button>
  );
}
