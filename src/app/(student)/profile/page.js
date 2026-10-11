import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ROUTES } from "@/lib/auth/routes";
import { Badge, PageHeader, Panel } from "@/components/ui/misc";
import { requireProfile } from "@/lib/auth/session";
import { getAvatarUrl } from "@/lib/data/avatars";
import { formatDate } from "@/lib/dates";
import { collegeLabel } from "@/lib/format";
import { genderLabel } from "@/lib/partners";
import { PhotoForm } from "./photo-form";
import { ProfileForm } from "./profile-form";
import { call } from "@/lib/services";

export const metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { user, profile } = await requireProfile();

  const avatarUrl = getAvatarUrl(profile.avatar_path);
  // The service returns the caller's own private data; there is no way to ask for anyone else's.
  const { data: privateRow } = await call("my_private_profile");
  const suspended = profile.status === "suspended";

  return (
    <div className="space-y-8">
      <PageHeader title="Your profile" description="Students at your college see your first name, course, year, photo and bio. Nothing else." />

      {suspended ? (
        <Alert tone="warning" title="Your profile is suspended">
          You cannot make changes while it is suspended.
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-5">
          <Panel>
            <h2 className="mb-4 text-xl font-semibold">Photo</h2>
            <PhotoForm avatarUrl={avatarUrl} name={profile.first_name} disabled={suspended} />
          </Panel>

          <Panel>
            <h2 className="text-xl font-semibold">Fixed details</h2>
            <p className="mt-1 text-sm text-ink-muted">To change any of these, contact your college admin.</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold">College</dt>
                <dd className="flex flex-wrap items-center gap-2 text-ink-muted">
                  {collegeLabel(profile.colleges) || "No longer listed"}
                  {profile.is_verified ? <Badge tone="ok">Verified</Badge> : null}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Email</dt>
                <dd className="break-all text-ink-muted">{user.email}</dd>
              </div>
              <div>
                <dt className="font-semibold">Date of birth</dt>
                <dd className="text-ink-muted">{privateRow?.date_of_birth ? formatDate(privateRow.date_of_birth) : "Not available"}</dd>
              </div>
              <div>
                <dt className="font-semibold">Gender</dt>
                <dd className="text-ink-muted">{privateRow?.gender ? genderLabel(privateRow.gender) : "Asked when you first join an event"}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-field bg-brand-soft px-3 py-2 text-sm text-brand-strong">
              Your email, date of birth and gender are visible only to you.
            </p>
          </Panel>
        </div>

        <Panel>
          <h2 className="mb-4 text-xl font-semibold">Details</h2>
          <ProfileForm profile={profile} disabled={suspended} />
        </Panel>
      </div>

      <Panel>
        <h2 className="text-xl font-semibold">Your account</h2>
        <ul className="mt-3 space-y-2 text-sm [&_a]:font-semibold [&_a]:text-brand [&_a]:underline">
          <li>
            <Link href={ROUTES.feedback}>Send feedback</Link> <span className="text-ink-muted">— tell the team what is broken or confusing.</span>
          </li>
          <li>
            <Link href={ROUTES.privacy}>Privacy notice</Link> <span className="text-ink-muted">and</span> <Link href={ROUTES.terms}>Terms of use</Link>
          </li>
          <li>
            <Link href={ROUTES.deleteAccount}>Delete your account</Link> <span className="text-ink-muted">— permanent; the page explains what is removed.</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
