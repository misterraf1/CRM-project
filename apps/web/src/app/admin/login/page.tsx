import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { safeNext } from "@/lib/auth/cookies";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Platform", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdminLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const { t } = await getI18n();
  const k = t.admin;
  return (
    <AuthFrame badge={k.badge}>
      <h1 className="text-xl font-semibold tracking-tight">{k.loginTitle}</h1>
      <p className="mt-1 text-sm text-fg-muted">{k.loginSubtitle}</p>
      <form action="/admin/auth/login" method="post" className="mt-6 space-y-4">
        <FormError message={errorMessage(t, params.error)} />
        <input type="hidden" name="next" value={safeNext(params.next, "/admin")} />
        <Field label={t.auth.email} name="email" type="email" autoComplete="username" required defaultValue={params.email} autoFocus />
        <Field label={t.auth.password} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton>{t.auth.login}</SubmitButton>
      </form>
      {process.env.NODE_ENV !== "production" && (
        <details className="card mt-8 p-3 text-xs text-fg-muted">
          <summary className="cursor-pointer font-medium">{k.demoAccounts}</summary>
          <ul className="mt-2 space-y-1 font-mono">
            <li>platform@demo.axis</li>
            <li>support@demo.axis</li>
          </ul>
        </details>
      )}
    </AuthFrame>
  );
}
