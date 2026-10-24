import type { SubscriptionStatus } from "@axis/shared";
import clsx from "clsx";
import { SUBSCRIPTION_STATUS_STYLE } from "@/lib/billing";

export function StatusBadge({ status, label }: { status: SubscriptionStatus; label: string }) {
  return <span className={clsx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", SUBSCRIPTION_STATUS_STYLE[status])}>{label}</span>;
}
