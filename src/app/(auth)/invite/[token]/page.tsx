import type { InvitePreview } from "@/shared";
import { Link2Off } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Field, FormError, SubmitButton } from "@/components/auth/Field";
import { apiPublic } from "@/lib/api/server";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Invite" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> };

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error } = await searchParams;
  const { t } = await getI18n();
  const a = t.auth;
  const preview = await apiPublic<InvitePreview>(`/v1/invites/${encodeURIComponent(token)}`);

  if (!preview.ok) {
    return (
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger/10 text-danger">
          <Link2Off className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold">{a.inviteInvalidTitle}</h1>
        <p className="mt-2 text-sm text-fg-muted">{a.inviteInvalidBody}</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
          {a.login}
        </Link>
      </div>
    );
  }

  const invite = preview.data;
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{interpolate(a.inviteTitle, { company: invite.tenantName })}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {interpolate(a.inviteSubtitle, { email: invite.email, role: invite.customRole ?? t.shell.roles[invite.role] })}
      </p>
      <form action={`/auth/invite/${encodeURIComponent(token)}`} method="post" className="mt-6 space-y-4">
        <FormError message={errorMessage(t, error)} />
        {invite.needsAccount ? (
          <>
            <Field label={a.fullName} name="fullName" autoComplete="name" required minLength={2} defaultValue={invite.fullName} />
            <Field label={a.password} name="password" type="password" autoComplete="new-password" required minLength={8} hint={a.passwordHint} />
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">{a.inviteExisting}</p>
            <Field label={a.password} name="password" type="password" autoComplete="current-password" required />
          </>
        )}
        <SubmitButton>{a.inviteAccept}</SubmitButton>
      </form>
    </>
  );
}
