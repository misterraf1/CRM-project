import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordForm } from "@/components/objects/RecordForm";
import { getObjects, getRecord, getSession } from "@/lib/api";
import { getAppI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Record" };

export default async function RecordPage({ params }: { params: Promise<{ objectId: string; id: string }> }) {
  const { objectId, id } = await params;
  const [{ t }, me, objects, record] = await Promise.all([getAppI18n(), getSession(), getObjects(), getRecord(id)]);
  const object = objects.find((o) => o.id === objectId);
  if (!object || record.objectId !== objectId) notFound();
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/records/${objectId}`} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {object.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{record.title}</h1>
        {record.owner && (
          <p className="mt-0.5 text-sm text-fg-muted">
            {t.objects.owner}: {record.owner.name}
          </p>
        )}
      </div>
      <RecordForm object={object} record={record} canDelete={me.permissions.includes("contacts.delete")} />
    </div>
  );
}
