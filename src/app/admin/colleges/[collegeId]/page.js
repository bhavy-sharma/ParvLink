import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireSuperAdmin } from "@/lib/auth/session";
import { collegeIdSchema } from "@/lib/validation/schemas";
import { EditCollegeForm } from "../college-forms";
import { call } from "@/lib/services";

export const metadata = { title: "Edit college" };

export default async function EditCollegePage({ params }) {
  await requireSuperAdmin();

  const parsed = collegeIdSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const { data, error } = await call("admin_get_college", { college_id: parsed.data.collegeId });
  const college = data?.college ?? null;
  const studentCount = data?.students ?? 0;
  if (error) throw new Error("The college could not be loaded.");
  if (!college) notFound();

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link href={ROUTES.adminColleges} className="text-sm font-semibold text-brand underline">
          Back to colleges
        </Link>
        <div className="mt-3">
          <PageHeader
            title={college.name}
            description={
              studentCount === 1 ? "1 student has a profile here." : `${studentCount ?? 0} students have a profile here.`
            }
          />
        </div>
      </div>
      <Panel as="div">
        <EditCollegeForm college={college} />
      </Panel>
    </div>
  );
}
