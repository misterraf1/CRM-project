import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordForm } from "@/components/objects/RecordForm";
import { getObjects } from "@/lib/api";
import { interpolate } from "@/lib/i18n/locales";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New record" };

export default async function NewRecordPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const [{ t }, objects] = await Promise.all([getAppI18n(), getObjects()]);
  const object = objects.find((o) => o.id === objectId);
  if (!object) notFound();
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/records/${objectId}`} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {object.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{interpolate(t.objects.newRecord, { name: object.singular })}</h1>
      </div>
      <RecordForm object={object} />
    </div>
  );
}
