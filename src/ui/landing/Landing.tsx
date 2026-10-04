import { useEffect, useRef, useState, type ReactNode } from "react";
import "./landing.css";

const GH = "https://github.com/sanchayanghosh/aivillage/tree/ui/maltego-evidence-workbench";

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".lp .reveal");
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/** Card with a cursor-following spotlight. */
function Spot({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`spot ${className}`}
      onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); ref.current!.style.setProperty("--x", `${e.clientX - r.left}px`); ref.current!.style.setProperty("--y", `${e.clientY - r.top}px`); }}>
      {children}
    </div>
  );
}

function Board() {
  return (
    <svg className="board" viewBox="0 0 520 440" role="img" aria-label="Evidence board: a claim linked by red string to an observation that contradicts it">
      <defs>
        <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" /><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .35  0 0 0 .12 0" /></filter>
      </defs>
      {/* strings */}
      <path className="string s1" d="M118 96 C 210 60, 300 70, 392 108" />
      <path className="string s2" d="M118 96 C 90 200, 120 260, 150 320" />
      <path className="string s3" d="M392 108 C 420 200, 360 280, 330 332" />
      <path className="string s4 dash" d="M150 320 C 220 380, 280 380, 330 350" />
      {/* cards */}
      <g className="note n1" transform="translate(40 52) rotate(-3)"><rect width="160" height="82" rx="3" /><rect width="160" height="82" rx="3" filter="url(#paper)" /><text x="14" y="24" className="k">CLAIM · 10:42</text><text x="14" y="48" className="t">“Exported 93</text><text x="14" y="66" className="t">contacts.”</text><circle cx="80" cy="-2" r="6" className="pin" /></g>
      <g className="note n2" transform="translate(318 70) rotate(2.5)"><rect width="150" height="80" rx="3" /><rect width="150" height="80" rx="3" filter="url(#paper)" /><text x="14" y="24" className="k">AGENT B · 10:44</text><text x="14" y="48" className="t">“Endorsing,</text><text x="14" y="66" className="t">sending now.”</text><circle cx="75" cy="-2" r="6" className="pin" /></g>
      <g className="note n3" transform="translate(70 300) rotate(2)"><rect width="170" height="82" rx="3" /><rect width="170" height="82" rx="3" filter="url(#paper)" /><text x="14" y="24" className="k">OBSERVATION · 10:41</text><text x="14" y="48" className="t">contacts.csv</text><text x="14" y="66" className="t">0 data rows</text><circle cx="85" cy="-2" r="6" className="pin" /></g>
      <g className="note n4" transform="translate(290 318) rotate(-2)"><rect width="150" height="76" rx="3" /><rect width="150" height="76" rx="3" filter="url(#paper)" /><text x="14" y="24" className="k">AGENT C · 10:51</text><text x="14" y="48" className="t">“STOP. File is</text><text x="14" y="64" className="t">empty.”</text><circle cx="75" cy="-2" r="6" className="pin" /></g>
      <g className="stamp" transform="translate(262 196) rotate(-11)"><rect x="-82" y="-22" width="164" height="44" rx="4" /><text y="8" textAnchor="middle">CONTRADICTED</text></g>
    </svg>
  );
}

const SCENARIOS = [
  { id: "retry", label: "Failed, then retried and worked", events: [["10:38", "obs", "Export returned 0 rows"], ["10:40", "obs", "Retry wrote 93 rows to contacts.csv"], ["10:42", "claim", "“Exported 93 contacts.”"]], verdict: "SUPPORTED", why: "The latest observation before the claim shows 93 rows. The earlier failure is context, not a contradiction." },
  { id: "wrong", label: "Worked, then the file was replaced", events: [["10:38", "obs", "Export wrote 93 rows"], ["10:40", "obs", "Template copied over it, 0 data rows"], ["10:42", "claim", "“Exported 93 contacts.”"]], verdict: "CONTRADICTED", why: "The latest observation before the claim shows an empty file. Nothing after the claim can change this." },
  { id: "none", label: "Nothing recorded the result", events: [["10:38", "obs", "Opened the export page"], ["10:42", "claim", "“Exported 93 contacts.”"]], verdict: "UNRESOLVED", why: "No observation speaks to the claim. Three other agents repeating it would not change that." },
] as const;

function VerdictRule() {
  const [i, setI] = useState(1);
  const s = SCENARIOS[i];
  return (
    <div className="rule">
      <div className="tabs" role="tablist">{SCENARIOS.map((x, n) => <button key={x.id} role="tab" aria-selected={n === i} className={n === i ? "on" : ""} onClick={() => setI(n)}>{x.label}</button>)}</div>
      <ol className="tl">{s.events.map(([t, k, text]) => <li key={t + text} className={k}><time>{t}</time><span>{text}</span><em>{k === "claim" ? "claim" : "observation"}</em></li>)}</ol>
      <div className={`out v-${s.verdict.toLowerCase()}`}><b>{s.verdict}</b><p>{s.why}</p></div>
    </div>
  );
}

const FORMATS = ["Episode JSONL", "OpenAI chat", "Anthropic blocks", "Plain text logs", "Generic JSON", "tool_calls", "thinking blocks", "stdout / exit codes", "[09:03] agent-a: …"];

export default function Landing() {
  useReveal();
  const [playing, setPlaying] = useState(false);
  const [noVideo, setNoVideo] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  return (
    <div className="lp">
      <div className="grain" aria-hidden />
      <header className="nav">
        <a className="logo" href="/"><span className="mark"><svg viewBox="0 0 32 32" width="16" height="16"><circle cx="8" cy="9" r="3.4" /><circle cx="24" cy="9" r="3.4" /><circle cx="16" cy="24" r="3.4" /><path d="M8 9l8 15 8-15M8 9h16" /></svg></span>Swarm Evidence Graph</a>
        <nav><a href="#demo">Demo</a><a href="#problem">Problem</a><a href="#how">How it works</a><a href="#rule">The rule</a><a href={GH} target="_blank" rel="noreferrer">GitHub</a></nav>
        <a className="btn solid" href="/app">Open the workbench →</a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">For the AI Swarm Dynamics hackathon</p>
          <h1>Check what the swarm said against what it did.</h1>
          <p className="lede">Agents report to each other in chat. “Exported 93 contacts.” “Endorsing, sending now.” Nobody opened the file. This workbench takes any agent transcript, finds every claim, and checks each one against the tool results recorded before it.</p>
          <div className="cta-row">
            <a className="btn solid big" href="/app">Start an investigation</a>
            <a className="btn ghost big" href="#demo">Watch the demo</a>
          </div>
          <p className="fine">Paste your own transcript, or open the sample incident. Runs on your data. No account.</p>
        </div>
        <div className="hero-art"><Board /></div>
      </section>

      <section id="demo" className="demo reveal">
        <div className="demo-head"><p className="eyebrow">The real app, recorded</p><h2>From a pasted transcript to a verdict in under a minute.</h2></div>
        <div className="screen">
          <div className="bar"><i /><i /><i /><span>swarm-evidence-graph.vercel.app/app</span></div>
          {noVideo ? <img className="poster" src="/demo/poster.jpg" alt="The workbench with a transcript loaded" /> : (
          <video ref={vid} controls preload="metadata" poster="/demo/poster.jpg" playsInline onPlay={() => setPlaying(true)}>
            <source src="/demo/demo.mp4" type="video/mp4" onError={() => setNoVideo(true)} />
          </video>)}
          {!playing && !noVideo && <button className="play" onClick={() => vid.current?.play()} aria-label="Play demo"><span>▶</span></button>}
        </div>
        <ol className="chapters"><li>Paste a transcript</li><li>Read the evidence graph</li><li>Ask the agent to rearrange it</li><li>Run Step 2 forensics</li><li>Get the verbose report</li></ol>
      </section>

      <section id="problem" className="problem">
        <div className="reveal"><p className="eyebrow">The problem</p><h2>Swarms vouch for each other, and nobody checks.</h2></div>
        <div className="cards">
          {[
            ["01", "A chat message is testimony.", "When three agents repeat “the list is ready”, it looks like confirmation. It is one claim said three times. Repetition adds no evidence."],
            ["02", "The proof is somewhere else.", "The thing that settles a claim is a screenshot, a file size or a stdout line, often in another table and with no exit code. Keyword search for “done” finds the claim and misses the proof."],
            ["03", "A mismatch has several causes.", "A broken tool, a vague goal, a copied claim and deliberate misreporting all produce the same message. A good tool lists the benign explanation next to the scary one."],
          ].map(([n, h, p]) => (
            <Spot key={n} className="card reveal"><span className="num">{n}</span><h3>{h}</h3><p>{p}</p></Spot>
          ))}
        </div>
      </section>

      <section id="how" className="how">
        <div className="reveal"><p className="eyebrow">How it works</p><h2>Two steps, one agent that can drive both.</h2></div>
        <div className="bento">
          <Spot className="b b1 reveal"><span className="tag">Step 1</span><h3>Investigation</h3><p>Records become a graph of agents, claims, attempts, observations and artifacts. Each claim gets a verdict. Links show whether they were recorded, matched by identifier, or inferred.</p><div className="chips"><i className="c sup">SUPPORTED</i><i className="c con">CONTRADICTED</i><i className="c unr">UNRESOLVED</i></div></Spot>
          <Spot className="b b2 reveal"><span className="tag">Step 2</span><h3>Model forensics</h3><p>Reads the agent’s reasoning next to its public report, then writes competing hypotheses. At least one is benign. It designs the test that would tell them apart.</p></Spot>
          <Spot className="b b3 reveal"><span className="tag">Agent</span><h3>A studio agent that can use every control</h3><p>A libfx agent runs in your browser as WebAssembly. It sees the live state, selects entities, filters, changes layouts, confirms verdicts, runs Step 2 and writes the report.</p></Spot>
          <Spot className="b b4 reveal"><span className="tag">Semantic Judge</span><h3>Fixed questions, cached answers</h3><p>Exact filters pick the rows. A model answers one fixed question about them, such as “does this message say the task is finished?”. Answers are stored with the model and input hash, so a second run gives the same leads.</p></Spot>
          <Spot className="b b5 reveal"><span className="tag">Any transcript</span><h3>Bring your own</h3><p>No schema to learn. The importer detects the format and tells you what it could not read.</p>
            <div className="marquee" aria-hidden><div>{[...FORMATS, ...FORMATS].map((f, i) => <span key={i}>{f}</span>)}</div></div></Spot>
        </div>
      </section>

      <section id="rule" className="ruleSec">
        <div className="reveal"><p className="eyebrow">The one rule</p><h2>The latest observation before the claim decides.</h2><p className="sub">Pick a situation. Retries do not flip a true claim, and a later abort cannot rewrite what was true at the time.</p></div>
        <div className="reveal"><VerdictRule /></div>
      </section>

      <section className="principles">
        <div className="reveal"><p className="eyebrow">What it will not do</p><h2>Rules the tool keeps even when you would rather it did not.</h2></div>
        <ul className="plist reveal">
          <li><b>It never calls an agent deceptive.</b> Reasoning traces suggest hypotheses. They do not prove motive.</li>
          <li><b>A model answer never sets a verdict.</b> It can raise a lead or propose a link, and those stay marked MODEL_ASSISTED until you confirm them.</li>
          <li><b>It says when it cannot check.</b> A transcript with no tool results gets UNRESOLVED everywhere, and the import report tells you why.</li>
          <li><b>Controls stay in the queue.</b> Ordinary, working coordination is shown next to the anomalies.</li>
        </ul>
      </section>

      <section className="final reveal">
        <h2>Open it with an empty desk, or with your own transcript.</h2>
        <div className="cta-row"><a className="btn solid big" href="/app">Start an investigation</a><a className="btn ghost big" href={GH} target="_blank" rel="noreferrer">Read the code</a></div>
      </section>

      <footer>
        <span>Built for the AI Swarm Dynamics hackathon by AI Village and Grove Research. Data model follows the AI Village transcript database.</span>
        <a href="https://aivillageblog.substack.com/p/join-the-ai-swarm-dynamics-hackathon" target="_blank" rel="noreferrer">About the hackathon ↗</a>
      </footer>
    </div>
  );
}
