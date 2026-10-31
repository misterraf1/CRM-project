import type { Metadata } from "next";
import { TargetsBoard } from "@/components/targets/TargetsBoard";
import { getTargets } from "@/lib/api";
import { formatMonth } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Targets" };

type Props = { searchParams: Promise<{ period?: string; start?: string }> };

export default async function TargetsPage({ searchParams }: Props) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const period = sp.period === "quarter" ? "quarter" : "month";
  const start = sp.start && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.start) ? sp.start : undefined;
  const data = await getTargets(period, start);
  const first = `${data.start}-01T00:00:00Z`;
  const label =
    period === "quarter"
      ? `Q${Math.floor((Number(data.start.slice(5)) - 1) / 3) + 1} ${data.start.slice(0, 4)}`
      : formatMonth(first, locale);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t.targets.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{t.targets.subtitle}</p>
      </div>
      <TargetsBoard data={data} label={label} />
    </div>
  );
}
