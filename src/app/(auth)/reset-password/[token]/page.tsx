import type { Metadata } from "next";
import Link from "next/link";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Password", robots: { index: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const [{ token }, sp, { t }] = await Promise.all([params, searchParams, getI18n()]);
  const a = t.auth;
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{a.resetTitle}</h1>
      <p className="mt-1 text-sm text-fg-muted">{a.resetSubtitle}</p>
      <form action="/auth/reset" method="post" className="mt-6 space-y-4">
        <FormError message={errorMessage(t, sp.error)} />
        <input type="hidden" name="token" value={token} />
        <Field label={a.password} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required hint={a.passwordHint} autoFocus />
        <SubmitButton>{a.resetSubmit}</SubmitButton>
      </form>
      {sp.error === "TOKEN_INVALID" && (
        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-accent hover:underline">
            {a.forgotSubmit}
          </Link>
        </p>
      )}
    </>
  );
}
