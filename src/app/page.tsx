import Link from "next/link";
import styles from "./home.module.css";

const handoffStages = [
  {
    number: "01",
    title: "Part packet",
    text: "Keep the drawing, visual model, selected facility, and open questions with one part instead of across messages and folders.",
  },
  {
    number: "02",
    title: "Review the evidence",
    text: "Compare documented requirements with the facility profile. Support, conflicts, and unknowns stay visibly different.",
  },
  {
    number: "03",
    title: "Release useful guidance",
    text: "Engineering reviews concise guidance for the operations that need it, then publishes the approved part knowledge.",
  },
  {
    number: "04",
    title: "Resolve work in context",
    text: "The floor scans the stable part QR, sees the relevant operation, and returns questions to engineering with their context intact.",
  },
];

const capabilities = [
  {
    number: "01",
    title: "Check the handoff",
    text: "Match a part to the selected workshop’s documented machines, tooling, and process notes before release.",
  },
  {
    number: "02",
    title: "Guide the difficult work",
    text: "Propose visual instructions where a job is unusually complex. Engineers check the interpretation, correct the steps and approve the guide before anyone scans it.",
  },
  {
    number: "03",
    title: "Keep questions attached",
    text: "A QR opens the current approved part knowledge. Questions and flags return with the exact part, operation, and release context attached.",
  },
];

function SignalMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <path d="M7 8h13.5a8.5 8.5 0 0 1 0 17H12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" />
      <path d="M7 8v20h5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" />
      <path d="M24 11.5 29 7m-5 17 5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

function HeroPart() {
  return (
    <svg className={styles.heroPart} viewBox="0 0 760 600" role="img" aria-labelledby="part-title part-description">
      <title id="part-title">Illustrative formed manufacturing bracket</title>
      <desc id="part-description">A technical, labelled view of an illustrative formed bracket. It is a visual explanation of the Chappe handoff, not manufacturing evidence.</desc>
      <g className={styles.partConstruction} fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M84 104h524M84 179h524M84 254h524M84 329h524M84 404h524" />
        <path d="M105 77v382M224 77v382M343 77v382M462 77v382M581 77v382" />
      </g>
      <g className={styles.partMotionLines} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M42 251c82-52 137-63 200-39" />
        <path d="M37 267c87-48 145-54 208-28" />
        <path d="M46 284c77-36 135-37 193-9" />
      </g>
      <g className={styles.partAssembly}>
        <path d="M171 232 342 134l241 76-171 99Z" fill="var(--ch-metal-light)" stroke="var(--ch-schematic-stroke)" strokeWidth="3" />
        <path d="m171 232 241 76v121L171 353Z" fill="var(--ch-metal-mid)" stroke="var(--ch-schematic-stroke)" strokeWidth="3" />
        <path d="m412 308 171-98v118L412 429Z" fill="var(--ch-metal-dark)" stroke="var(--ch-schematic-stroke)" strokeWidth="3" />
        <path d="m205 232 139-80 205 64-139 81Z" fill="none" stroke="var(--ch-schematic-line)" strokeWidth="2" />
        <path d="m213 251 198 62m-125-109 199 62m-126-109 198 62" fill="none" stroke="var(--ch-schematic-line)" strokeWidth="2" />
        <path d="M224 250v84m55-52v84m55-52v84m55-52v84" fill="none" stroke="var(--ch-schematic-line)" strokeWidth="2" />
        <path d="M454 292v84m54-116v84" fill="none" stroke="var(--ch-schematic-line)" strokeWidth="2" />
        <ellipse cx="299" cy="231" rx="24" ry="13" fill="var(--ch-canvas)" stroke="var(--ch-schematic-stroke)" strokeWidth="3" />
        <ellipse cx="459" cy="281" rx="24" ry="13" fill="var(--ch-canvas)" stroke="var(--ch-schematic-stroke)" strokeWidth="3" />
        <path d="m369 324 30 9v48l-30-9Z" fill="var(--ch-canvas-subtle)" stroke="var(--ch-schematic-stroke)" strokeWidth="2" />
      </g>
      <g className={styles.partDimensions} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M170 468h414m-414-8v16m414-16v16" />
        <path d="M615 203v225m-8-225h16m-16 225h16" />
        <path d="M143 221 151 215m-8 6 7 7" />
      </g>
      <g className={styles.partAnnotations} fill="currentColor">
        <circle cx="143" cy="221" r="4" />
        <circle cx="615" cy="316" r="4" />
        <text x="245" y="496">PART WIDTH / ILLUSTRATIVE</text>
        <text x="634" y="323">B2</text>
        <text x="84" y="204">FORMED AREA</text>
      </g>
    </svg>
  );
}

function Arrow({ direction = "up" }: { direction?: "up" | "down" }) {
  return <span aria-hidden="true" className={direction === "down" ? styles.arrowDown : styles.arrow}>↗</span>;
}

export default function HomePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Chappe home">
          <span className={styles.brandMark}><SignalMark /></span>
          <span>Chappe</span>
        </Link>
        <nav className={styles.topnav} aria-label="Main navigation">
          <a className={styles.navPlain} href="#workflow">The handoff</a>
          <a className={styles.navPlain} href="#evidence">Evidence</a>
          <span className={styles.navDivider} aria-hidden="true" />
          <Link className={styles.workspaceLink} href="/studio">Engineering <Arrow /></Link>
          <Link className={styles.workspaceLink} href="/studio/manufacturing">Manufacturing <Arrow /></Link>
          <Link className={styles.signIn} href="/login">Sign in</Link>
          <Link className={styles.navCta} href="/signup">Create account <Arrow /></Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroRail} aria-hidden="true"><span>01</span><span>Part knowledge, carried forward</span></div>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Engineering → workshop → floor</p>
            <h1 id="hero-title">Make complex work clear before it reaches the floor.</h1>
            <p className={styles.lede}>
              Chappe holds the drawing, visual model, documented facility context, reviewed guidance, and floor questions around one evolving part record.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/studio">Open engineering <Arrow /></Link>
              <Link className={styles.secondaryAction} href="/studio/manufacturing">See a manufacturer handoff <Arrow /></Link>
            </div>
            <p className={styles.scopeNote}>The part visual is illustrative. Chappe distinguishes source evidence, human approval, conflicts, and unknowns.</p>
          </div>
          <figure className={styles.heroVisual}>
            <div className={styles.visualTopline}><span>Prepared part view</span><span>Context / B2</span></div>
            <HeroPart />
            <figcaption>
              <span>Illustrative formed bracket</span>
              <span>Not a manufacturing instruction</span>
            </figcaption>
          </figure>
        </div>
        <div className={styles.heroBottom} aria-label="Chappe handoff summary">
          <span>Files stay with the part</span><span>Human review stays explicit</span><span>Floor context returns intact</span>
        </div>
      </section>

      <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sideLabel}><span className={styles.square} aria-hidden="true" />The handoff</div>
        <div className={styles.workflowBody}>
          <div className={styles.workflowHeading}>
            <p className={styles.eyebrow}>A working record, not another export</p>
            <h2 id="workflow-title">One part. A clearer path from design intent to an answer on the floor.</h2>
          </div>
          <ol className={styles.stageList}>{handoffStages.map((stage) => (
            <li key={stage.number}>
              <span className={styles.stageNumber}>{stage.number}</span>
              <div><h3>{stage.title}</h3><p>{stage.text}</p></div>
              <Arrow />
            </li>
          ))}</ol>
        </div>
      </section>

      <section id="evidence" className={styles.evidence} aria-labelledby="evidence-title">
        <div className={styles.sideLabel}><span className={styles.square} aria-hidden="true" />Evidence before certainty</div>
        <div className={styles.evidenceBody}>
          <div className={styles.evidenceLead}>
            <p className={styles.eyebrow}>Make the decision visible</p>
            <h2 id="evidence-title">The handoff needs more than a file transfer.</h2>
            <p>It needs the exact information a person uses to decide what is ready, what needs review, and what still needs to be confirmed.</p>
          </div>
          <div className={styles.evidenceBoard}>
            <article className={styles.evidencePanel}>
              <div className={styles.panelTopline}><span>Part packet</span><span>01 / source</span></div>
              <dl className={styles.packetList}>
                <div><dt>Drawing</dt><dd>Readable technical evidence</dd></div>
                <div><dt>Model</dt><dd>Visual reference for the part</dd></div>
                <div><dt>Facility</dt><dd>Documented profile, not a guess</dd></div>
              </dl>
              <div className={styles.packetLine} aria-hidden="true"><span /><span /><span /><span /><span /></div>
            </article>
            <article className={`${styles.evidencePanel} ${styles.decisionPanel}`}>
              <div className={styles.panelTopline}><span>Review state</span><span>02 / decision</span></div>
              <ul className={styles.statusList}>
                <li><span className={styles.statusMark}>+</span><div><strong>Documented support</strong><small>Source fact matches an explicit requirement.</small></div></li>
                <li><span className={styles.statusMark}>!</span><div><strong>Conflict to resolve</strong><small>Recorded information contradicts the stated need.</small></div></li>
                <li><span className={styles.statusMark}>?</span><div><strong>Unknown remains visible</strong><small>Missing setup or capability evidence is not approval.</small></div></li>
              </ul>
            </article>
          </div>
          <p className={styles.evidenceNote}>Capability checks surface documented support, conflict, and unknowns; they do not certify physical manufacturability.</p>
        </div>
      </section>

      <section id="features" className={styles.platform} aria-labelledby="platform-title">
        <div className={styles.platformTopline}><span><i aria-hidden="true" />The Chappe platform</span><span>03 / reviewable work</span></div>
        <h2 id="platform-title">The part can move forward.<br />Its context should too.</h2>
        <div className={styles.platformIntro}>
          <p>Chappe gives engineers and manufacturers separate places to work, connected by the same part record rather than a detached dashboard.</p>
          <Link className={styles.inverseAction} href="/studio">Open engineering <Arrow /></Link>
        </div>
        <div className={styles.capabilityGrid}>{capabilities.map((capability) => (
          <article className={styles.capability} key={capability.number}>
            <div className={styles.capabilityVisual} aria-hidden="true">
              {capability.number === "01" && <><span /><span /><span /><b /></>}
              {capability.number === "02" && <><span /><span /><b /><em /></>}
              {capability.number === "03" && <><span /><span /><span /><em /></>}
            </div>
            <p className={styles.capabilityNumber}>{capability.number}</p>
            <h3>{capability.title}</h3>
            <p>{capability.text}</p>
          </article>
        ))}</div>
      </section>

      <section className={styles.workspaceCallout} aria-labelledby="workspace-title">
        <div className={styles.sideLabel}><span className={styles.square} aria-hidden="true" />Choose your work area</div>
        <div className={styles.workspaceBody}>
          <h2 id="workspace-title">Start where the decision sits.</h2>
          <div className={styles.workspaceChoices}>
            <Link href="/studio" className={styles.workspaceChoice}>
              <span className={styles.choiceIndex}>01</span>
              <span><strong>Engineering</strong><small>Prepare the part, review guidance, and release approved knowledge.</small></span>
              <Arrow />
            </Link>
            <Link href="/studio/manufacturing" className={styles.workspaceChoice}>
              <span className={styles.choiceIndex}>02</span>
              <span><strong>Manufacturing</strong><small>Inspect received handoffs, document equipment context, and resolve questions.</small></span>
              <Arrow />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}><span className={styles.footerMark}><SignalMark /></span><strong>Chappe</strong></div>
        <p>Clear information across the distance between design and the people making the part.</p>
        <div className={styles.footerLinks}><Link href="/login" aria-label="Sign in to Chappe">Sign in</Link><Link href="/signup" aria-label="Create a Chappe account">Create account</Link></div>
        <p className={styles.prototypeNote}>Chappe is a reviewed manufacturing handoff workflow. AI proposals are drafts, facility checks depend on documented evidence, and engineering approval remains explicit.</p>
      </footer>
    </main>
  );
}
