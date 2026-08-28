"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { issueReceipt } from "@/app/receipts/actions";

// One payment, one receipt. The number is allocated in Postgres and the row is
// keyed by payment_id, so a double click returns the document that already
// exists instead of issuing a second one — which is why this does not need to
// guard against being pressed twice, only to stay disabled while in flight.
export function ReceiptButton({
  paymentId,
  label,
}: {
  paymentId: string;
  label: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        small
        variant="quiet"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const receipt = await issueReceipt(paymentId);
              // A new tab: the receipt is a document to print, and the
              // receptionist is mid-conversation on the page behind it.
              window.open(`/receipts/${receipt.id}`, "_blank", "noopener");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong");
            }
          });
        }}
      >
        {label}
      </Button>
      {error && (
        <p className="formerror" style={{ flexBasis: "100%", margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </>
  );
}
