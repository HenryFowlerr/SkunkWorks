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
        .welcome-identity { max-width: 700px; display: grid; gap: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: rgb(255 254 250 / 62%); padding: 16px 19px; }
        .identity-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 3px; font-size: .78rem; font-weight: 630; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
        .identity-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: .81rem; }
        .identity-row .mono { font-size: .8rem; }
        .identity-rule { height: 1px; background: var(--line); }
        .welcome-footer { display: flex; align-items: center; gap: 12px; margin-top: 45px; color: var(--ink-muted); font-size: .7rem; letter-spacing: .02em; }
        .footer-line { width: 35px; height: 1px; background: var(--line-strong); }
        @media (max-width: 520px) { .welcome-shell { padding-inline: 21px; } .welcome-topbar > .eyebrow { font-size: .62rem; } .welcome-content h1 { max-width: 350px; font-size: clamp(3rem, 16vw, 4.3rem); } .identity-row { align-items: flex-start; flex-direction: column; gap: 3px; } .welcome-footer { flex-wrap: wrap; margin-top: 26px; } }
      `}</style>
    </main>
  );
}
