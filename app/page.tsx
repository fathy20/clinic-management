import { redirect } from "next/navigation";
import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";

// The owner and the accountant land on the money screen; everyone else lands
// on the day. Per the positioning mandate: the money-leak report is the
// product's argument for its own subscription, so whoever pays for it should
// see it first, not a welcome page.
export default async function Home() {
  const result = await loadClinicContext();
  if (!result.ok) {
    redirect(result.reason === "unauthenticated" ? "/login" : "/reception");
  }
  redirect(canSeeMoney(result.ctx.role) ? "/finance" : "/reception");
}
