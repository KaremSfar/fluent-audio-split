import { MERGE_OUTPUT, type MergeConfig, type NodeInput, type WorkflowNode } from '@/types/workflow';

// Pure graph helpers shared by the canvas. The rules mirror WorkflowGraph.Validate (C#); the
// API is authoritative, this is only fast feedback (and Execute gating).

export const MAX_MERGE_INPUTS = 8;
export const MIN_MERGE_INPUTS = 2;
export const DEFAULT_MODEL = 'htdemucs_ft.yaml';

export interface Issue {
  nodeId: string;
  message: string;
}

export type KeepState = 'kept' | 'default' | 'none';

export type GetStems = (modelName: string) => string[];

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Config helpers ────────────────────────────────────────────────────────────
export function parseConfig<T extends object>(configJson: string): T {
  try {
    const v = JSON.parse(configJson);
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function getModelName(node: Pick<WorkflowNode, 'configJson'>): string {
  return parseConfig<{ modelName?: string }>(node.configJson).modelName ?? DEFAULT_MODEL;
}

export function nodeLabel(node: Pick<WorkflowNode, 'order'>): string {
  return `Node ${node.order + 1}`;
}

// ── Outputs & keep semantics ──────────────────────────────────────────────────
export function getNodeOutputs(node: WorkflowNode, getStems: GetStems): string[] {
  return node.nodeType === 'Merge' ? [MERGE_OUTPUT] : getStems(getModelName(node));
}

export function isConsumed(nodes: WorkflowNode[], nodeId: string, output: string): boolean {
  return nodes.some((n) =>
    n.inputs.some((i) => i.sourceNodeId === nodeId && i.sourceOutputName === output),
  );
}

export function isTerminal(nodes: WorkflowNode[], nodeId: string, output: string): boolean {
  return !isConsumed(nodes, nodeId, output);
}

export function hasExplicitKeeps(nodes: WorkflowNode[]): boolean {
  return nodes.some((n) => n.keptOutputs.length > 0);
}

export function effectiveKeepState(
  nodes: WorkflowNode[],
  nodeId: string,
  output: string,
): KeepState {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return 'none';
  if (node.keptOutputs.includes(output)) return 'kept';
  if (!hasExplicitKeeps(nodes) && isTerminal(nodes, nodeId, output)) return 'default';
  return 'none';
}

export interface KeepSummary {
  mode: 'explicit' | 'default';
  items: { nodeId: string; nodeLabel: string; output: string }[];
}

export function keepSummary(nodes: WorkflowNode[], getStems: GetStems): KeepSummary {
  const explicit = hasExplicitKeeps(nodes);
  const items: KeepSummary['items'] = [];
  for (const n of nodes) {
    const outputs = explicit ? n.keptOutputs : getNodeOutputs(n, getStems).filter((o) => isTerminal(nodes, n.id, o));
    for (const output of outputs) items.push({ nodeId: n.id, nodeLabel: nodeLabel(n), output });
  }
  return { mode: explicit ? 'explicit' : 'default', items };
}

export function toggleKeep(keptOutputs: string[], output: string): string[] {
  return keptOutputs.includes(output)
    ? keptOutputs.filter((o) => o !== output)
    : [...keptOutputs, output];
}

// ── Merge helpers ─────────────────────────────────────────────────────────────
export function inputLabel(
  nodes: WorkflowNode[],
  input: NodeInput,
): string {
  const src = nodes.find((n) => n.id === input.sourceNodeId);
  if (!src) return input.sourceOutputName;
  return `${nodeLabel(src)} · ${input.sourceOutputName === MERGE_OUTPUT ? mergeDisplayName(src, nodes) : input.sourceOutputName}`;
}

function mergeDisplayName(node: WorkflowNode, nodes: WorkflowNode[]): string {
  return parseConfig<MergeConfig>(node.configJson).label?.trim() || defaultMergeLabel(node, nodes, 1);
}

/** Default Merge output name: input stem names joined with " + ". */
export function defaultMergeLabel(node: WorkflowNode, nodes: WorkflowNode[], depth = 0): string {
  const parts = node.inputs.map((i) => {
    const src = nodes.find((n) => n.id === i.sourceNodeId);
    if (src?.nodeType === 'Merge' && depth < 4) return mergeDisplayName(src, nodes);
    return i.sourceOutputName;
  });
  return parts.length ? parts.join(' + ') : 'Mix';
}

export function getMergeGains(configJson: string, count: number): number[] {
  const gains = parseConfig<MergeConfig>(configJson).inputGainsDb ?? [];
  return Array.from({ length: count }, (_, i) => gains[i] ?? 0);
}

/** Drop the gain at `idx` so remaining gains stay aligned with their inputs. */
export function removeGainAt(configJson: string, idx: number): string {
  const cfg = parseConfig<MergeConfig>(configJson);
  if (!cfg.inputGainsDb) return configJson;
  const next = cfg.inputGainsDb.slice();
  if (idx < next.length) next.splice(idx, 1);
  return JSON.stringify({ ...cfg, inputGainsDb: next });
}

// ── Edge model (React Flow independent) ───────────────────────────────────────
export interface EdgeLike {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export const inHandleId = (idx: number) => `in-${idx}`;

export function inHandleIndex(handle?: string | null): number {
  const m = /^in-(\d+)$/.exec(handle ?? '');
  return m ? Number(m[1]) : 0;
}

export const edgeId = (source: string, handle: string, target: string, idx: number) =>
  `e-${source}-${handle}-${target}-${idx}`;

/** Edges feeding `nodeId`, ordered by input index. */
export function incomingEdges<E extends EdgeLike>(edges: E[], nodeId: string): E[] {
  return edges
    .filter((e) => e.target === nodeId)
    .sort((a, b) => inHandleIndex(a.targetHandle) - inHandleIndex(b.targetHandle));
}

export function inputsFromEdges(edges: EdgeLike[], nodeId: string): NodeInput[] {
  return incomingEdges(edges, nodeId).map((e) => ({
    sourceNodeId: e.source,
    sourceOutputName: e.sourceHandle ?? '',
  }));
}

/** Remove the input at `idx` of a Merge and renumber higher inputs (handle id + edge id). */
export function removeMergeInput<E extends EdgeLike>(edges: E[], target: string, idx: number): E[] {
  const out: E[] = [];
  for (const e of edges) {
    if (e.target !== target) {
      out.push(e);
      continue;
    }
    const i = inHandleIndex(e.targetHandle);
    if (i === idx) continue;
    if (i > idx) {
      out.push({ ...e, id: edgeId(e.source, e.sourceHandle ?? '', e.target, i - 1), targetHandle: inHandleId(i - 1) });
    } else {
      out.push(e);
    }
  }
  return out;
}

export function reachable(edges: EdgeLike[], from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.source === cur && !seen.has(e.target)) {
        seen.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return seen;
}

export interface ConnectionLike {
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

/** Client-side V2/V3/V4/V6 check for a new connection. Returns an error message or null. */
export function connectionError(
  types: Map<string, WorkflowNode['nodeType']>,
  edges: EdgeLike[],
  c: ConnectionLike,
): string | null {
  const targetType = types.get(c.target);
  const sourceType = types.get(c.source);
  if (!targetType || !sourceType) return 'Unknown node';
  if (c.source === c.target) return 'A node cannot feed itself';
  if (reachable(edges, c.target).has(c.source)) return 'This would create a cycle';
  if (sourceType === 'Merge' && c.sourceHandle !== MERGE_OUTPUT) return 'Merge only outputs Mix';
  if (!c.sourceHandle) return 'Missing source output';

  const incoming = incomingEdges(edges, c.target);
  if (targetType === 'AudioSeparation') {
    if (inHandleIndex(c.targetHandle) !== 0) return 'Split has a single input';
    return null;
  }
  const idx = inHandleIndex(c.targetHandle);
  const replacing = incoming.find((e) => inHandleIndex(e.targetHandle) === idx);
  if (!replacing && incoming.length >= MAX_MERGE_INPUTS) return `Merge accepts at most ${MAX_MERGE_INPUTS} inputs`;
  const dup = incoming.some(
    (e) => e !== replacing && e.source === c.source && e.sourceHandle === c.sourceHandle,
  );
  if (dup) return 'This stem is already an input of this Merge';
  return null;
}

/**
 * Nodes to delete when removing `startId`: Splits lose their only input so go with it (the
 * old cascade); a Merge survives losing inputs unless none remain.
 */
export function collectRemoval(
  types: Map<string, WorkflowNode['nodeType']>,
  edges: EdgeLike[],
  startIds: string | string[],
): Set<string> {
  const removed = new Set<string>(Array.isArray(startIds) ? startIds : [startIds]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, type] of types) {
      if (removed.has(id)) continue;
      const inc = edges.filter((e) => e.target === id);
      if (inc.length === 0) continue;
      const remaining = inc.filter((e) => !removed.has(e.source)).length;
      const lostAny = remaining < inc.length;
      if ((type === 'AudioSeparation' && lostAny) || (type === 'Merge' && remaining === 0)) {
        removed.add(id);
        changed = true;
      }
    }
  }
  return removed;
}

// ── Validation ────────────────────────────────────────────────────────────────
export function validateWorkflow(nodes: WorkflowNode[], getStems?: GetStems): Issue[] {
  const issues: Issue[] = [];
  const add = (n: WorkflowNode, msg: string) => issues.push({ nodeId: n.id, message: `${nodeLabel(n)}: ${msg}` });
  const byId = new Map<string, WorkflowNode>();

  for (const n of nodes) {
    if (!n.id || !GUID_RE.test(n.id)) add(n, 'id must be a GUID');
    else if (byId.has(n.id)) add(n, 'duplicate node id');
    byId.set(n.id, n);
  }

  for (const n of nodes) {
    if (n.nodeType !== 'AudioSeparation' && n.nodeType !== 'Merge') {
      add(n, `unknown node type '${String(n.nodeType)}'`);
      continue;
    }
    if (n.nodeType === 'AudioSeparation' && n.inputs.length > 1) add(n, 'a Split takes at most one input');
    if (n.nodeType === 'Merge') {
      if (n.inputs.length < MIN_MERGE_INPUTS) add(n, `Needs at least ${MIN_MERGE_INPUTS} stems`);
      if (n.inputs.length > MAX_MERGE_INPUTS) add(n, `at most ${MAX_MERGE_INPUTS} inputs`);
      const gains = parseConfig<MergeConfig>(n.configJson).inputGainsDb ?? [];
      if (gains.length > n.inputs.length) add(n, 'more gains than inputs');
      if (gains.some((g) => typeof g !== 'number' || g < -60 || g > 12)) add(n, 'input gain must be between -60 and +12 dB');
      if (n.keptOutputs.some((o) => o !== MERGE_OUTPUT)) add(n, `can only keep '${MERGE_OUTPUT}'`);
    }

    const seen = new Set<string>();
    for (const i of n.inputs) {
      const src = byId.get(i.sourceNodeId);
      if (!src) {
        add(n, 'input references a missing node');
        continue;
      }
      if (!i.sourceOutputName) add(n, 'input has no source output');
      else if (src.nodeType === 'Merge' && i.sourceOutputName !== MERGE_OUTPUT) add(n, `${nodeLabel(src)} only outputs '${MERGE_OUTPUT}'`);
      else if (src.nodeType === 'AudioSeparation' && getStems && !getStems(getModelName(src)).includes(i.sourceOutputName)) {
        add(n, `'${i.sourceOutputName}' is not an output of ${nodeLabel(src)}'s model`);
      }
      if (n.nodeType === 'Merge') {
        const key = `${i.sourceNodeId}\u0000${i.sourceOutputName}`;
        if (seen.has(key)) add(n, `'${i.sourceOutputName}' from ${nodeLabel(src)} is connected twice`);
        seen.add(key);
      }
    }
  }

  // V2: cycle detection (Kahn); anything left over sits on or behind a cycle.
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, n.inputs.filter((i) => byId.has(i.sourceNodeId)).length);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0);
  const done = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    for (const n of nodes) {
      const edgesFromCur = n.inputs.filter((i) => i.sourceNodeId === cur.id).length;
      if (edgesFromCur === 0) continue;
      const left = (indeg.get(n.id) ?? 0) - edgesFromCur;
      indeg.set(n.id, left);
      if (left === 0) queue.push(n);
    }
  }
  for (const n of nodes) if (!done.has(n.id)) add(n, 'is part of a cycle');

  return issues;
}
