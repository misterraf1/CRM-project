import type { PublicFormDto } from "@/shared";
import type { Metadata } from "next";
import { PublicForm } from "@/components/growth/PublicForm";
import { apiPublic } from "@/lib/api/server";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Form", robots: { index: false } };

type Props = { params: Promise<{ key: string }> };

/** Hosted website form: a link to share or an iframe on the company's site. */
export default async function FormPage({ params }: Props) {
  const { key } = await params;
  const [{ t }, res] = await Promise.all([getI18n(), apiPublic<PublicFormDto>(`/v1/public/forms/${encodeURIComponent(key)}`)]);
  return (
    <main className="min-h-screen bg-bg px-4 py-6">
      <div className="mx-auto max-w-md">
        {res.ok ? (
          <div className="card p-5">
            <p className="text-xs text-fg-muted">{res.data.companyName}</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">{res.data.title}</h1>
            <div className="mt-4">
              <PublicForm formKey={key} form={res.data} />
            </div>
          </div>
        ) : (
          <p className="card p-5 text-sm text-fg-muted">{t.forms.notFound}</p>
        )}
      </div>
    </main>
  );
}
