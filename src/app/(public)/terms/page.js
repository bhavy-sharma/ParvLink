import Link from "next/link";
import { LegalPage, LegalSection, OperatorName, Placeholder, SupportEmail } from "@/components/legal/legal-page";
import { ROUTES } from "@/lib/auth/routes";
import { MIN_AGE } from "@/lib/validation/limits";

export const metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" intro="The rules for using Campus Partner Finder. You agree to them when you create an account.">
      <LegalSection id="service" title="What this is">
        <p>
          Campus Partner Finder helps students find a partner or team-mate for college events. It is operated by <OperatorName />. It is a beta: features may change, and it may
          be unavailable at times.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="Who can use it">
        <ul>
          <li>You are {MIN_AGE} or older.</li>
          <li>You are a student of the college you select, and the details in your profile are your own and true.</li>
          <li>You keep one account, and you do not let anyone else use it.</li>
        </ul>
      </LegalSection>

      <LegalSection id="conduct" title="How to behave">
        <p>Do not use the service to:</p>
        <ul>
          <li>harass, threaten, demean or pressure anyone;</li>
          <li>send sexual content, or content that is hateful or illegal;</li>
          <li>pretend to be someone else, or misstate your college, age or gender;</li>
          <li>share another person’s private information or messages without their agreement;</li>
          <li>advertise, sell, or send the same message to many people;</li>
          <li>get around a block, a suspension or any technical restriction, or try to reach other people’s data.</li>
        </ul>
      </LegalSection>

      <LegalSection id="safety" title="Meeting people">
        <p>
          We do not verify anyone’s identity, and a profile is not a recommendation. Use your own judgement before sharing contact details or meeting someone; meet in a public
          place on campus and tell a friend. In an emergency, contact campus security or the local emergency services — this service is not monitored in real time.
        </p>
        <p>You can block a student or report a profile or conversation at any time from inside the app.</p>
      </LegalSection>

      <LegalSection id="moderation" title="Moderation">
        <p>
          Administrators review reports. They may mark an account as under review, suspend it for a period or until further notice, or restore it. While an account is
          suspended it cannot join events, appear in partner discovery, or read and send messages. If you believe a decision is wrong, write to <SupportEmail />.
        </p>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <p>
          What you write and upload stays yours. You allow us to store it and show it to the people described in the <Link href={ROUTES.privacy}>Privacy notice</Link>, for the
          purpose of running the service. You are responsible for what you post.
        </p>
      </LegalSection>

      <LegalSection id="leaving" title="Leaving">
        <p>
          You can delete your account at any time from <Link href={ROUTES.deleteAccount}>Delete account</Link>. What is removed and what is kept is set out in the Privacy
          notice.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="No guarantees">
        <p>
          The service is provided as it is. We do not guarantee that you will find a partner, that other students are who they say they are, or that the service will always be
          available or free of errors.
        </p>
        <p>
          <Placeholder>TO BE COMPLETED BY THE OPERATOR: limitation of liability, governing law and how disputes are handled, as advised by a lawyer for the place the service operates in</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If these terms change in a way that matters, the version date at the top changes. Continuing to use the service after that date means you accept the new version; if you do not, you can delete your account.</p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          <OperatorName /> — <SupportEmail />
        </p>
      </LegalSection>
    </LegalPage>
  );
}
