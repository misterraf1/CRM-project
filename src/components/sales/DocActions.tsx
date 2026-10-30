"use client";

import { PAYMENT_METHODS, type DocDto, type DocShareResponse, type Permission } from "@/shared";
import { BadgePercent, BellRing, Check, Copy, Link2, Mail, PackagePlus, Pencil, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { formatDate, formatMoneyExact, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { useHydrated } from "@/lib/use-hydrated";

const today = () => new Date().toISOString().slice(0, 10);

/** Everything that can be done with a document in its current state; the API checks each step again. */
export function DocActions({ doc, permissions, contactEmail }: { doc: DocDto; permissions: Permission[]; contactEmail: string | null }) {
  const { t, locale } = useI18n();
  const k = t.sales;
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const money = (n: number) => formatMoneyExact(n, locale, doc.currency);

  const quote = doc.kind === "quote";
  const canWrite = permissions.includes(quote ? "quotes.manage" : "invoices.manage");
  const canInvoice = permissions.includes("invoices.manage");
  const editable = canWrite && (doc.status === "draft" || (quote && doc.status === "sent"));
  const sendable = canWrite && (quote ? doc.status === "draft" || doc.status === "sent" : doc.status !== "void");
  const due = doc.total - doc.paidAmount;
  const canApprove = permissions.includes("discounts.approve");
  // Over the limit and not approved: the writer asks first (approvers may send directly)
  const blocked = quote && doc.needsApproval && doc.approval?.status !== "approved" && !canApprove;
  const approvalOpen = quote && doc.needsApproval && (doc.status === "draft" || doc.status === "sent");

  function run<T>(call: () => Promise<ClientResult<T>>, ok?: (data: T) => void) {
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = await call();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      ok?.(res.data);
      router.refresh();
    });
  }

  function send(email: boolean, to?: string) {
    run(
      () => api<DocShareResponse>(`/docs/${doc.id}/send`, "POST", { email, ...(to ? { to } : {}) }),
      (r) => {
        setLink(`${window.location.origin}${r.publicPath}`);
        setCopied(false);
        setSending(false);
        setNotice(
          !email
            ? k.linkReady
            : r.emailDelivery === "queued"
              ? k.emailQueued
              : r.emailDelivery === "no_email"
                ? k.noEmail
                : k.emailNotConfigured,
        );
      },
    );
  }

  function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount")));
    if (!amount) return setError(t.errors.VALIDATION_FAILED);
    const form = e.currentTarget;
    run(
      () => api<DocDto>(`/docs/${doc.id}/payments`, "POST", { amount, method: f.get("method"), paidOn: f.get("paidOn"), reference: f.get("reference") ?? "" }),
      () => {
        form.reset();
        setNotice(k.paymentSaved);
      },
    );
  }

  const btn = "btn-ghost h-8 border border-border text-xs";
  return (
    <div className="space-y-4 print:hidden" aria-busy={pending}>
      <div className="flex flex-wrap gap-2">
        {sendable && !blocked && (
          <>
            <button type="button" disabled={pending || !hydrated} onClick={() => setSending((v) => !v)} className="btn-primary h-8 text-xs">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {doc.status === "draft" ? (quote ? k.send : k.issueAndSend) : k.resend}
            </button>
            <button type="button" disabled={pending || !hydrated} onClick={() => send(false)} className={btn}>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {doc.status === "draft" && !quote ? k.issueLink : k.makeLink}
            </button>
          </>
        )}
        {editable && (
          <Link href={`/sales/${doc.id}?edit=1`} className={btn}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {k.edit}
          </Link>
        )}
        <button type="button" onClick={() => window.print()} className={btn}>
          <Printer className="h-3.5 w-3.5" aria-hidden />
          {k.printPdf}
        </button>
        {quote && doc.status === "sent" && canWrite && (
          <>
            <button type="button" disabled={pending} onClick={() => window.confirm(k.confirmMarkAccepted) && run(() => api(`/docs/${doc.id}/respond`, "POST", { decision: "accept" }))} className={btn}>
              {k.markAccepted}
            </button>
            <button type="button" disabled={pending} onClick={() => window.confirm(k.confirmMarkRejected) && run(() => api(`/docs/${doc.id}/respond`, "POST", { decision: "reject" }))} className={btn}>
              {k.markRejected}
            </button>
          </>
        )}
        {quote && permissions.includes("orders.manage") && (doc.status === "sent" || doc.status === "accepted") && (
          <Link href={`/orders/new?quoteId=${doc.id}`} className={btn}>
            <PackagePlus className="h-3.5 w-3.5" aria-hidden />
            {k.toOrder}
          </Link>
        )}
        {!quote && doc.status === "issued" && canWrite && (
          <button type="button" disabled={pending || !hydrated} onClick={() => run(() => api<DocShareResponse>(`/docs/${doc.id}/remind`, "POST", {}), (r) => setNotice(r.emailDelivery === "queued" ? k.reminderSent : r.emailDelivery === "no_email" ? k.noEmail : k.emailNotConfigured))} className={btn}>
            <BellRing className="h-3.5 w-3.5" aria-hidden />
            {k.remind}
          </button>
        )}
        {quote && canInvoice && (doc.status === "sent" || doc.status === "accepted") && (
          <button type="button" disabled={pending} onClick={() => run(() => api<DocDto>(`/docs/${doc.id}/invoice`, "POST"), (inv) => router.push(`/sales/${inv.id}`))} className={btn}>
            {k.toInvoice}
          </button>
        )}
        {!quote && doc.status === "issued" && doc.paidAmount === 0 && canWrite && (
          <button type="button" disabled={pending} onClick={() => window.confirm(k.confirmVoid) && run(() => api(`/docs/${doc.id}/void`, "POST"))} className="btn-danger h-8 text-xs">
            {k.void}
          </button>
        )}
        {doc.status === "draft" && canWrite && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm(k.confirmDelete) && run(() => api(`/docs/${doc.id}`, "DELETE"), () => router.push(`/sales?kind=${doc.kind}`))}
            className="btn-danger h-8 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {k.delete}
          </button>
        )}
      </div>

      {approvalOpen && (
        <section className="card border-warning/40 p-4" aria-labelledby="approval-title">
          <h2 id="approval-title" className="flex items-center gap-2 text-sm font-semibold">
            <BadgePercent className="h-4 w-4 text-warning" aria-hidden />
            {k.needsApproval}
          </h2>
          {doc.approval && (
            <p className="mt-1 text-sm text-fg-muted">
              {interpolate(doc.approval.status === "pending" ? k.approvalPending : doc.approval.status === "approved" ? k.approvalApproved : k.approvalRejected, {
                name: (doc.approval.status === "pending" ? doc.approval.requestedBy : doc.approval.decidedBy) ?? "",
              })}
              {doc.approval.note && ` — «${doc.approval.note}»`}
            </p>
          )}
          {doc.approval?.status === "pending" && canApprove ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => api(`/docs/${doc.id}/approval`, "POST", { action: "approve" }))} className="btn-primary h-8 text-xs">
                {k.approve}
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => api(`/docs/${doc.id}/approval`, "POST", { action: "reject" }))} className="btn-ghost h-8 border border-border text-xs">
                {k.rejectApproval}
              </button>
            </div>
          ) : (
            blocked &&
            doc.approval?.status !== "pending" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const note = String(new FormData(e.currentTarget).get("note") ?? "");
                  run(() => api(`/docs/${doc.id}/approval`, "POST", { action: "request", note }));
                }}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <label className="field-label min-w-[14rem] flex-1">
                  {k.approvalNote}
                  <input name="note" maxLength={500} className="input" />
                </label>
                <button type="submit" disabled={pending || !hydrated} className="btn-primary">
                  {k.requestApproval}
                </button>
              </form>
            )
          )}
        </section>
      )}

      {sending && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(true, String(new FormData(e.currentTarget).get("to") || "") || undefined);
          }}
          className="card flex flex-wrap items-end gap-2 p-4"
        >
          <label className="field-label min-w-[14rem] flex-1">
            {k.sendTo}
            <input name="to" type="email" required defaultValue={contactEmail ?? ""} className="input" />
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {k.sendNow}
          </button>
          <p className="w-full text-xs text-fg-subtle">{doc.shared ? k.newLinkWarning : k.sendHint}</p>
        </form>
      )}

      {notice && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {link && (
        <div className="card flex gap-2 p-3">
          <input readOnly value={link} aria-label={k.customerLink} onFocus={(e) => e.currentTarget.select()} className="input mt-0 h-8 min-w-0 flex-1 font-mono text-xs" />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                /* clipboard blocked: the field is selectable */
              }
            }}
            className={btn}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? k.copied : k.copy}
          </button>
        </div>
      )}

      {!quote && doc.status !== "draft" && doc.status !== "void" && (
        <section className="card p-4" aria-labelledby="payments-title">
          <h2 id="payments-title" className="text-sm font-semibold">
            {k.payments}
          </h2>
          {doc.payments.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{k.noPayments}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {doc.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="tabular font-medium">{money(p.amount)}</span>
                    <span className="ml-2 text-xs text-fg-muted">
                      {k.methods[p.method]} · {formatDate(p.paidOn, locale, "long")}
                      {p.reference && ` · ${p.reference}`}
                      {p.recordedBy && ` · ${p.recordedBy}`}
                    </span>
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => window.confirm(k.confirmRemovePayment) && run(() => api(`/docs/${doc.id}/payments/${p.id}`, "DELETE"))}
                      className="text-xs font-medium text-danger hover:underline"
                    >
                      {k.removePayment}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && doc.status === "issued" && (
            <form onSubmit={pay} className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
              <label className="field-label">
                {k.amount}
                <input name="amount" inputMode="decimal" required defaultValue={moneyInputValue(due)} className="input" />
              </label>
              <label className="field-label">
                {k.method}
                <select name="method" defaultValue="transfer" className="input">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {k.methods[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {k.paidOn}
                <input name="paidOn" type="date" required defaultValue={today()} className="input" />
              </label>
              <label className="field-label">
                {k.reference}
                <input name="reference" maxLength={120} className="input" />
              </label>
              <button type="submit" disabled={pending || !hydrated} className="btn-primary">
                {k.recordPayment}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
