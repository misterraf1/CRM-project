import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { UnsubscribeButton } from "@/components/growth/UnsubscribeButton";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default async function UnsubscribePage({ params }: Props) {
  const [{ token }, { t }] = await Promise.all([params, getI18n()]);
  return (
    <AuthFrame>
      <h1 className="text-xl font-semibold tracking-tight">{t.unsubscribe.title}</h1>
      <p className="mb-5 mt-1 text-sm text-fg-muted">{t.unsubscribe.body}</p>
      <UnsubscribeButton token={token} />
    </AuthFrame>
  );
}
