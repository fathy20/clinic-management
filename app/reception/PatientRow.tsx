"use client";

import { useEffect, useRef } from "react";
import { Arc } from "@/components/ui/Arc";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatMoney } from "@/lib/money";
import type { DayRow } from "./types";
import { LOCALE, t } from "@/lib/strings";

const TIME_FMT = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

function timeLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME_FMT.format(d);
}

function waitLabel(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return "";
  if (mins < -1) return t("dueInMinutes", { n: Math.abs(mins) });
  if (mins <= 1) return t("onTime");
  return t("waitingMinutes", { n: mins });
}

export function PatientRow({
  row,
  band,
  selected = false,
  arriving = false,
  pendingStatus,
  canSeeMoney,
  onAttend,
  onMiss,
  onPay,
  onRefund,
}: {
  row: DayRow;
  band: "waiting" | "done";
  selected?: boolean;
  arriving?: boolean;
  pendingStatus?: "attended" | "no_show";
  canSeeMoney: boolean;
  onAttend?: () => void;
  onMiss?: () => void;
  onPay: () => void;
  onRefund: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  const status = pendingStatus ?? row.status;
  const missed = status === "no_show";

  const cls = [
    "row",
    band === "done" ? "state-done" : "",
    missed ? "state-missed" : "",
    selected ? "is-selected" : "",
    pendingStatus ? "row-leaving" : "",
    arriving ? "row-arriving" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls} ref={ref}>
      <div>
        <div className="rtime">{timeLabel(row.startsAt)}</div>
        {band === "waiting" && (
          <div className="rwait">{waitLabel(row.startsAt)}</div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="pname">{row.patientName}</div>
        <div className="pmeta">
          <span>{row.therapistName}</span>
          <span className="dot" />
          <span className="pphone" dir="ltr">
            {row.patientPhone}
          </span>

          {missed && (
            <>
              <span className="dot" />
              <span style={{ color: "var(--brick)", fontWeight: 600 }}>
                {t("didNotAttend")}
              </span>
            </>
          )}

          {row.packageTotal !== null && row.packageUsed !== null && (
            <Chip tone="pkg">
              <Arc
                value={row.packageUsed}
                max={row.packageTotal}
                size="sm"
                caption=""
              />
              <span className="num">
                {row.packageUsed}/{row.packageTotal}
              </span>
            </Chip>
          )}

          {canSeeMoney && row.amountOwed > 0 && (
            <Chip tone="owes">
              {t("owesAmount", { amount: formatMoney(row.amountOwed) })}
            </Chip>
          )}

          {row.noShowRate !== null && (
            <Chip tone="risk">
              {t("missesRate", { n: Math.round(row.noShowRate * 100) })}
            </Chip>
          )}
        </div>
      </div>

      <div className="acts">
        {band === "waiting" && !pendingStatus && (
          <>
            <Button variant="primary" onClick={onAttend}>
              {t("arrived")}
            </Button>
            <Button small onClick={onMiss}>
              {t("noShow")}
            </Button>
          </>
        )}
        {canSeeMoney && (
          <>
            <Button variant="money" small onClick={onPay}>
              {t("takePayment")}
            </Button>
            <Button small onClick={onRefund}>
              {t("refund")}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
