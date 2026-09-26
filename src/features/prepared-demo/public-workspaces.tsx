import Image from "next/image";
import Link from "next/link";
import { preparedParts, type PreparedPart } from "./public-data";
import { SourceFileStaging } from "./source-file-staging";
import styles from "./public-workspaces.module.css";

function PublicHeader({ engineeringActive = false }: { engineeringActive?: boolean }) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Chappe home">
        <span className={styles.mark} aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M18 31V9m0 0L7 5m11 4 11-4M7 5v6m22-6v6" /><circle cx="18" cy="9" r="2.2" /></svg></span><span>Chappe</span>
      </Link>
      <nav aria-label="Demo workspaces">
        <Link aria-current={engineeringActive ? "page" : undefined} href="/studio">Engineering</Link>
      </nav>
      <span className={styles.demoTag}>Public demo · Steel Bracket</span>
    </header>
  );
}

function Status({ children }: { children: string }) {
  return <span className={styles.status}><i aria-hidden="true" />{children}</span>;
}

function Intro({ eyebrow, title, text, engineeringActive = false }: { eyebrow: string; title: string; text: string; engineeringActive?: boolean }) {
  return <>
    <PublicHeader engineeringActive={engineeringActive} />
    <div className={styles.intro}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1>{title}</h1>
      <p className={styles.introText}>{text}</p>
      <p className={styles.disclaimer}>Focused local demo · QR drawing and guide are for review · no facility, approval, or manufacturing status has been supplied</p>
    </div>
  </>;
}

function PartLink({ part }: { part: PreparedPart }) {
  return <Link className={styles.openLink} href={`/studio/jobs/${part.id}`}>Open Steel Bracket <span aria-hidden="true">↗</span></Link>;
}

export function EngineeringWorkspace() {
  return <main className={styles.shell}>
    <Intro engineeringActive eyebrow="01 / engineering workspace" title="Focus the handoff around one part." text="The Steel Bracket brings a QR-enabled drawing, source references, a review guide, and unresolved decisions into one focused packet." />
    <SourceFileStaging />
    <section className={styles.tableSection} aria-labelledby="engineering-list-title">
      <div className={styles.sectionHeading}><h2 id="engineering-list-title">Focused demo packet</h2><span>{String(preparedParts.length).padStart(2, "0")} active part</span></div>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>Part</th><th>Drawing</th><th>Demo assets</th><th>Facility context</th><th>Review</th><th>Next action</th><th><span className={styles.srOnly}>Open</span></th></tr></thead>
        <tbody>{preparedParts.map((part) => <tr key={part.id}>
          <td><strong>{part.name}</strong><small>{part.project}</small></td>
          <td className={styles.code}>{part.drawingId}<small>Revision {part.revision}</small></td>
          <td>{part.evidence.length} review items<small>{part.evidence.join(" · ")}</small></td>
          <td>{part.facility}<small>{part.machine}</small></td>
          <td><Status>{part.state}</Status></td>
          <td>{part.nextAction}</td>
          <td><PartLink part={part} /></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <p className={styles.bottomNote}>The QR drawing and guide are demo aids based on the supplied source file. They do not indicate a selected shop, confirmed capability, or approved manufacturing instruction.</p>
  </main>;
}

export function ManufacturingWorkspace() {
  return <main className={styles.shell}>
    <Intro eyebrow="02 / manufacturing workspace" title="See the Steel Bracket handoff." text="Open the QR-enabled drawing, review the step sequence, and use the shop view to ask simple drawing-based questions while unresolved manufacturing details remain visible." />
    <section className={styles.tableSection} aria-labelledby="manufacturing-list-title">
      <div className={styles.sectionHeading}><h2 id="manufacturing-list-title">Incoming demo handoff</h2><span>{String(preparedParts.length).padStart(2, "0")} active part</span></div>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>Part / revision</th><th>Facility / equipment</th><th>Readiness / evidence</th><th>Question to resolve</th><th>Next action</th><th><span className={styles.srOnly}>Open</span></th></tr></thead>
        <tbody>{preparedParts.map((part) => <tr key={part.id}>
          <td><strong>{part.name}</strong><small className={styles.code}>{part.drawingId} · Revision {part.revision}</small></td>
          <td>{part.facility}<small>{part.machine}</small></td>
          <td><Status>{part.state}</Status><small>{part.readiness}</small><small>Evidence: {part.evidence.join(" · ")}</small></td>
          <td>{part.openQuestion}</td>
          <td>{part.nextAction}</td>
          <td><PartLink part={part} /></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <p className={styles.bottomNote}>No facility profile, selected equipment, work sequence approval, or shop acceptance is present in this focused demo handoff.</p>
  </main>;
}

export function PreparedPartDetail({ part }: { part: PreparedPart }) {
  return <main className={`${styles.shell} ${styles.detailShell}`}>
    <PublicHeader engineeringActive />
    <div className={styles.detailTop}>
      <p className={styles.eyebrow}>Focused demo packet · {part.project}</p>
      <h1>{part.name}</h1>
      <p className={styles.detailMeta}><span>{part.drawingId}</span><span>Revision {part.revision}</span><Status>{part.state}</Status></p>
    </div>
    <div className={styles.detailGrid}>
      <section className={styles.drawingPanel} aria-label="Steel Bracket QR-enabled drawing">
        <div className={styles.panelBar}><span>01 / QR-enabled demo drawing</span><span>PDF · scan to open shop view</span></div>
        <a href={part.drawingPdf} target="_blank" rel="noreferrer" className={styles.drawingLink} aria-label={`Open ${part.name} QR-enabled drawing`}>
          <Image src={part.drawingPreview} alt={part.drawingAlt} width={2382} height={1684} priority />
        </a>
        <div className={styles.sourceActions}>
          <a href={part.drawingPdf} target="_blank" rel="noreferrer">Open QR-enabled drawing <span aria-hidden="true">↗</span></a>
          <a href={part.sourcePdf} target="_blank" rel="noreferrer">Open original source PDF <span aria-hidden="true">↗</span></a>
          <a href={part.qrTarget}>Open shop QR destination <span aria-hidden="true">↗</span></a>
          <a href={part.modelStl} download={part.modelFileName}>Download source STL <span aria-hidden="true">↓</span></a>
        </div>
        <div className={styles.qrReadout}>
          <Image src={part.qrCodeImage} alt={`QR code that opens the Steel Bracket shop view`} width={120} height={120} />
          <div><strong>Phone demo QR</strong><span>Scan the QR sticker from any phone connection to open the interactive shop view.</span><a href={part.qrTarget}>{part.qrTarget}<span aria-hidden="true"> ↗</span></a></div>
        </div>
        <p>Original local source files remain available beside the QR-enabled demo copy. The STL is a visual reference; the demo guide is available in the interactive shop view.</p>
      </section>
      <aside className={styles.contextPanel}>
        <div className={styles.panelBar}><span>02 / review context</span><span>Demo focus</span></div>
        <dl>
          <div><dt>Drawing ID</dt><dd>{part.drawingId}</dd></div>
          <div><dt>Revision note</dt><dd>{part.revisionNote}</dd></div>
          <div><dt>Facility</dt><dd>{part.facility}</dd></div>
          <div><dt>Equipment</dt><dd>{part.machine}</dd></div>
          <div><dt>Readiness</dt><dd>{part.readiness}</dd></div>
          <div><dt>Open question</dt><dd>{part.openQuestion}</dd></div>
          <div><dt>Next action</dt><dd>{part.nextAction}</dd></div>
        </dl>
        <h2>Drawing facts for the demo</h2>
        <ul className={styles.operations}>{part.sourceFacts.map((fact, index) => <li key={fact}><span>{String(index + 1).padStart(2, "0")}</span>{fact}</li>)}</ul>
        <Link href={`/parts/${part.id}`} className={styles.phoneLink}>Open interactive shop guide <span aria-hidden="true">↗</span></Link>
      </aside>
    </div>
    <p className={styles.bottomNote}>The QR drawing, chat answers, and guide are local demo material. Confirm the revision, material, finish, manufacturing route, and facility before real work begins.</p>
  </main>;
}
