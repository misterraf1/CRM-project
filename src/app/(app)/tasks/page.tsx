import { TASK_VIEWS } from "@/shared";
import clsx from "clsx";
import { LayoutList, Search, SquareKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskQuickAdd } from "@/components/tasks/TaskQuickAdd";
import { getMembers, getProjects, getSession, getTasks } from "@/lib/api";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Tasks" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function TasksPage({ searchParams }: Props) {
  const params = await searchParams;
  const view = (TASK_VIEWS as readonly string[]).includes(params.view ?? "") ? params.view! : "mine";
  const layout = params.layout === "board" ? "board" : "list";
  // The board shows a "done" column, so it always includes recently finished tasks
  const includeDone = layout === "board" || params.done === "1";
  const [{ t }, me, members, projects, tasks] = await Promise.all([
    getI18n(),
    getSession(),
    getMembers(),
    getProjects(),
    getTasks({ view, q: params.q, projectId: params.projectId, includeDone: String(includeDone) }),
  ]);
  const k = t.tasks;
  const href = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(
      Object.entries({ view, layout, q: params.q, projectId: params.projectId, done: params.done, ...patch }).filter(
        (e): e is [string, string] => !!e[1],
      ),
    );
    return `/tasks?${qs}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{k.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
      </div>

      {me.permissions.includes("tasks.create") && <TaskQuickAdd members={members} selfMemberId={me.membership.id} />}

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap rounded-lg bg-muted p-0.5" aria-label={k.title}>
          {TASK_VIEWS.map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={view === v ? "true" : undefined}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", view === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {k.views[v]}
            </Link>
          ))}
        </nav>
        <form action="/tasks" className="flex min-w-[220px] flex-1 flex-wrap gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="layout" value={layout} />
          <label className="relative min-w-[160px] flex-1">
            <span className="sr-only">{k.search}</span>
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-subtle" aria-hidden />
            <input name="q" defaultValue={params.q} placeholder={k.search} className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent" />
          </label>
          {projects.length > 0 && (
            <select name="projectId" defaultValue={params.projectId ?? ""} aria-label={k.project} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs">
              <option value="">{k.allProjects}</option>
              {projects
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
          <button type="submit" aria-label={k.search} title={k.search} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted">
            <Search className="h-3.5 w-3.5" aria-hidden />
          </button>
        </form>
        {layout === "list" && (
          <Link href={href({ done: params.done === "1" ? undefined : "1" })} className="text-xs font-medium text-accent hover:underline">
            {k.showDone}
          </Link>
        )}
        <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={`${k.list} / ${k.board}`}>
          {(["list", "board"] as const).map((l) => {
            const Icon = l === "list" ? LayoutList : SquareKanban;
            return (
              <Link
                key={l}
                href={href({ layout: l })}
                aria-current={layout === l ? "true" : undefined}
                title={l === "list" ? k.list : k.board}
                className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", layout === l ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {l === "list" ? k.list : k.board}
              </Link>
            );
          })}
        </div>
      </div>

      {layout === "board" ? <TaskBoard tasks={tasks} /> : <TaskList tasks={tasks} />}
    </div>
  );
}
