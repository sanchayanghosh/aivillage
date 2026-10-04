import { useState } from "react";
import { getKeys, setKeys } from "../studio/keys";
import { actions } from "../studio/actions";
import { useStudio } from "../studio/store";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const status = useStudio((s) => s.status);
  const cur = getKeys();
  const [openai, setOpenai] = useState(cur.openai ?? "");
  const [typesafe, setTypesafe] = useState(cur.typesafe ?? "");
  const save = () => { setKeys({ openai: openai.trim() || undefined, typesafe: typesafe.trim() || undefined }); void actions.refreshServer(); onClose(); };
  const clear = () => { setKeys({}); setOpenai(""); setTypesafe(""); void actions.refreshServer(); };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px,94vw)" }} onClick={(e) => e.stopPropagation()}>
        <header><b>API keys</b><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body">
          <p className="hint">The server already has default keys{status?.llm.configured ? " (OpenAI is configured)" : ""}. Add your own to use them instead. They stay in this browser and are sent with each request over HTTPS. The server uses them for that request and does not store them.</p>
          <label className="keyrow">OpenAI API key
            <input type="password" autoComplete="off" value={openai} onChange={(e) => setOpenai(e.target.value)} placeholder="sk-…  (agent, report writing, replay rollouts)" /></label>
          <label className="keyrow">TypeSafe (Jev) API key
            <input type="password" autoComplete="off" value={typesafe} onChange={(e) => setTypesafe(e.target.value)} placeholder="optional  (Semantic Judge)" /></label>
          <p className="hint">Semantic Judge: {status?.judge.provider === "jev" ? `Jev (${status.judge.model})` : status?.judge.provider === "openai" ? `OpenAI fallback (${status.judge.model}). Add a Jev key to use Jev.` : "no judge configured"}. Everything else uses OpenAI.</p>
        </div>
        <footer><button className="btn" onClick={clear}>Clear my keys</button><span className="grow" /><button className="btn primary" style={{ width: "auto", margin: 0 }} onClick={save}>Save</button></footer>
      </div>
    </div>
  );
}
