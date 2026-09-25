import Link from "next/link";

export default function HomePage() {
  return (
    <main className="welcome-shell">
      <header className="welcome-topbar">
        <Link className="brand-lockup" href="/" aria-label="SkunkWorks home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SkunkWorks</span>
        </Link>
        <span className="eyebrow">Prototype handoff</span>
      </header>

      <section className="welcome-content" aria-labelledby="welcome-title">
        <p className="eyebrow">Drawing → workshop → floor</p>
        <h1 id="welcome-title">Keep every bend in view.</h1>
        <p className="welcome-copy">
          Turn a numbered sheet-metal drawing into a workshop-reviewed visual guide,
          then carry the same bend identity onto the factory floor and back.
        </p>
        <div className="welcome-actions">
          <Link className="button button--primary" href="/login">Sign in <span aria-hidden="true">↗</span></Link>
          <Link className="button button--secondary" href="/studio">Open designer desk <span aria-hidden="true">→</span></Link>
        </div>
        <p className="welcome-note">Early prototype · A reviewed guide is a reference, not a machine-control instruction.</p>
      </section>

      <section className="demo-access" aria-labelledby="demo-access-title">
        <div>
          <p className="eyebrow">Original synthetic inputs</p>
          <h2 id="demo-access-title">Explore the authored sample packets</h2>
          <p>Each packet includes its matching drawing, final model and bend manifest. They are source files for a real job upload; downloading them does not create a job or claim a live AI run.</p>
        </div>
        <div className="demo-packets">
          <article className="demo-packet">
            <h3>Sensor mount · SKW-SM-104 · Rev A</h3>
            <nav aria-label="Sensor mount revision A sample files">
              <a href="/demo/sensor-mount-alpha.drawing.pdf" download>Rev A · Drawing PDF</a>
              <a href="/demo/sensor-mount-alpha.final.glb" download>Rev A · Final GLB model</a>
              <a href="/demo/sensor-mount-alpha.bend.json" download>Rev A · Bend manifest</a>
            </nav>
          </article>
          <article className="demo-packet">
            <h3>Sensor mount · SKW-SM-205 · Rev B</h3>
            <nav aria-label="Sensor mount revision B sample files">
              <a href="/demo/sensor-mount-bravo.drawing.pdf" download>Rev B · Drawing PDF</a>
              <a href="/demo/sensor-mount-bravo.final.glb" download>Rev B · Final GLB model</a>
              <a href="/demo/sensor-mount-bravo.bend.json" download>Rev B · Bend manifest</a>
            </nav>
          </article>
        </div>
      </section>

      <aside className="welcome-identity" aria-label="Bend identity example">
        <div className="identity-heading"><span className="status-dot" /> Sample bend identity</div>
        <div className="identity-row"><span className="eyebrow">Drawing</span><span className="mono">B4 · 92° internal</span></div>
        <div className="identity-rule" aria-hidden="true" />
        <div className="identity-row"><span className="eyebrow">Guide</span><span className="mono">Step 2 of 4 · Bend B4</span></div>
        <div className="identity-rule" aria-hidden="true" />
        <div className="identity-row"><span className="eyebrow">Floor note</span><span className="mono">B4 · clarification linked</span></div>
      </aside>

      <footer className="welcome-footer">
        <span>Prototype programmes</span>
        <span className="footer-line" aria-hidden="true" />
        <span>Source-led · workshop-aware</span>
      </footer>

      <style>{`
        .welcome-shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto auto; padding: clamp(20px, 4vw, 52px) clamp(20px, 7vw, 104px) 28px; }
        .welcome-topbar { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 17px; }
        .brand-lockup { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-size: .94rem; font-weight: 650; letter-spacing: -.02em; }
        .brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--ink); border-radius: 8px; font-family: ui-monospace, monospace; font-size: .82rem; }
        .welcome-content { align-self: center; max-width: 770px; padding: clamp(58px, 9vw, 112px) 0 clamp(52px, 8vw, 92px); }
        .welcome-content h1 { max-width: 700px; margin: 19px 0 20px; font-size: clamp(3.2rem, 8.2vw, 7rem); line-height: .98; letter-spacing: -.075em; font-weight: 560; }
        .welcome-copy { max-width: 585px; margin: 0; color: var(--ink-muted); font-size: clamp(1.04rem, 1.6vw, 1.2rem); line-height: 1.65; }
        .welcome-actions { display: flex; flex-wrap: wrap; gap: 11px; margin-top: 30px; }
        .button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 20px; border-radius: var(--radius-sm); padding: 0 17px; text-decoration: none; font-size: .9rem; font-weight: 610; transition: transform .15s ease, background .15s ease; }
        .button:hover { transform: translateY(-1px); }
        .button-primary { background: var(--ink); color: var(--surface); }
        .button-primary:hover { background: #3a4136; }
        .button-secondary { border: 1px solid var(--line-strong); background: var(--surface); }
        .button-secondary:hover { background: var(--surface-muted); }
        .welcome-note { margin: 17px 0 0; color: var(--ink-muted); font-size: .79rem; }
        .demo-access { max-width: 900px; border-top: 1px solid var(--line); padding-top: 20px; }
        .demo-access h2 { margin: 6px 0 7px; font-size: 1.05rem; letter-spacing: -.02em; }
        .demo-access > div:first-child > p:last-child { max-width: 660px; margin: 0; color: var(--ink-muted); font-size: .82rem; line-height: 1.55; }
        .demo-packets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin-top: 14px; }
        .demo-packet { min-width: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 13px; background: rgb(255 254 250 / 62%); }
        .demo-packet h3 { margin: 0 0 10px; font-size: .79rem; font-weight: 640; }
        .demo-packet nav { display: flex; flex-wrap: wrap; gap: 8px 13px; }
        .demo-packet a { min-height: 38px; display: inline-flex; align-items: center; color: var(--ink); font-size: .75rem; text-underline-offset: 3px; }
        .welcome-identity { max-width: 700px; display: grid; gap: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: rgb(255 254 250 / 62%); padding: 16px 19px; }
        .identity-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 3px; font-size: .78rem; font-weight: 630; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
        .identity-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: .81rem; }
        .identity-row .mono { font-size: .8rem; }
        .identity-rule { height: 1px; background: var(--line); }
        .welcome-footer { display: flex; align-items: center; gap: 12px; margin-top: 45px; color: var(--ink-muted); font-size: .7rem; letter-spacing: .02em; }
        .footer-line { width: 35px; height: 1px; background: var(--line-strong); }
        @media (max-width: 620px) { .welcome-shell { padding-inline: 21px; } .welcome-topbar > .eyebrow { font-size: .62rem; } .welcome-content h1 { max-width: 350px; font-size: clamp(3rem, 16vw, 4.3rem); } .demo-packets { grid-template-columns: 1fr; } .demo-packet a { min-height: 44px; } .identity-row { align-items: flex-start; flex-direction: column; gap: 3px; } .welcome-footer { flex-wrap: wrap; margin-top: 26px; } }
      `}</style>
    </main>
  );
}
