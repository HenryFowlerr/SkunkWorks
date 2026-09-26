import Image from "next/image";
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
    title: "Review useful guidance",
    text: "Engineering reviews a concise assembly outline with the shop before it becomes floor guidance.",
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
      <path d="M18 31V9" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="square" />
      <path d="m18 9-11-4m11 4 11-4" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="square" />
      <path d="M7 5v6m22-6v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <circle cx="18" cy="9" r="2" fill="currentColor" />
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
          <Link className={styles.navCta} href="/parts/manufacturing-test-sheet">Explore Steel Bracket <Arrow /></Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroRail} aria-hidden="true"><span>01</span><span>Part knowledge, carried forward</span></div>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>R&amp;D engineering → prototype shop</p>
            <h1 id="hero-title">Keep engineering intent close to the prototype.</h1>
            <p className={styles.lede}>
              Bring source references, manufacturing context, assembly guidance, and shop-floor questions together around one evolving part.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/studio">Explore engineering <Arrow /></Link>
            </div>
            <p className={styles.scopeNote}>Public demo · Steel Bracket source drawing, STL visual reference, and QR-enabled guide · no sign-in required. Source revision, material, and work guidance require review.</p>
          </div>
          <figure className={styles.heroVisual}>
            <div className={styles.visualTopline}><span>Steel Bracket · demo drawing</span><span>QR-enabled source view</span></div>
            <Image className={styles.heroDrawing} src="/chappe-demo/steel-bracket-qr-drawing-preview.png" alt="Steel Bracket demo drawing with a QR code that opens the shop guide" width={2382} height={1684} priority />
            <figcaption>
              <span>Steel Bracket · QR-enabled demo drawing</span>
              <span>Scan to open the shop guide</span>
            </figcaption>
          </figure>
        </div>
        <div className={styles.heroBottom} aria-label="Chappe handoff summary">
          <span>References stay with the part</span><span>Review stays explicit</span><span>Shop questions keep context</span>
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
          <p>R&amp;D engineers and prototype manufacturers get distinct views of the same source packet, from initial review through shop questions.</p>
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
        <div className={styles.sideLabel}><span className={styles.square} aria-hidden="true" />Engineering workspace</div>
        <div className={styles.workspaceBody}>
          <h2 id="workspace-title">Start with the part review.</h2>
          <div className={styles.workspaceChoices}>
            <Link href="/studio" className={styles.workspaceChoice}>
              <span className={styles.choiceIndex}>01</span>
              <span><strong>Engineering</strong><small>Bring drawings, model references, and open decisions into one review.</small></span>
              <Arrow />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}><span className={styles.footerMark}><SignalMark /></span><strong>Chappe</strong></div>
        <p>A clearer conversation between the people designing a part and the people making its prototype.</p>
        <div className={styles.footerLinks}><Link href="/studio">Engineering demo</Link></div>
        <p className={styles.prototypeNote}>This is a public interface demo with local copies of supplied source files. It does not provide live AI, saved collaboration, or manufacturing approval.</p>
      </footer>
    </main>
  );
}
