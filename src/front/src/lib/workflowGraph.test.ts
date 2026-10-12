import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/types/workflow';
import {
  collectRemoval,
  connectionError,
  defaultMergeLabel,
  edgeId,
  effectiveKeepState,
  inHandleId,
  keepSummary,
  removeGainAt,
  removeMergeInput,
  validateWorkflow,
  type EdgeLike,
} from './workflowGraph';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const M = '33333333-3333-4333-8333-333333333333';
const stems = () => ['Vocals', 'Bass', 'Drums', 'Other'];

const split = (id: string, order: number, inputs: WorkflowNode['inputs'] = [], keptOutputs: string[] = []): WorkflowNode => ({
  id, order, nodeType: 'AudioSeparation', configJson: '{}', inputs, keptOutputs,
});
const merge = (id: string, order: number, inputs: WorkflowNode['inputs'], extra: object = {}, keptOutputs: string[] = []): WorkflowNode => ({
  id, order, nodeType: 'Merge', configJson: JSON.stringify(extra), inputs, keptOutputs,
});
const inp = (sourceNodeId: string, sourceOutputName: string) => ({ sourceNodeId, sourceOutputName });

const validGraph = () => [
  split(A, 0),
  split(B, 1, [inp(A, 'Vocals')]),
  merge(M, 2, [inp(B, 'Vocals'), inp(A, 'Bass')]),
];

describe('validateWorkflow', () => {
  it('accepts a valid graph', () => {
    expect(validateWorkflow(validGraph(), stems)).toEqual([]);
  });
  it('rejects non-GUID and duplicate ids', () => {
    expect(validateWorkflow([split('x', 0)])).toHaveLength(1);
    expect(validateWorkflow([split(A, 0), split(A, 1)])).toHaveLength(1);
  });
  it('rejects Split with 2 inputs', () => {
    const g = [split(A, 0), split(B, 1), split(M, 2, [inp(A, 'Vocals'), inp(B, 'Vocals')])];
    expect(validateWorkflow(g).some((i) => i.nodeId === M)).toBe(true);
  });
  it('requires 2..8 Merge inputs', () => {
    const one = [split(A, 0), merge(M, 1, [inp(A, 'Vocals')])];
    expect(validateWorkflow(one)[0].message).toMatch(/at least 2/);
    const root = [merge(M, 0, [])];
    expect(validateWorkflow(root)).toHaveLength(1);
    const nine = [split(A, 0), merge(M, 1, Array.from({ length: 9 }, (_, i) => inp(A, `S${i}`)))];
    expect(validateWorkflow(nine).some((i) => /at most 8/.test(i.message))).toBe(true);
  });
  it('rejects missing source node', () => {
    const g = [split(A, 0, [inp(B, 'Vocals')])];
    expect(validateWorkflow(g)[0].message).toMatch(/missing node/);
  });
  it('requires Mix when sourcing a Merge', () => {
    const g = [...validGraph(), split('44444444-4444-4444-8444-444444444444', 3, [inp(M, 'Vocals')])];
    expect(validateWorkflow(g).some((i) => /only outputs/.test(i.message))).toBe(true);
    g[3] = { ...g[3], inputs: [inp(M, 'Mix')] };
    expect(validateWorkflow(g)).toEqual([]);
  });
  it('flags stems the model does not produce only when getStems is supplied', () => {
    const g = [split(A, 0), split(B, 1, [inp(A, 'Piano')])];
    expect(validateWorkflow(g)).toEqual([]);
    expect(validateWorkflow(g, stems)).toHaveLength(1);
  });
  it('rejects duplicate (source, output) in one Merge', () => {
    const g = [split(A, 0), merge(M, 1, [inp(A, 'Vocals'), inp(A, 'Vocals')])];
    expect(validateWorkflow(g).some((i) => /twice/.test(i.message))).toBe(true);
  });
  it('validates gains', () => {
    const g = (gains: number[]) => [split(A, 0), merge(M, 1, [inp(A, 'Vocals'), inp(A, 'Bass')], { inputGainsDb: gains })];
    expect(validateWorkflow(g([0, -3]))).toEqual([]);
    expect(validateWorkflow(g([0, 0, 0]))).toHaveLength(1);
    expect(validateWorkflow(g([13, 0]))).toHaveLength(1);
    expect(validateWorkflow(g([0, -61]))).toHaveLength(1);
  });
  it('restricts Merge keeps to Mix', () => {
    const g = [split(A, 0), merge(M, 1, [inp(A, 'Vocals'), inp(A, 'Bass')], {}, ['Vocals'])];
    expect(validateWorkflow(g)).toHaveLength(1);
  });
  it('detects cycles', () => {
    const g = [split(A, 0, [inp(B, 'Vocals')]), split(B, 1, [inp(A, 'Vocals')])];
    expect(validateWorkflow(g).filter((i) => /cycle/.test(i.message))).toHaveLength(2);
  });
});

describe('keep semantics', () => {
  it('default mode ghosts terminal outputs only', () => {
    const g = validGraph();
    expect(effectiveKeepState(g, A, 'Vocals')).toBe('none'); // consumed by B
    expect(effectiveKeepState(g, A, 'Drums')).toBe('default');
    expect(effectiveKeepState(g, M, 'Mix')).toBe('default');
  });
  it('explicit mode: kept and none, no ghosts', () => {
    const g = validGraph();
    g[0] = { ...g[0], keptOutputs: ['Vocals'] }; // kept AND consumed
    expect(effectiveKeepState(g, A, 'Vocals')).toBe('kept');
    expect(effectiveKeepState(g, A, 'Drums')).toBe('none');
    expect(effectiveKeepState(g, M, 'Mix')).toBe('none');
  });
  it('summarises', () => {
    const g = validGraph();
    const s = keepSummary(g, stems);
    expect(s.mode).toBe('default');
    const keys = s.items.map((i) => `${i.nodeLabel}:${i.output}`);
    expect(keys).toContain('Node 3:Mix');
    expect(keys).toContain('Node 1:Drums');
    expect(keys).not.toContain('Node 1:Vocals'); // consumed by Node 2
    expect(keepSummary(validGraph().map((n) => (n.id === M ? { ...n, keptOutputs: ['Mix'] } : n)), stems)).toMatchObject({
      mode: 'explicit',
      items: [{ nodeLabel: 'Node 3', output: 'Mix' }],
    });
  });
});

describe('merge helpers', () => {
  it('default label joins input stems', () => {
    expect(defaultMergeLabel(validGraph()[2], validGraph())).toBe('Vocals + Bass');
  });
  it('removeGainAt keeps gains aligned', () => {
    expect(JSON.parse(removeGainAt('{"inputGainsDb":[0,-3,2]}', 1)).inputGainsDb).toEqual([0, 2]);
    expect(removeGainAt('{}', 0)).toBe('{}');
  });
  it('removeMergeInput compacts handles and ids', () => {
    const e = (src: string, h: string, idx: number): EdgeLike => ({
      id: edgeId(src, h, M, idx), source: src, sourceHandle: h, target: M, targetHandle: inHandleId(idx),
    });
    const out = removeMergeInput([e(A, 'Vocals', 0), e(A, 'Bass', 1), e(B, 'Drums', 2)], M, 1);
    expect(out.map((x) => x.targetHandle)).toEqual(['in-0', 'in-1']);
    expect(out[1].id).toBe(edgeId(B, 'Drums', M, 1));
  });
});

describe('connectionError', () => {
  const types = new Map<string, WorkflowNode['nodeType']>([[A, 'AudioSeparation'], [B, 'AudioSeparation'], [M, 'Merge']]);
  const e = (src: string, h: string, tgt: string, idx: number): EdgeLike => ({
    id: edgeId(src, h, tgt, idx), source: src, sourceHandle: h, target: tgt, targetHandle: inHandleId(idx),
  });
  it('blocks self, cycles, and non-Mix merge handles', () => {
    expect(connectionError(types, [], { source: A, sourceHandle: 'Vocals', target: A, targetHandle: 'in-0' })).toBeTruthy();
    expect(connectionError(types, [e(A, 'Vocals', B, 0)], { source: B, sourceHandle: 'Vocals', target: A, targetHandle: 'in-0' })).toMatch(/cycle/);
    expect(connectionError(types, [], { source: M, sourceHandle: 'Vocals', target: A, targetHandle: 'in-0' })).toBeTruthy();
  });
  it('blocks duplicate merge inputs but allows replacing the same slot', () => {
    const edges = [e(A, 'Vocals', M, 0)];
    expect(connectionError(types, edges, { source: A, sourceHandle: 'Vocals', target: M, targetHandle: 'in-1' })).toMatch(/already/);
    expect(connectionError(types, edges, { source: A, sourceHandle: 'Vocals', target: M, targetHandle: 'in-0' })).toBeNull();
    expect(connectionError(types, edges, { source: A, sourceHandle: 'Bass', target: M, targetHandle: 'in-1' })).toBeNull();
  });
  it('caps merge at 8 inputs', () => {
    const edges = Array.from({ length: 8 }, (_, i) => e(A, `S${i}`, M, i));
    expect(connectionError(types, edges, { source: B, sourceHandle: 'Vocals', target: M, targetHandle: 'in-8' })).toMatch(/at most/);
  });
});

describe('collectRemoval', () => {
  const types = new Map<string, WorkflowNode['nodeType']>([[A, 'AudioSeparation'], [B, 'AudioSeparation'], [M, 'Merge']]);
  const e = (src: string, h: string, tgt: string, idx: number): EdgeLike => ({
    id: edgeId(src, h, tgt, idx), source: src, sourceHandle: h, target: tgt, targetHandle: inHandleId(idx),
  });
  it('cascades through Splits, spares a Merge that keeps inputs', () => {
    const edges = [e(A, 'Vocals', B, 0), e(A, 'Bass', M, 0), e(B, 'Vocals', M, 1)];
    expect([...collectRemoval(types, edges, B)].sort()).toEqual([B]);
    expect([...collectRemoval(types, edges, A)].sort()).toEqual([A, B, M].sort()); // M loses both inputs
  });
});
