/**
 * The Artifacts the brief of an implementing task reads (src/run.ts, buildBrief), by their name in artifacts.yaml.
 * One list for two uses: the brief builds its context pointers from it, and a Consultation in the build may go only to
 * the owners of what it lists (src/consult.ts, ADR-0013). A pointer the brief adds goes here, so the two never drift.
 *
 *   what  the line the brief prints next to the file; absent for an Artifact the brief carries inline (the requirement
 *         text, the design tokens, the list of ADRs) rather than points at
 *   ui    only for a task that touches the UI
 *   dir   point at the Artifact's folder, not its file (the design direction and its assets)
 */
export interface BriefRead {
  name: string;
  what?: string;
  ui?: true;
  dir?: true;
}

export const BRIEF_READS: readonly BriefRead[] = [
  { name: "constitution", what: "engineering principles every agent follows" },
  { name: "domain-model", what: "glossary, entities, business rules" },
  { name: "architecture", what: "architecture, folder structure, integrations" },
  { name: "requirements", what: "user stories and implementation/testing decisions" },
  // What the upstream Roles designed for this Change, when they ran: binding in names and shapes.
  { name: "data-model-notes", what: "the approved data model: tables, constraints, indexes and the evolution plan (keep every name)" },
  { name: "api-contract-notes", what: "the approved API contract: operations, shapes, errors (keep every name and status code)" },
  { name: "api-contract-openapi", what: "the contract as OpenAPI 3.1, with an example per scenario" },
  { name: "program-design", what: "the approved Program Design: the files and the main signatures and contracts (code that differs from it is a Deviation)" },
  { name: "test-plan", what: "the test cases of each scenario and the layer that proves each" },
  { name: "user-journeys", what: "user kinds, journeys and the usability requirements (U1, U2...) the UI must meet", ui: true },
  { name: "design-direction", what: "design direction and assets (UI task)", ui: true, dir: true },
  // carried inline by the brief
  { name: "delta-specs" },
  { name: "decisions-architecture" },
  { name: "decisions-domain" },
  { name: "design-tokens", ui: true },
];
