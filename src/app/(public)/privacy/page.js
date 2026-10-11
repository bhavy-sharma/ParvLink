import Link from "next/link";
import { LegalPage, LegalSection, OperatorName, Placeholder, SupportEmail } from "@/components/legal/legal-page";
import { ROUTES } from "@/lib/auth/routes";
import { MIN_AGE } from "@/lib/validation/limits";

export const metadata = { title: "Privacy notice" };

// Every statement on this page describes behaviour that exists in this
// codebase (see SECURITY.md and docs/LAUNCH.md → "Keeping the legal pages
// true"). If the behaviour changes, change this page and bump LEGAL_VERSION.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      intro="What ParvLink collects about you, who can see it, how long it is kept and how to delete it."
    >
      <LegalSection id="who" title="Who runs this service">
        <p>
          ParvLink is operated by <OperatorName />. For any question about your data, write to <SupportEmail />.
        </p>
        <p>
          <Placeholder>TO BE COMPLETED BY THE OPERATOR: postal address, the law that applies, and the name of the person responsible for privacy requests or grievances, where the law requires one</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <ul>
          <li>
            <strong>Account:</strong> your email address and a password. The password is stored only as a one-way hash (bcrypt): nobody, including the people who run this service,
            can read it. We also record the date you accepted the terms and which version.
          </li>
          <li>
            <strong>Signing in:</strong> for each device you are signed in on, a session record with the time it was created and last used. To slow down password guessing
            and abuse we keep short-lived counters of sign-in, registration and email requests; they hold a scrambled form (a hash) of the email address or network address
            involved, not the address itself, and are removed automatically after a few hours.
          </li>
          <li>
            <strong>Profile:</strong> first name, college, course, year of study, a short bio and a photo. A photo is optional for the profile itself but required before you join an event. Photos are re-encoded when you upload them, which
            removes location and device information stored in the file.
          </li>
          <li>
            <strong>Date of birth:</strong> used to confirm that you are {MIN_AGE} or older, and stored privately with your profile.
          </li>
          <li>
            <strong>Gender and who you are looking for:</strong> asked the first time you join an event, and used only to decide which students are shown to each other for that
            event.
          </li>
          <li>
            <strong>Activity:</strong> the events you join, the interest you send and receive, your matches, the students you block, and the reports you submit.
          </li>
          <li>
            <strong>Messages:</strong> the text of messages you exchange with a match, and when they were sent.
          </li>
          <li>
            <strong>Feedback:</strong> what you write in the feedback form.
          </li>
        </ul>
        <p>We do not collect your location, contacts, phone number or payment details, and the application contains no advertising or third-party analytics trackers.</p>
      </LegalSection>

      <LegalSection id="see" title="Who can see what">
        <ul>
          <li>
            <strong>Other students</strong> can see your first name, course, year, bio and photo — students of your own college, and students who joined the same event as you.
            They never see your email address or date of birth. Your gender is not displayed, but because it decides who is shown to whom, another student may be able to infer
            it.
          </li>
          <li>
            <strong>A student you matched with</strong> can also read the messages in your conversation with them.
          </li>
          <li>
            <strong>Administrators of your college</strong> who have been given the permission can see your profile and whether your account is active or suspended. They see
            you as a first name and a short reference, not your email address.
          </li>
          <li>
            <strong>Moderators</strong> see a report made about you or by you. They cannot browse conversations. They can read messages from a conversation only when one of
            its two participants reported it and chose to attach recent messages; each time a moderator opens those messages, it is recorded.
          </li>
          <li>
            <strong>Super Admins</strong> (the operator’s own staff) can additionally see the email addresses of administrators, and feedback submissions.
          </li>
          <li>
            <strong>The companies that host the service</strong> (below) store the data on our behalf, and people with access to the operator’s hosting accounts can technically
            reach everything stored there.
          </li>
        </ul>
        <p>
          Messages are stored on the server so that both of you can read them on any device. They are <strong>not end-to-end encrypted</strong>, and we do not promise that a
          conversation is confidential in every circumstance.
        </p>
      </LegalSection>

      <LegalSection id="processors" title="Where the data is kept">
        <ul>
          <li>
            <strong>MongoDB</strong> — the database: accounts (with passwords stored only as hashes), profiles, photos, events, matches, messages, reports and feedback.
          </li>
          <li>
            <strong>An email provider</strong> — delivers the confirmation and password-reset emails. It sees your email address and those two messages, nothing else.
          </li>
          <li>
            <strong>Vercel</strong> — runs the website.
          </li>
        </ul>
        <p>
          <Placeholder>TO BE COMPLETED BY THE OPERATOR: who hosts the MongoDB database and in which region, the name of the email provider, and how long database backups are kept</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies">
        <p>
          We use only the cookies needed to keep you signed in and to finish confirming your email or resetting your password. They cannot be read by scripts in the page. There
          are no advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection id="keep" title="How long we keep it">
        <p>
          Your data is kept for as long as you have an account. Nothing is deleted automatically: there is no timer that removes old messages or inactive accounts. Copies in
          the hosting provider’s backups remain until those backups expire.
        </p>
      </LegalSection>

      <LegalSection id="delete" title="Deleting your account">
        <p>
          You can delete your account yourself at any time from <Link href={ROUTES.deleteAccount}>Delete account</Link> (you need to be logged in). Deleting it removes:
        </p>
        <ul>
          <li>your profile, date of birth, gender and photo;</li>
          <li>your event participation, the interest you sent and received, your matches and blocks;</li>
          <li>your conversations, including the copies your matches could see;</li>
          <li>
            your sign-in record (email address and password hash) and every session: you are logged out on all devices and the address can no longer log in.
          </li>
        </ul>
        <p>These are kept after deletion:</p>
        <ul>
          <li>
            <strong>Reports</strong> you submitted or that were made about you, including any messages that were attached to them. They are no longer linked to your account.
          </li>
          <li>
            <strong>The administrators’ activity log</strong>, in which you appear only as a short reference code.
          </li>
          <li>
            <strong>Feedback</strong> you sent, no longer linked to your account.
          </li>
        </ul>
        <p>
          If your account is suspended or being reviewed by an administrator when you ask, the request is held until an administrator has decided it, so that a deletion cannot
          be used to make a safety review disappear. You can see the status of a held request on the same page, and cancel it.
        </p>
        <p>If you cannot log in, write to <SupportEmail /> from the address you registered with.</p>
      </LegalSection>

      <LegalSection id="rights" title="Your choices">
        <ul>
          <li>You can see and correct your profile on the Profile page. College, date of birth and gender are fixed; ask <SupportEmail /> to correct a mistake.</li>
          <li>You can leave an event’s partner discovery, block another student, and report a profile or conversation.</li>
          <li>You can ask for a copy of your data or raise a concern by writing to <SupportEmail />. There is no automatic export yet.</li>
        </ul>
      </LegalSection>

      <LegalSection id="age" title="Age">
        <p>The service is for students aged {MIN_AGE} and over. An account cannot create a profile with a date of birth below that age.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this notice">
        <p>When this notice changes in a way that matters, the version date at the top changes with it.</p>
      </LegalSection>
    </LegalPage>
  );
}
