import Link from "next/link";
import styles from "./home.module.css";

const features = [
  {
    number: "01",
    title: "Check the handoff",
    text: "Match a job to the selected workshop’s recorded machines, tooling and process notes. Put known conflicts and missing evidence in front of people before release.",
  },
  {
    number: "02",
    title: "Guide the difficult work",
    text: "Propose visual instructions where the job is unusually complex. Engineers check the interpretation, correct the steps and approve the guide before anyone scans it.",
  },
  {
    number: "03",
    title: "Keep questions attached",
    text: "A QR on the drawing opens the released phone guide. Questions and flags return with the exact job, guide version and operation attached.",
  },
];

const stages = [
  ["Engineer", "Upload the drawing and model, then choose the receiving facility."],
  ["Workshop", "Confirm the equipment and process details that apply to this job."],
  ["Review", "Check the proposed guide and resolve gaps before publishing."],
  ["Floor", "Scan, inspect the difficult step, ask or flag it in context."],
];

export default function HomePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Chappe home">
          <span className={styles.brandMark} aria-hidden="true">C</span>
          <span>Chappe</span>
        </Link>
        <nav className={styles.topnav} aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#workflow">How it works</a>
          <Link href="/demo">Explore prepared demo</Link>
          <Link href="/login">Sign in</Link>
          <Link className={styles.navCta} href="/signup">Create account</Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Engineering to workshop, without lost context</p>
          <h1 id="hero-title">Make complex work clear before it reaches the floor.</h1>
          <p className={styles.lede}>
            Chappe turns engineering files into a reviewed, scan-ready guide for the operations that need extra explanation. The selected workshop’s recorded capabilities and the engineer’s approval stay in the loop.
          </p>
          <div className={styles.heroActions}>
            <Link className="button button--primary" href="/demo">Explore prepared demo <span aria-hidden="true">↗</span></Link>
            <Link className="button button--secondary" href="/signup">Create an account <span aria-hidden="true">→</span></Link>
          </div>
          <p className={styles.heroNote}>The prepared example is labelled throughout. Live workspace data requires sign-in.</p>
        </div>
        <div className={styles.heroDiagram} aria-label="Engineering handoff stages">
          <div className={styles.diagramHeader}><span>One job · shared context</span><span className={styles.liveDot} aria-hidden="true" /></div>
          <div className={styles.diagramRow}><span className={styles.diagramIndex}>01</span><div><strong>Engineering packet</strong><small>Drawing + model + selected facility</small></div><span className={styles.diagramArrow} aria-hidden="true">↓</span></div>
          <div className={styles.diagramRow}><span className={styles.diagramIndex}>02</span><div><strong>Capability and guide review</strong><small>Known constraints · unknowns · approval</small></div><span className={styles.diagramArrow} aria-hidden="true">↓</span></div>
          <div className={styles.diagramRow}><span className={styles.diagramIndex}>03</span><div><strong>QR-linked floor guide</strong><small>Complex steps · model · contextual help</small></div><span className={styles.diagramArrow} aria-hidden="true">↶</span></div>
          <p className={styles.diagramFooter}>A question returns to the engineer with its exact operation and release.</p>
        </div>
      </section>

      <section id="features" className={styles.section} aria-labelledby="features-title">
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>Why Chappe</p><h2 id="features-title">A clearer handoff at each decision.</h2><p>The guide is a focused reference for difficult work. Experienced operators keep doing the routine work they already know.</p></div>
        <div className={styles.featureGrid}>{features.map((feature) => (
          <article className={styles.featureCard} key={feature.number}><span className={styles.featureNumber}>{feature.number}</span><h3>{feature.title}</h3><p>{feature.text}</p></article>
        ))}</div>
      </section>

      <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>The workflow</p><h2 id="workflow-title">One path from design intent to a useful answer.</h2></div>
        <ol className={styles.stageList}>{stages.map(([title, description], index) => (
          <li key={title}><span className={styles.stageNumber}>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{description}</p></div></li>
        ))}</ol>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <div><p className={styles.eyebrow}>A precise, reviewable handoff</p><h2 id="closing-title">Give the floor clarity. Give engineering the context to respond.</h2></div>
        <Link className="button button--primary" href="/demo">Open the prepared demo <span aria-hidden="true">↗</span></Link>
      </section>

      <footer className={styles.footer}>
        <div><strong>Chappe</strong><p>Prototype manufacturing handoff.</p></div>
        <details className={styles.demoDetails}>
          <summary>Demo source packets</summary>
          <p>These original synthetic sheet-metal examples are for trying the current prototype. Downloads do not create a job or claim a live AI run.</p>
          <div className={styles.demoPackets}>
            <div><strong>Rev A · SKW-SM-104</strong><a href="/demo/sensor-mount-alpha.drawing.pdf" download>Drawing PDF</a><a href="/demo/sensor-mount-alpha.final.glb" download>Final GLB</a><a href="/demo/sensor-mount-alpha.bend.json" download>Bend manifest</a></div>
            <div><strong>Rev B · SKW-SM-205</strong><a href="/demo/sensor-mount-bravo.drawing.pdf" download>Drawing PDF</a><a href="/demo/sensor-mount-bravo.final.glb" download>Final GLB</a><a href="/demo/sensor-mount-bravo.bend.json" download>Bend manifest</a></div>
          </div>
        </details>
        <p className={styles.prototypeNote}>Current interactive guide examples support straight-bend sheet metal. Facility checks surface documented conflicts and unknowns; they do not certify physical manufacturability.</p>
      </footer>
    </main>
  );
}
