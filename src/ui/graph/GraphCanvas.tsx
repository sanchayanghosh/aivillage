import { useEffect, useRef } from "react";
import cytoscape, { Core } from "cytoscape";
import type { GNode, GEdge } from "./types";
import { iconUri, TYPE_COLOR } from "./icons";

const POS: Record<string, [number, number]> = {
  agent_a: [120, 260], claim_1: [380, 120], claim_2: [380, 260], claim_3: [380, 400],
  att_1: [120, 440], obs_1: [120, 590], att_2: [330, 560], obs_2: [540, 520], art_csv: [620, 330], art_tpl: [540, 660],
  agent_b: [640, 90], cluster_1: [700, 190], agent_d: [880, 130], agent_e: [900, 210], agent_f: [880, 290],
  corr_1: [860, 440], agent_c: [1010, 520], claim_4: [1040, 380], obs_q: [1190, 440],
};
for (const k in POS) POS[k] = [POS[k][0] * 0.78, POS[k][1] * 0.7];
const VC = { SUPPORTED: "#1f9d55", CONTRADICTED: "#d03a2f", UNRESOLVED: "#d99a1d" } as const;

export interface Handle { cy: Core }
interface Props {
  nodes: GNode[]; edges: GEdge[]; selected: string | null; hidden: Set<string>; showSemantic: boolean; showLater: boolean; layout: string; expanded: boolean; fitTick: number; zoomTick: { n: number; dir: 1 | -1 | 0 };
  onSelect: (id: string | null) => void; onToggleCluster: () => void; onReady: (cy: Core) => void;
}

export default function GraphCanvas(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | undefined>(undefined);
  const cb = useRef(p); cb.current = p;

  useEffect(() => {
    const cy = cytoscape({
      container: el.current!, wheelSensitivity: 0.25, minZoom: 0.3, maxZoom: 2.5, boxSelectionEnabled: true,
      elements: [
        ...p.nodes.map(n => ({ group: "nodes" as const, data: { ...n, vcolor: n.verdict ? VC[n.verdict] : "#fff", icon: iconUri(n.nodeType), tcolor: TYPE_COLOR[n.nodeType] }, position: { x: (POS[n.id] ?? [0, 0])[0], y: (POS[n.id] ?? [0, 0])[1] }, classes: n.nodeType.toLowerCase() })),
        ...p.edges.map(e => ({ group: "edges" as const, data: { ...e, label: e.edgeType.replaceAll("_", " ") }, classes: e.basis.toLowerCase() })),
      ],
      style: [
        { selector: "node", style: { width: 56, height: 56, shape: "ellipse", "background-color": "#fff", "border-width": 2.5, "border-color": "data(tcolor)", "background-image": "data(icon)", "background-width": "58%", "background-height": "58%", label: "data(label)", "font-family": "Public Sans", "font-size": 12, color: "#26323f", "text-valign": "bottom", "text-margin-y": 7, "text-wrap": "wrap", "text-max-width": "120px", "text-background-color": "#fff", "text-background-opacity": 0.85, "text-background-padding": "2px", "overlay-opacity": 0 } as any },
        { selector: "node.claim", style: { "border-color": "data(vcolor)", "border-width": 4, shape: "round-rectangle", width: 62, height: 48 } as any },
        { selector: "node.cluster", style: { "border-style": "dashed", width: 64, height: 64, "border-width": 3 } as any },
        { selector: "node[?modelAssisted]", style: { "underlay-color": "#e2a400", "underlay-opacity": 0.22, "underlay-padding": 6, "underlay-shape": "ellipse" } as any },
        { selector: "node[?laterEvidence]", style: { "border-style": "dotted" } as any },
        { selector: "node:selected", style: { "overlay-color": "#2f6fb5", "overlay-opacity": 0.18, "overlay-padding": 8, "border-color": "#0b4f9e" } as any },
        { selector: "node.dim", style: { opacity: 0.18 } },
        { selector: "edge", style: { width: 1.6, "line-color": "#9aa6b2", "target-arrow-color": "#9aa6b2", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(label)", "font-size": 9, "font-family": "IBM Plex Mono", color: "#6a7683", "text-rotation": "autorotate", "text-background-color": "#fff", "text-background-opacity": 1, "text-background-padding": "2px", "arrow-scale": 0.9 } as any },
        { selector: "edge.identifier_match", style: { "line-style": "dotted", width: 2 } },
        { selector: "edge.semantic_link", style: { "line-style": "dashed", "line-color": "#b8860b", "target-arrow-color": "#b8860b", color: "#9a6f08" } },
        { selector: "edge[edgeType = 'CONTRADICTED_BY']", style: { "line-color": "#d03a2f", "target-arrow-color": "#d03a2f", color: "#d03a2f", width: 2.4 } },
        { selector: "edge[edgeType = 'SUPPORTED_BY']", style: { "line-color": "#1f9d55", "target-arrow-color": "#1f9d55", color: "#1f9d55", width: 2.4 } },
        { selector: "edge[edgeType = 'CORRECTED_BY']", style: { "line-color": "#c0392b", "target-arrow-color": "#c0392b" } },
        { selector: "edge:selected", style: { "line-color": "#0b4f9e", "target-arrow-color": "#0b4f9e", width: 3.4 } },
        { selector: ".hide", style: { display: "none" } },
      ],
    });
    cy.on("tap", "node", ev => { cb.current.onSelect(ev.target.id()); });
    cy.on("tap", ev => { if (ev.target === cy) cb.current.onSelect(null); });
    cy.on("dbltap", "node.cluster", () => cb.current.onToggleCluster());
    cy.on("mouseover", "node", ev => { const n = ev.target; cy.elements().addClass("dim"); n.closedNeighborhood().removeClass("dim"); });
    cy.on("mouseout", "node", () => cy.elements().removeClass("dim"));
    cyRef.current = cy; p.onReady(cy);
    cy.fit(undefined, 50);
    return () => cy.destroy();
  }, []);

  useEffect(() => {
    const cy = cyRef.current!; cy.batch(() => {
      cy.elements().removeClass("hide");
      p.hidden.forEach(id => cy.getElementById(id).addClass("hide"));
      if (!p.expanded) ["agent_d", "agent_e", "agent_f"].forEach(id => cy.getElementById(id).addClass("hide"));
      if (!p.showSemantic) cy.edges(".semantic_link").addClass("hide");
      if (!p.showLater) cy.nodes("[?laterEvidence]").addClass("hide");
    });
  }, [p.hidden, p.showSemantic, p.showLater, p.expanded]);

  useEffect(() => {
    const cy = cyRef.current!; cy.elements().unselect();
    if (p.selected) cy.getElementById(p.selected).select();
  }, [p.selected]);

  useEffect(() => { cyRef.current?.fit(undefined, 50); }, [p.fitTick]);
  useEffect(() => {
    const cy = cyRef.current!;
    if (p.zoomTick.dir) cy.zoom({ level: cy.zoom() * (p.zoomTick.dir > 0 ? 1.25 : 0.8), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, [p.zoomTick.n]);

  useEffect(() => {
    const cy = cyRef.current!;
    const allPositioned = p.nodes.every((n) => POS[n.id]);
    if (p.layout === "preset" && !allPositioned) { cy.layout({ name: "breadthfirst", directed: true, padding: 50, spacingFactor: 1.2, animate: false } as any).run(); cy.fit(undefined, 50); return; }
    if (p.layout === "preset") { cy.nodes().forEach(n => { const q = POS[n.id()]; if (q) n.position({ x: q[0], y: q[1] }); }); cy.fit(undefined, 50); return; }
    cy.layout({ name: p.layout, animate: true, animationDuration: 500, padding: 50, fit: true, directed: true, spacingFactor: 1.15, nodeDimensionsIncludeLabels: true, roots: cy.getElementById("agent_a").length ? ["agent_a"] : undefined } as any).run();
  }, [p.layout]);

  return <div ref={el} className="canvas" />;
}
