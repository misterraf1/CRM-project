import type { Metadata } from "next";
import Link from "next/link";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { safeNext } from "@/lib/auth/cookies";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Login" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const { t } = await getI18n();
  const a = t.auth;
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{a.loginTitle}</h1>
      <p className="mt-1 text-sm text-fg-muted">{a.loginSubtitle}</p>
      {params.reset && (
        <p role="status" className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          {a.resetDone}
        </p>
      )}
      <form action="/auth/login" method="post" className="mt-6 space-y-4">
        <FormError message={errorMessage(t, params.error)} />
        <input type="hidden" name="next" value={safeNext(params.next)} />
        <Field label={a.email} name="email" type="email" autoComplete="email" required defaultValue={params.email} autoFocus />
        <Field label={a.password} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton>{a.login}</SubmitButton>
      </form>
      <p className="mt-3 text-right text-sm">
        <Link href="/forgot-password" className="text-fg-muted hover:text-fg">
          {a.forgotLink}
        </Link>
      </p>
      <p className="mt-6 text-center text-sm text-fg-muted">
        {a.noAccount}{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          {a.signup}
        </Link>
      </p>
      {process.env.NODE_ENV !== "production" && (
        <details className="card mt-8 p-3 text-xs text-fg-muted">
          <summary className="cursor-pointer font-medium">{a.demoAccounts}</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {["owner", "admin", "manager", "employee"].map((r) => (
              <li key={r}>{r}@demo.axis</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
