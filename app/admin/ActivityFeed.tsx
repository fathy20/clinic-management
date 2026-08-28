import { Money } from "@/components/ui/Money";
import { t } from "@/lib/strings";
import type { ActivityItem } from "./activity";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <aside>
      <div className="panel">
        <div className="panelhead">
          <h3>{t("activity")}</h3>
          <p>{t("activitySubtitle")}</p>
        </div>

        {items.length === 0 ? (
          <p className="leak" style={{ color: "var(--muted)" }}>
            {t("noActivity")}
          </p>
        ) : (
          items.map((i) => (
            <div className="leak" key={i.id}>
              <div className="leak-body">
                <div className="leak-name">
                  {i.actor}{" "}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {i.description}
                  </span>
                </div>
                <div className="leak-when">
                  {i.clinic} · {WHEN.format(new Date(i.at))}
                </div>
              </div>
              {i.amount !== null && <Money amount={i.amount} />}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
