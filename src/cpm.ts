import type { XERActivity, XERRelationship } from './types';

/**
 * Critical Path Method engine.
 *
 * The network is solved on a continuous hour scale relative to time zero
 * (the earliest early-start in the schedule). Calendars are deliberately not
 * modelled -- this is a screening-grade engine, and that limitation is stated
 * in the UI rather than hidden.
 */

export interface CPMNetwork {
  /** Activity ids in a deterministic order; index into every parallel array. */
  ids: string[];
  indexOf: Map<string, number>;
  /** Duration in hours, indexed like `ids`. */
  durations: Float64Array;
  /** Topologically ordered indices (cycle back-edges dropped). */
  order: number[];
  /** Predecessor edges per successor index. */
  preds: { pred: number; type: string; lag: number }[][];
  /** Successor edges per predecessor index. */
  succs: { succ: number; type: string; lag: number }[][];
  /** Indices whose relationships formed a cycle and were dropped. */
  droppedEdges: number;
}

export interface CPMResult {
  earlyStart: Float64Array;
  earlyFinish: Float64Array;
  lateStart: Float64Array;
  lateFinish: Float64Array;
  totalFloat: Float64Array;
  /** Project duration in hours. */
  projectDuration: number;
  criticalIds: string[];
}

const RELATION_TYPES = new Set(['PR_FS', 'PR_SS', 'PR_FF', 'PR_SF']);

export function buildNetwork(activities: XERActivity[], relationships: XERRelationship[]): CPMNetwork {
  const ids = activities.map(a => a.task_id);
  const indexOf = new Map<string, number>();
  ids.forEach((id, i) => indexOf.set(id, i));

  const durations = new Float64Array(ids.length);
  activities.forEach((a, i) => {
    durations[i] = Math.max(0, a.target_drtn_hr_cnt || 0);
  });

  const preds: CPMNetwork['preds'] = ids.map(() => []);
  const succs: CPMNetwork['succs'] = ids.map(() => []);

  for (const rel of relationships) {
    const s = indexOf.get(rel.task_id);
    const p = indexOf.get(rel.pred_task_id);
    // Relationships pointing outside the loaded project are ignored rather
    // than silently mis-attached to index 0.
    if (s === undefined || p === undefined || s === p) continue;
    const type = RELATION_TYPES.has(rel.pred_type) ? rel.pred_type : 'PR_FS';
    const lag = Number.isFinite(rel.lag_hr_cnt) ? rel.lag_hr_cnt : 0;
    preds[s].push({ pred: p, type, lag });
    succs[p].push({ succ: s, type, lag });
  }

  const { order, dropped } = topoSort(ids.length, succs);

  return { ids, indexOf, durations, order, preds, succs, droppedEdges: dropped };
}

/**
 * Kahn's algorithm. Any node still unresolved when the queue empties sits in a
 * cycle; those nodes are appended in their original order so the passes below
 * still terminate and produce usable (if approximate) dates.
 */
function topoSort(n: number, succs: CPMNetwork['succs']): { order: number[]; dropped: number } {
  const indegree = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (const e of succs[i]) indegree[e.succ]++;
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);

  const order: number[] = [];
  const seen = new Uint8Array(n);
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    seen[node] = 1;
    for (const e of succs[node]) {
      if (--indegree[e.succ] === 0) queue.push(e.succ);
    }
  }

  let dropped = 0;
  if (order.length < n) {
    for (let i = 0; i < n; i++) {
      if (!seen[i]) {
        order.push(i);
        dropped++;
      }
    }
  }

  return { order, dropped };
}

/**
 * Forward + backward pass. `durations` may be supplied to override the
 * network's deterministic durations (used by the Monte Carlo engine).
 */
export function solveCPM(network: CPMNetwork, durations: Float64Array = network.durations): CPMResult {
  const n = network.ids.length;
  const es = new Float64Array(n);
  const ef = new Float64Array(n);

  for (const i of network.order) {
    let start = 0;
    for (const e of network.preds[i]) {
      const d = durations[i];
      let candidate: number;
      switch (e.type) {
        case 'PR_SS': candidate = es[e.pred] + e.lag; break;
        case 'PR_FF': candidate = ef[e.pred] + e.lag - d; break;
        case 'PR_SF': candidate = es[e.pred] + e.lag - d; break;
        default: candidate = ef[e.pred] + e.lag; break; // PR_FS
      }
      if (candidate > start) start = candidate;
    }
    es[i] = start;
    ef[i] = start + durations[i];
  }

  let projectFinish = 0;
  for (let i = 0; i < n; i++) if (ef[i] > projectFinish) projectFinish = ef[i];

  const ls = new Float64Array(n);
  const lf = new Float64Array(n);
  for (let k = network.order.length - 1; k >= 0; k--) {
    const i = network.order[k];
    let finish = projectFinish;
    for (const e of network.succs[i]) {
      const j = e.succ;
      let candidate: number;
      switch (e.type) {
        case 'PR_SS': candidate = ls[j] - e.lag + durations[i]; break;
        case 'PR_FF': candidate = lf[j] - e.lag; break;
        case 'PR_SF': candidate = lf[j] - e.lag + durations[i]; break;
        default: candidate = ls[j] - e.lag; break; // PR_FS
      }
      if (candidate < finish) finish = candidate;
    }
    lf[i] = finish;
    ls[i] = finish - durations[i];
  }

  const totalFloat = new Float64Array(n);
  const criticalIds: string[] = [];
  for (let i = 0; i < n; i++) {
    totalFloat[i] = ls[i] - es[i];
    if (totalFloat[i] <= 1e-6) criticalIds.push(network.ids[i]);
  }

  return {
    earlyStart: es,
    earlyFinish: ef,
    lateStart: ls,
    lateFinish: lf,
    totalFloat,
    projectDuration: projectFinish,
    criticalIds,
  };
}

/**
 * Finish time only -- skips the backward pass and all allocation, so the Monte
 * Carlo loop can call it thousands of times without churning the heap.
 */
export function forwardPassInto(
  network: CPMNetwork,
  durations: Float64Array,
  es: Float64Array,
  ef: Float64Array,
): number {
  let projectFinish = 0;
  for (const i of network.order) {
    let start = 0;
    for (const e of network.preds[i]) {
      const d = durations[i];
      let candidate: number;
      switch (e.type) {
        case 'PR_SS': candidate = es[e.pred] + e.lag; break;
        case 'PR_FF': candidate = ef[e.pred] + e.lag - d; break;
        case 'PR_SF': candidate = es[e.pred] + e.lag - d; break;
        default: candidate = ef[e.pred] + e.lag; break;
      }
      if (candidate > start) start = candidate;
    }
    es[i] = start;
    ef[i] = start + durations[i];
    if (ef[i] > projectFinish) projectFinish = ef[i];
  }
  return projectFinish;
}

/**
 * Backward pass writing total float in place, given a completed forward pass.
 */
export function backwardFloatInto(
  network: CPMNetwork,
  durations: Float64Array,
  es: Float64Array,
  ls: Float64Array,
  lf: Float64Array,
  projectFinish: number,
  totalFloat: Float64Array,
): void {
  for (let k = network.order.length - 1; k >= 0; k--) {
    const i = network.order[k];
    let finish = projectFinish;
    for (const e of network.succs[i]) {
      const j = e.succ;
      let candidate: number;
      switch (e.type) {
        case 'PR_SS': candidate = ls[j] - e.lag + durations[i]; break;
        case 'PR_FF': candidate = lf[j] - e.lag; break;
        case 'PR_SF': candidate = lf[j] - e.lag + durations[i]; break;
        default: candidate = ls[j] - e.lag; break;
      }
      if (candidate < finish) finish = candidate;
    }
    lf[i] = finish;
    ls[i] = finish - durations[i];
    totalFloat[i] = ls[i] - es[i];
  }
}

/** Deterministic PRNG so a given seed always reproduces the same simulation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
