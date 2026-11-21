import { Link } from 'wouter'
import { InfoPage, Section } from './InfoPage'

/** Plain-English terms of use for the free beta. Keep it true to the product: if a plan, account or cloud feature ships, rewrite it. */
export default function Terms() {
  return (
    <InfoPage
      title="Terms of use"
      intro={
        <>
          <p>Draft for the beta. These terms will be reviewed before any paid plan.</p>
          <p className="mt-2 text-sm">Effective 2026-11-21.</p>
        </>
      }
    >
      <Section id="beta" title="A free beta, as is">
        <p>
          3DParter is a free beta. It is provided as is, without any warranty. It may have bugs, and we do not promise it will be available, accurate or free of errors.
        </p>
      </Section>

      <Section id="ownership" title="Your designs are yours">
        <p>You own the designs and files you make and import. 3DParter does not claim any rights to them, and it never receives them.</p>
      </Section>

      <Section id="backups" title="Your data stays on your device">
        <p>
          The app runs in your browser and stores your projects on your device. We have no copy, so you are responsible for your backups. Use Export project in the workspace to save a file you can keep.
        </p>
      </Section>

      <Section id="safety" title="Check parts that matter">
        <p>
          Do not rely on 3DParter alone for safety-critical parts, such as anything that carries a person or holds pressure. Check dimensions, fit and strength independently before you make or use a part.
        </p>
      </Section>

      <Section id="use" title="Acceptable use">
        <p>Use 3DParter lawfully. Do not use it to break the law or to harm others, and do not try to disrupt the site that serves it.</p>
      </Section>

      <Section id="changes" title="Changes and endings">
        <p>The service may change or stop at any time. If these terms change, this page will show the new date.</p>
      </Section>

      <Section id="reports" title="Reports">
        <p>
          Problem reports go to GitHub, under GitHub's terms. A report is only sent when you choose to send it. See the{' '}
          <Link href="/privacy" className="underline">
            privacy policy
          </Link>{' '}
          for details.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <p>
          Ask on the{' '}
          <Link href="/support" className="underline">
            support page
          </Link>
          .
        </p>
      </Section>
    </InfoPage>
  )
}
