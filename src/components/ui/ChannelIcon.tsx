import clsx from "clsx";
import { Facebook, Globe, Instagram, Mail, MessageCircle } from "lucide-react";
import type { ChannelType } from "@/shared";

const MAP = {
  WHATSAPP: { icon: MessageCircle, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  INSTAGRAM: { icon: Instagram, className: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300" },
  MESSENGER: { icon: Facebook, className: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  WEBCHAT: { icon: Globe, className: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  EMAIL: { icon: Mail, className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
} satisfies Record<ChannelType, unknown>;

export function ChannelIcon({ channel, label, size = "md" }: { channel: ChannelType; label: string; size?: "sm" | "md" }) {
  const { icon: Icon, className } = MAP[channel];
  return (
    <span title={label} className={clsx("inline-grid shrink-0 place-items-center rounded-full", size === "sm" ? "h-5 w-5" : "h-8 w-8", className)}>
      <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
