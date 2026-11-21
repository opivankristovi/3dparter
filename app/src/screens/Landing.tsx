import { Link } from 'wouter'
import { LinkButton } from './LinkButton'

/** Public landing page, served at #/welcome. Copy lives in replica/launch/landing.md; keep the two in step. */

const PROBLEMS = [
  {
    title: 'The price is set for companies, not for a weekend',
    body: 'Annual plans that cost more than a printer, and free tiers that hand you blocky STL files and a cap of two projects. You find out after your first test print.',
  },
  {
    title: 'The door has locks on it',
    body: 'A sign-up before you can draw a rectangle. A tutorial you cannot skip. A stylus or an install before you can model. Most people leave in the first five minutes.',
  },
]

const STEPS = [
  { title: 'Sketch', body: 'Draw on a plane or a flat face. Type sizes as you go, add constraints, and see in words how much can still move.' },
  { title: 'Build', body: 'Extrude, revolve, sweep or loft into a solid. Fillet, shell and combine. Every step lands in the history.' },
  { title: 'Export', body: 'Pick STL, 3MF, STEP, OBJ or GLB, choose high or low detail, and download. Nothing is held back.' },
]

const FEATURES = [
  {
    title: 'Open it and draw',
    body: 'No account, no card, no tutorial gate. The workspace opens on a blank project and your work is saved in this browser.',
  },
  {
    title: 'Exports without a paywall',
    body: 'STL at 0.01 mm detail so circles stay round, plus 3MF and STEP. Export selected solids or everything visible.',
  },
  {
    title: 'Keep as many projects as you like',
    body: 'Projects live on your device, so there is no two-project cap. Export a .3dparter.json file whenever you want a backup.',
  },
  {
    title: 'Nothing to install',
    body: 'It runs in a modern browser. We test it in Chromium-based browsers today; other browsers are not yet in our test runs.',
  },
  {
    title: 'Works with touch',
    body: 'One finger orbits, two fingers pan and zoom, and the phone layout keeps the modelling tools in reach. Tested in emulated touch so far, not yet across real devices.',
  },
  {
    title: 'Text that follows a curve',
    body: 'Type text in a sketch, straight or around a circle or arc, then raise it or cut it in. Letters keep their smooth curves, so a coin or a dial label prints clean.',
  },
  {
    title: 'Edit the STL you already have',
    body: 'Import an STL or 3MF and it becomes a solid: cut holes in it, round its edges, sketch on its faces. Works for closed meshes up to 20,000 triangles.',
  },
  {
    title: 'Change a number, the part follows',
    body: 'Edit an early step and later steps rebuild. Use variables and expressions such as width / 2 + 3 in any number field. A step that breaks says why.',
  },
]

const FAQ = [
  {
    q: 'Do I need an account?',
    a: 'No. There is no sign-in. Your projects are stored in this browser.',
  },
  {
    q: 'What happens if I clear my browser data?',
    a: 'Your projects go with it, because they are stored locally. Use Export project in the workspace to save a .3dparter.json file as a backup, and import it from the project list.',
  },
  {
    q: 'Can I bring in files from other CAD or mesh tools?',
    a: 'Yes: STEP (.step, .stp), STL and 3MF. STEP comes in as an editable solid. Closed STL and 3MF meshes up to 20,000 triangles become solids you can cut, round and sketch on; curved surfaces stay faceted, the way the mesh was made. IGES, DXF and SVG cannot be imported yet.',
  },
  {
    q: 'What is not here yet?',
    a: 'Technical drawings, assemblies, rendering, and IGES, DXF or SVG import. We would rather say so than have you find out halfway through a design.',
  },
  {
    q: 'Does it work on a phone or tablet?',
    a: 'Yes, with touch and no stylus needed. It is built to fit a phone-width screen. We have tested it with emulated touch, so tell us if a real device behaves differently.',
  },
  {
    q: 'Will it stay free?',
    a: 'Yes. 3DParter is free to use, now and in the future. Modelling and exporting will never sit behind a paywall, and the code is open source under the GNU GPL v3.',
  },
]

const sectionTitle = 'text-xl font-semibold text-text'
const section = 'mx-auto w-full max-w-(--layout-dashboard-max) px-4 py-8'

export function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="absolute left-2 top-2 z-10 -translate-y-16 rounded-md bg-surface-raised px-3 py-2 text-text focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex h-(--layout-topbar-h) w-full max-w-(--layout-dashboard-max) items-center justify-between px-4">
          <span className="text-lg font-semibold">3DParter<sup className="ml-0.5 align-super text-xs font-normal">™</sup></span>
          <LinkButton href="/">Open projects</LinkButton>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section aria-labelledby="hero-title" className={`${section} flex flex-col gap-6`}>
          <div className="flex max-w-[60ch] flex-col gap-4">
            <h1 id="hero-title" className="text-display font-bold text-text">
              Parametric 3D CAD for makers. Free to start, free to export.
            </h1>
            <p className="text-lg font-normal text-text-muted">
              Sketch with constraints, build solids, and download STL, 3MF or STEP at full detail. It runs in your browser, with no account and no install.
            </p>
            <div>
              <LinkButton href="/" variant="primary" className="h-10 px-4">
                Start a project
              </LinkButton>
            </div>
          </div>
          <img
            src={`${import.meta.env.BASE_URL}launch/workspace.png`}
            width={1440}
            height={900}
            alt="The 3DParter workspace: a tool rail on the left, a rectangular solid in the 3D view, and a history panel on the right listing Sketch 1 and Extrude 1."
            className="h-auto w-full rounded-lg border border-border shadow-panel"
          />
        </section>

        <section aria-labelledby="problem-title" className={`${section} flex flex-col gap-4`}>
          <h2 id="problem-title" className={sectionTitle}>
            Why hobby CAD gets abandoned
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {PROBLEMS.map((p) => (
              <li key={p.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="text-base text-text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-title" className={`${section} flex flex-col gap-4`}>
          <h2 id="how-title" className={sectionTitle}>
            How it works
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
                <span className="text-sm font-medium text-text-muted">Step {i + 1}</span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-base text-text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="features-title" className={`${section} flex flex-col gap-4`}>
          <h2 id="features-title" className={sectionTitle}>
            What you get
          </h2>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="text-base text-text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pricing-title" className={`${section} flex flex-col gap-3`}>
          <h2 id="pricing-title" className={sectionTitle}>
            Pricing
          </h2>
          <div className="flex max-w-[60ch] flex-col gap-2 rounded-lg border border-border bg-accent-subtle p-4">
            <p className="text-lg font-semibold text-text">Free, now and in the future</p>
            <p className="text-base text-text">
              Every tool on this page is included. No account, no card, no project limit on your device.
            </p>
          </div>
        </section>

        <section aria-labelledby="faq-title" className={`${section} flex flex-col gap-3`}>
          <h2 id="faq-title" className={sectionTitle}>
            Questions
          </h2>
          <div className="flex max-w-[70ch] flex-col gap-2">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-lg border border-border bg-surface-raised p-3">
                <summary className="cursor-pointer text-base font-medium text-text">{f.q}</summary>
                <p className="pt-2 text-base text-text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta-title" className={`${section} flex flex-col items-start gap-4 pb-8`}>
          <h2 id="cta-title" className={sectionTitle}>
            Make your first part
          </h2>
          <p className="max-w-[60ch] text-base text-text-muted">
            A blank project is one click away. Draw a rectangle, pull it up, and export it.
          </p>
          <LinkButton href="/" className="h-10 px-4">
            Open 3DParter
          </LinkButton>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-(--layout-dashboard-max) flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 text-sm text-text-muted">
          <p>3DParter™ is in beta. Projects are stored in your browser.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            <Link href="/terms" className="underline">
              Terms
            </Link>
            <Link href="/support" className="underline">
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
