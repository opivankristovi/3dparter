import { Link } from 'wouter'
import { InfoPage, Section } from './InfoPage'

/** Plain-English privacy policy. Keep it true to the code: if storage, caching or reporting changes, change this. */
export default function Privacy() {
  return (
    <InfoPage
      title="Privacy policy"
      intro={
        <>
          <p>3DParter keeps your work on your device. There is no account, no analytics and no tracking.</p>
          <p className="mt-2 text-sm">Effective 2026-11-21. We will update this page before any cloud feature ships.</p>
        </>
      }
    >
      <Section id="stored" title="What is stored, and where">
        <p>
          Your projects, their history and your settings (theme, units, decimal places) are saved in your browser's own storage, in this browser on this device. They are not uploaded anywhere, and we have no copy.
        </p>
        <p>That also means we cannot recover them for you. Use Export project in the workspace to keep a backup file.</p>
      </Section>

      <Section id="account" title="No account, no analytics, no tracking cookies">
        <p>
          You do not sign in. We do not run analytics or an error-tracking service, and we do not use cookies to follow you. We do not sell or share data, because we do not collect any.
        </p>
      </Section>

      <Section id="files" title="Files you import">
        <p>When you import a STEP, STL or 3MF file, it is read and turned into a model on your device. The file is not sent to a server.</p>
        <p>For STL and 3MF files, 3DParter also keeps a converted copy in your browser, separate from your projects, so projects with imported meshes open faster. Delete all local data removes these copies.</p>
      </Section>

      <Section id="errors" title="The error log">
        <p>
          If something breaks, 3DParter writes a short note about it to a log in your browser's storage. It holds the last 50 errors: the time, the error message, a trimmed technical trace, the app version and your browser's name and version. It does not hold your geometry or file names. A modelling error can mention the name of a step or a solid, such as “Fillet 2”, so read the report before you send it.
        </p>
        <p>
          The log stays on your device until you decide to send a report. A report only goes out when you press Open a GitHub issue, and then it goes to GitHub, under GitHub's terms and privacy statement. You see the full text first and can edit it. You can also copy it, or clear the log whenever you like.
        </p>
      </Section>

      <Section id="offline" title="Offline use">
        <p>
          3DParter saves a copy of the app in your browser, using a service worker and its cache, so it can open without a connection. That cache holds the app's own code and fonts, not your projects.
        </p>
      </Section>

      <Section id="hosting" title="Hosting">
        <p>
          This site is served by GitHub Pages. Like any web host, GitHub receives your IP address and browser details when you load the site, and may keep them in its logs under{' '}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer" className="underline">
            GitHub's privacy statement
          </a>
          . 3DParter itself does not receive or store them.
        </p>
      </Section>

      <Section id="delete" title="How to delete everything">
        <p>
          Open Settings and press Delete all local data. After you confirm, it removes your projects, settings, error log and the offline copy from this browser, then reloads.
        </p>
        <p>
          You can also clear this site's data from your browser's settings. Either way, deleted projects cannot be brought back unless you exported them first.
        </p>
      </Section>

      <Section id="questions" title="Questions">
        <p>
          Ask on the{' '}
          <Link href="/support" className="underline">
            support page
          </Link>
          . The{' '}
          <Link href="/terms" className="underline">
            terms of use
          </Link>{' '}
          are on their own page.
        </p>
      </Section>
    </InfoPage>
  )
}
