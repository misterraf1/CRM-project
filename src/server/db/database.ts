import { MongoClient, type ClientSession } from "mongodb";
import { currentContext } from "../common/context";
import type { ModelName } from "./models";
import { Repo, type DbScope } from "./repo";

const MODELS = [
  "User",
  "AdminSession",
  "Session",
  "Tenant",
  "Plan",
  "Subscription",
  "Invoice",
  "Payment",
  "UsageCounter",
  "Counter",
  "PlatformExpense",
  "Membership",
  "Department",
  "Contact",
  "Pipeline",
  "PipelineStage",
  "Deal",
  "Activity",
  "Project",
  "Task",
  "TaskComment",
  "Channel",
  "Conversation",
  "Message",
  "CannedResponse",
  "WebhookEvent",
  "ChatRoom",
  "ChatMember",
  "ChatMessage",
  "FileObject",
  "Notification",
  "AuditLog",
  "SupportTicket",
  "SupportTicketMessage",
  "AutomationRule",
  "AutomationEvent",
  "AutomationRun",
  "PasswordReset",
  "EmailMessage",
] as const satisfies readonly ModelName[];

type Key<M extends string> = Uncapitalize<M>;

/** Every collection as a scoped Repo: `tx.contact.find(…)`, `tx.task.update(…)`. */
export type Tx = { [M in (typeof MODELS)[number] as Key<M>]: Repo<M> } & { session?: ClientSession };

const key = <M extends string>(m: M) => (m[0]!.toLowerCase() + m.slice(1)) as Key<M>;

/**
 * MongoDB access for the backend (official driver). Collections are named after the
 * models (`User`, `Contact`, …) with string ids in `_id`.
 */
export class Database {
  private conn: MongoClient;
  private closed = false;

  constructor(private readonly url: string) {
    this.conn = this.connect();
  }

  /**
   * A failed initial connect closes the driver's topology for good, and this instance
   * lives on globalThis — so without a fresh client one network blip would fail every
   * request until the server (or serverless instance) is recycled.
   */
  private connect(): MongoClient {
    const client = new MongoClient(this.url);
    client.once("topologyClosed", () => {
      if (!this.closed && this.conn === client) this.conn = this.connect();
    });
    return client;
  }

  get client(): MongoClient {
    return this.conn;
  }

  private tx(scope: DbScope, session?: ClientSession): Tx {
    const db = this.client.db();
    // A session runs one operation at a time; queue them so services can use Promise.all
    let queue: Promise<unknown> = Promise.resolve();
    const run = session
      ? <R>(op: () => Promise<R>) => {
          const next = queue.then(op, op);
          queue = next.catch(() => undefined);
          return next;
        }
      : <R>(op: () => Promise<R>) => op();
    let memberTenants: Promise<string[]> | undefined;
    const membershipTenants = () =>
      (memberTenants ??= run(() =>
        db
          .collection("Membership")
          .find({ userId: scope.userId }, { session, projection: { tenantId: 1 } })
          .toArray()
          .then((rows) => rows.map((r) => r.tenantId as string)),
      ));
    const tx = { session } as Record<string, unknown>;
    for (const m of MODELS) tx[key(m)] = new Repo(m, db.collection(m), scope, session, run, membershipTenants);
    return tx as Tx;
  }

  /**
   * Runs `fn` in a transaction scoped to a tenant/user. Defaults to the current
   * request's identity; pass `scope` explicitly only for flows that establish
   * identity themselves (signup, login, invite acceptance, background jobs).
   * Write conflicts with concurrent transactions are retried by the driver.
   */
  scoped<T>(fn: (tx: Tx) => Promise<T>, scope: Pick<DbScope, "tenantId" | "userId"> = currentContext()): Promise<T> {
    return this.transaction({ tenantId: scope.tenantId || undefined, userId: scope.userId || undefined }, fn);
  }

  /** Cross-tenant platform writes that must commit together. */
  systemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction({ system: true }, fn);
  }

  private async transaction<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(this.tx(scope, session));
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Cross-tenant platform operations (provider webhooks, background jobs, slug
   * availability). Bypasses tenant isolation — keep these narrow and id-only.
   */
  get system(): Tx {
    return this.tx({ system: true });
  }

  /** Outside a transaction, as the current request's tenant/user. */
  get current(): Tx {
    const { tenantId, userId } = currentContext();
    return this.tx({ tenantId, userId });
  }

  async ping() {
    await this.client.db().command({ ping: 1 });
  }

  close() {
    this.closed = true;
    return this.conn.close();
  }
}
