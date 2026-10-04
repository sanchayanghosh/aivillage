import type { NodeType } from "./types";

export const TYPE_COLOR: Record<NodeType, string> = {
  AGENT: "#2f6fb5", CLAIM: "#7a4fb0", ATTEMPT: "#c47a12", OBSERVATION: "#1c8c7a", ARTIFACT: "#5f6b78", CORRECTION: "#c0392b", CLUSTER: "#2f6fb5",
};
export const TYPE_LABEL: Record<NodeType, string> = {
  AGENT: "Agent", CLAIM: "Claim", ATTEMPT: "Attempt", OBSERVATION: "Observation", ARTIFACT: "Artifact", CORRECTION: "Correction", CLUSTER: "Endorsement Cluster",
};
const P: Record<NodeType, string> = {
  AGENT: `<circle cx="16" cy="11" r="5"/><path d="M6 27c0-6 4-9 10-9s10 3 10 9z"/>`,
  CLAIM: `<path d="M6 8h20v13H15l-6 5v-5H6z"/><path d="M11 13h10M11 17h6" stroke="#fff" stroke-width="2" fill="none"/>`,
  ATTEMPT: `<path d="M10 5l15 11-15 11z"/>`,
  OBSERVATION: `<path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16z"/><circle cx="16" cy="16" r="4" fill="#fff"/>`,
  ARTIFACT: `<path d="M7 3h13l6 6v20H7z"/><path d="M20 3v6h6" stroke="#fff" stroke-width="2" fill="none"/>`,
  CORRECTION: `<path d="M16 3l14 25H2z"/><path d="M16 12v8M16 23v2" stroke="#fff" stroke-width="2.4" fill="none"/>`,
  CLUSTER: `<circle cx="11" cy="12" r="4.5"/><circle cx="22" cy="12" r="4.5"/><circle cx="16.5" cy="21" r="4.5"/>`,
};
export const iconSvg = (t: NodeType, color = TYPE_COLOR[t], size = 32) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><g fill="${color}">${P[t]}</g></svg>`;
export const iconUri = (t: NodeType) => "data:image/svg+xml;utf8," + encodeURIComponent(iconSvg(t));
