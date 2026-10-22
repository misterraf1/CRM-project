import type { Metadata } from "next";
import Link from "next/link";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Signup" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function SignupPage({ searchParams }: Props) {
  const params = await searchParams;
  const { t } = await getI18n();
  const a = t.auth;
  const invalid = new Set((params.fields ?? "").split(","));
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{a.signupTitle}</h1>
      <p className="mt-1 text-sm text-fg-muted">{a.signupSubtitle}</p>
      <form action="/auth/signup" method="post" className="mt-6 space-y-4">
        <FormError message={errorMessage(t, params.error)} />
        <Field label={a.companyName} name="companyName" required minLength={2} maxLength={100} defaultValue={params.companyName} invalid={invalid.has("companyName")} autoFocus />
        <Field label={a.fullName} name="fullName" autoComplete="name" required minLength={2} maxLength={100} defaultValue={params.fullName} invalid={invalid.has("fullName")} />
        <Field label={a.email} name="email" type="email" autoComplete="email" required defaultValue={params.email} invalid={invalid.has("email") || params.error === "EMAIL_TAKEN"} />
        <Field label={a.password} name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} hint={a.passwordHint} invalid={invalid.has("password")} />
        <SubmitButton>{a.signup}</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-fg-muted">
        {a.haveAccount}{" "}
        <Link href={params.error === "EMAIL_TAKEN" && params.email ? `/login?email=${encodeURIComponent(params.email)}` : "/login"} className="font-medium text-accent hover:underline">
          {a.login}
        </Link>
      </p>
    </>
  );
}
