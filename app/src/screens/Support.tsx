import { useState } from 'react'
import { Link } from 'wouter'
import { getSupportUrl } from '../support/config'
import { ReportDialog } from '../support/ReportDialog'
import { Button } from '../ui/Button'
import { InfoPage, Section } from './InfoPage'

export default function Support() {
  const [reportOpen, setReportOpen] = useState(false)
  const supportUrl = getSupportUrl()

  return (
    <InfoPage
      title="Support"
      intro={<p>Something broken, confusing or missing? Tell us. Questions and bug reports both go through GitHub issues.</p>}
    >
      <Section id="report" title="How to report a problem">
        <p>
          The quickest way is the report dialog. It gathers the app version, your browser and any recent error notes, shows you the text, and lets you open a ready-made GitHub issue. Nothing is sent until you press the button.
        </p>
        <div>
          <Button variant="primary" onClick={() => setReportOpen(true)}>
            Report a problem
          </Button>
        </div>
        {supportUrl ? (
          <p>
            Prefer to write it yourself? Open the{' '}
            <a href={`${supportUrl}/new`} target="_blank" rel="noopener noreferrer" className="underline">
              issue page on GitHub
            </a>
            . You need a free GitHub account to post there.
          </p>
        ) : (
          <p role="status">
            The support link is not set up yet, so there is no issue page to open. The report dialog can still copy your report.
          </p>
        )}
      </Section>

      <Section id="include" title="What to include">
        <ul className="list-disc pl-5">
          <li>What you were doing, step by step, and what you expected to happen.</li>
          <li>What happened instead, and any message you saw.</li>
          <li>Your browser and device (the report adds the browser for you).</li>
          <li>For a model that will not build, the kind of feature involved, such as a loft or a fillet. Please do not post private designs.</li>
        </ul>
      </Section>

      <Section id="limits" title="Known limits">
        <p>
          Some things are not here yet, such as technical drawings, assemblies, rendering, and IGES, DXF or SVG import. The{' '}
          <Link href="/welcome" className="underline">
            questions on the home page
          </Link>{' '}
          cover what works today, what is missing and how your projects are stored.
        </p>
      </Section>

      <Section id="privacy" title="Your data">
        <p>
          Read the{' '}
          <Link href="/privacy" className="underline">
            privacy policy
          </Link>{' '}
          to see what is kept on your device and what a report contains.
        </p>
      </Section>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} />
    </InfoPage>
  )
}
