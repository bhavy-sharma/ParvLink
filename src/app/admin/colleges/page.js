import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireSuperAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { CreateCollegeForm } from "./college-forms";
import { call } from "@/lib/services";

export const metadata = { title: "Colleges" };

export default async function CollegesPage() {
  await requireSuperAdmin();

  const { data: colleges, error } = await call("admin_list_colleges");
  if (error) throw new Error("Colleges could not be loaded.");

  return (
    <div className="space-y-8">
      <PageHeader title="Colleges" description="Students can only join a college that is listed here and open." />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="college-list">
          <h2 id="college-list" className="sr-only">
            All colleges
          </h2>
          {colleges.length === 0 ? (
            <EmptyState title="No colleges yet">Add your first college with the form on this page. Until you do, students cannot create a profile.</EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
              {colleges.map((college) => (
                <li key={college.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {college.name}
                      {college.city ? <span className="font-normal text-ink-muted">, {college.city}</span> : null}
                    </p>
                    <p className="text-sm text-ink-muted">
                      <span className="break-all">{college.slug}</span>, added {formatDate(college.created_at)}
                    </p>
                  </div>
                  <Badge tone={college.is_active ? "ok" : "neutral"}>{college.is_active ? "Open" : "Closed"}</Badge>
                  <Link href={`${ROUTES.adminColleges}/${college.id}`} className="rounded-full px-2 py-1 text-sm font-semibold text-brand underline">
                    Edit<span className="sr-only"> {college.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Panel aria-labelledby="add-college">
          <h2 id="add-college" className="mb-4 text-xl font-semibold">
            Add a college
          </h2>
          <CreateCollegeForm />
        </Panel>
      </div>
    </div>
  );
}
