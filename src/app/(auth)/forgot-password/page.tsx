import type { Metadata } from "next";
import Link from "next/link";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Password" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const { t } = await getI18n();
  const a = t.auth;
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{a.forgotTitle}</h1>
      <p className="mt-1 text-sm text-fg-muted">{a.forgotSubtitle}</p>
      {params.sent ? (
        <p role="status" className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          {a.forgotSent}
        </p>
      ) : (
        <form action="/auth/forgot" method="post" className="mt-6 space-y-4">
          <FormError message={errorMessage(t, params.error)} />
          <Field label={a.email} name="email" type="email" autoComplete="email" required autoFocus />
          <SubmitButton>{a.forgotSubmit}</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-accent hover:underline">
          {a.backToLogin}
        </Link>
      </p>
    </>
  );
}
