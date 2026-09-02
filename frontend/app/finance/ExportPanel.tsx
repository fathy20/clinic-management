"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/strings";
import { exportCsv, exportJson } from "./export";

export function ExportPanel({ clinicId }: { clinicId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download(kind: "csv" | "json") {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, body } = kind === "csv" ? await exportCsv() : await exportJson();
        // A BOM so Excel opens a UTF-8 CSV with Arabic names intact instead of
        // rendering them as mojibake — the single most common complaint about
        // exported Arabic data.
        const blob = new Blob([kind === "csv" ? "﻿" + body : body], {
          type: kind === "csv" ? "text/csv;charset=utf-8" : "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <aside>
      <div className="panel">
        <div className="panelhead">
          <h3>{t("exportHeading")}</h3>
          <p>{t("exportSubtitle")}</p>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="hint" style={{ margin: 0 }}>
            {t("exportWhat")}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button small disabled={pending} onClick={() => download("csv")}>
              {pending ? t("exporting") : t("exportCsv")}
            </Button>
            <Button small disabled={pending} onClick={() => download("json")}>
              {pending ? t("exporting") : t("exportJson")}
            </Button>
          </div>
          {error && <p className="formerror">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
