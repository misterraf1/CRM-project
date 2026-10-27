import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/crm/DeleteButton";
import { Comments } from "@/components/tasks/Comments";
import { Files } from "@/components/tasks/Files";
import { Subtasks } from "@/components/tasks/Subtasks";
import { TaskEditor } from "@/components/tasks/TaskEditor";
import { getMembers, getProjects, getSession, getTask } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/server";
import { formatDateTime } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Tasks" };

type Props = { params: Promise<{ id: string }> };

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  const task = await getTask(id).catch((e) => {
    if (e instanceof ApiRequestError && e.status === 404) notFound();
    throw e;
  });
  const [{ t, locale }, me, members, projects] = await Promise.all([getI18n(), getSession(), getMembers(), getProjects()]);
  const k = t.tasks;

  return (
    <div className="space-y-5">
      <Link href={task.parentId ? `/tasks/${task.parentId}` : "/tasks"} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {k.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-fg-muted">
            <span>{k.statuses[task.status]}</span>
            {task.dueAt && <span className={task.overdue ? "font-medium text-danger" : ""}>{formatDateTime(task.dueAt, locale)}{task.overdue ? ` · ${k.overdue}` : ""}</span>}
            {task.creator && <span>{interpolate(k.creator, { name: task.creator.name })}</span>}
            {task.contact && (
              <Link href={`/crm/${task.contact.id}`} className="text-accent hover:underline">
                {task.contact.name}
              </Link>
            )}
            {task.deal && (
              <Link href={`/deals/${task.deal.id}`} className="text-accent hover:underline">
                {task.deal.title}
              </Link>
            )}
          </p>
        </div>
        {task.can.delete && (
          <DeleteButton path={`/tasks/${task.id}`} confirmText={interpolate(k.confirmDelete, { title: task.title })} label={k.delete} redirectTo="/tasks" />
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className="card p-5">
            <TaskEditor task={task} members={members} projects={projects} />
          </section>
          {!task.parentId && <Subtasks parentId={task.id} items={task.subtaskItems} />}
        </div>
        <div className="min-w-0 space-y-5">
          <Files taskId={task.id} items={task.fileItems} canEdit={task.can.edit} selfMemberId={me.membership.id} />
          <Comments taskId={task.id} items={task.commentItems} />
        </div>
      </div>
    </div>
  );
}
