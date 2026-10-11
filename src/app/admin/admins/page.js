import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { requireSuperAdmin } from "@/lib/auth/session";
import { call } from "@/lib/services";
import { ADMIN_PERMISSIONS, ROLES } from "@/lib/validation/limits";
import { revokeAdminAction, revokeCollegeAccessAction } from "../actions";
import { AssignCollegeForm, GrantAdminForm } from "./admin-forms";

export const metadata = { title: "Admins" };

const PERMISSION_LABEL = Object.fromEntries(ADMIN_PERMISSIONS.map((p) => [p.value, p.label]));

export default async function AdminsPage() {
  const { user } = await requireSuperAdmin();

  const [people, access, colleges] = await Promise.all([
    call("admin_list_admins"),
    call("admin_list_access"),
    call("admin_list_colleges"),
  ]);
  if (people.error || access.error || colleges.error) throw new Error("Admins could not be loaded.");

  const accessByUser = new Map();
  for (const row of access.data) {
    accessByUser.set(row.admin_user_id, [...(accessByUser.get(row.admin_user_id) ?? []), row]);
  }
  const admins = people.data.filter((person) => person.role === ROLES.ADMIN);
  const superAdmins = people.data.filter((person) => person.role === ROLES.SUPER_ADMIN);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admins"
        description="An admin can only act on the colleges you assign, with the permissions you tick. Every change on this page is recorded."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="admin-list" className="space-y-4">
          <h2 id="admin-list" className="text-xl font-semibold">
            College admins
          </h2>

          {admins.length === 0 ? (
            <EmptyState title="No admins yet">
              Make someone an admin with the form on this page, then assign them a college.
            </EmptyState>
          ) : (
            admins.map((admin) => {
              const assignments = accessByUser.get(admin.user_id) ?? [];
              return (
                <Panel key={admin.user_id} as="article" aria-label={admin.email}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-all font-sans text-base font-semibold">{admin.email}</h3>
                      {admin.first_name ? <p className="text-sm text-ink-muted">{admin.first_name}</p> : null}
                    </div>
                    <InlineActionForm action={revokeAdminAction} fields={{ userId: admin.user_id }}>
                      <ConfirmSubmit confirmLabel="Yes, remove admin role">Remove admin role</ConfirmSubmit>
                    </InlineActionForm>
                  </div>

                  {assignments.length === 0 ? (
                    <p className="mt-4 rounded-field bg-marigold-soft px-3 py-2 text-sm text-marigold-ink">
                      Not assigned to any college, so this admin cannot see anything yet.
                    </p>
                  ) : (
                    <ul className="mt-4 divide-y divide-line border-y border-line">
                      {assignments.map((assignment) => (
                        <li key={assignment.college_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">
                              {assignment.colleges?.name ?? "Unknown college"}
                              {assignment.colleges && !assignment.colleges.is_active ? <span className="font-normal text-ink-muted"> (closed)</span> : null}
                            </p>
                            <p className="mt-1 flex flex-wrap gap-1.5">
                              {assignment.permissions.map((permission) => (
                                <Badge key={permission} tone="brand">
                                  {PERMISSION_LABEL[permission] ?? permission}
                                </Badge>
                              ))}
                            </p>
                          </div>
                          <InlineActionForm
                            action={revokeCollegeAccessAction}
                            fields={{ userId: admin.user_id, collegeId: assignment.college_id }}
                          >
                            <ConfirmSubmit confirmLabel="Yes, revoke">Revoke</ConfirmSubmit>
                          </InlineActionForm>
                        </li>
                      ))}
                    </ul>
                  )}

                  <details className="group mt-4">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full text-sm font-semibold text-brand underline [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">Assign a college</span>
                      <span className="hidden group-open:inline">Close</span>
                    </summary>
                    <div className="mt-4">
                      {colleges.data.length === 0 ? (
                        <p className="text-sm text-ink-muted">Add a college first.</p>
                      ) : (
                        <AssignCollegeForm userId={admin.user_id} colleges={colleges.data} />
                      )}
                    </div>
                  </details>
                </Panel>
              );
            })
          )}

          <h2 className="pt-4 text-xl font-semibold">Super Admins</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
            {superAdmins.map((person) => (
              <li key={person.user_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="break-all font-semibold">{person.email}</span>
                {person.user_id === user.id ? <Badge tone="brand">You</Badge> : null}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">
            Super Admins have access to every college. They are added and removed by the database owner, not from this screen — see docs/DEPLOYMENT.md in the repository.
          </p>
        </section>

        <Panel aria-labelledby="grant-admin">
          <h2 id="grant-admin" className="mb-4 text-xl font-semibold">
            Add an admin
          </h2>
          <GrantAdminForm />
        </Panel>
      </div>
    </div>
  );
}
