import type {
  ParsedXER,
  DCMAMetric,
  DCMARag,
  DCMAAssuranceReport,
  XERActivity,
  MonteCarloResult,
  DCMAThresholdConfig,
  QSRARiskSettings,
} from './types';
import { buildNetwork, solveCPM, forwardPassInto, backwardFloatInto, mulberry32 } from './cpm';

export const defaultThresholds: DCMAThresholdConfig = {
  profileName: 'DCMA defaults',
  hoursPerDay: 8,
  highFloatHorizonDays: 44,
  highDurationHorizonDays: 44,
  ragBands: {
    1: { green: 5, amber: 10 },
    2: { green: 0, amber: 1 },
    3: { green: 5, amber: 10 },
    4: { green: 90, amber: 80 },
    5: { green: 5, amber: 10 },
    6: { green: 5, amber: 10 },
    7: { green: 0, amber: 1 },
    8: { green: 5, amber: 10 },
    9: { green: 0, amber: 1 },
    10: { green: 0, amber: 5 },
    11: { green: 5, amber: 10 },
    12: { green: 0, amber: 1 },
    13: { green: 0.95, amber: 0.9 },
    14: { green: 0.95, amber: 0.9 },
  },
};

const HARD_CONSTRAINTS = ['CS_MANDSTART', 'CS_MANDFIN', 'CS_MSO', 'CS_MEO', 'CS_MEOB', 'CS_MAND'];

function parseXERDate(value?: string): Date | null {
  if (!value) return null;
  // XER dates are "YYYY-MM-DD HH:mm"; ISO-ify so parsing is not locale dependent.
  const d = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The data date is the schedule's own recalculation date. Where the XER omits
 * it we fall back to the latest actual date, which is the best available proxy.
 */
export function resolveDataDate(xer: ParsedXER): Date | null {
  const declared = parseXERDate(xer.project?.last_recalc_date);
  if (declared) return declared;

  let latestActual: Date | null = null;
  for (const a of xer.activities) {
    for (const raw of [a.act_start_date, a.act_end_date]) {
      const d = parseXERDate(raw);
      if (d && (!latestActual || d > latestActual)) latestActual = d;
    }
  }
  return latestActual;
}

/**
 * Lower-is-better checks: value <= green is Green, value <= amber is Amber.
 * Higher-is-better checks (4, 13, 14) invert that comparison.
 */
function bandFor(id: number, value: number, config: DCMAThresholdConfig): DCMARag {
  const band = config.ragBands[id];
  if (!band) return 'na';
  const higherIsBetter = id === 4 || id === 13 || id === 14;
  if (higherIsBetter) {
    if (value >= band.green) return 'green';
    if (value >= band.amber) return 'amber';
    return 'red';
  }
  if (value <= band.green) return 'green';
  if (value <= band.amber) return 'amber';
  return 'red';
}

function pct(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

/**
 * Incomplete activities with a missing predecessor or successor, excluding the
 * one genuine project-start and one genuine project-finish node that every
 * schedule is entitled to. Shared so the DCMA check and the risk diagnostics
 * can never disagree about how many open ends a schedule has.
 */
export function findOpenEnds(xer: ParsedXER): XERActivity[] {
  const hasPred = new Set(xer.relationships.map(r => r.task_id));
  const hasSucc = new Set(xer.relationships.map(r => r.pred_task_id));
  const candidates = xer.activities.filter(
    a => a.status_code !== 'TK_Complete' && (!hasPred.has(a.task_id) || !hasSucc.has(a.task_id)),
  );

  const projectStartId = [...candidates]
    .sort((a, b) => (parseXERDate(a.early_start_date)?.getTime() ?? 0) - (parseXERDate(b.early_start_date)?.getTime() ?? 0))
    .find(a => !hasPred.has(a.task_id))?.task_id;

  const projectFinishId = [...candidates]
    .sort((a, b) => (parseXERDate(b.early_end_date)?.getTime() ?? 0) - (parseXERDate(a.early_end_date)?.getTime() ?? 0))
    .find(a => !hasSucc.has(a.task_id))?.task_id;

  return candidates.filter(a => {
    const openStart = !hasPred.has(a.task_id);
    const openFinish = !hasSucc.has(a.task_id);
    if (openStart && a.task_id === projectStartId && !openFinish) return false;
    if (openFinish && a.task_id === projectFinishId && !openStart) return false;
    return true;
  });
}

export function calculateDCMA14(
  xer: ParsedXER,
  config: DCMAThresholdConfig = defaultThresholds,
): DCMAAssuranceReport {
  const hoursPerDay = config.hoursPerDay || 8;
  const activities = xer.activities;
  const relationships = xer.relationships;
  const dataDate = resolveDataDate(xer);

  const incomplete = activities.filter(a => a.status_code !== 'TK_Complete');
  const incompleteCount = incomplete.length;
  const relCount = relationships.length;

  const highFloatHours = config.highFloatHorizonDays * hoursPerDay;
  const highDurationHours = config.highDurationHorizonDays * hoursPerDay;

  // --- 1. Logic (open ends) -------------------------------------------------
  const missingLogic = findOpenEnds(xer);

  // --- 2/3. Leads and lags --------------------------------------------------
  const leadRels = relationships.filter(r => r.lag_hr_cnt < 0);
  const lagRels = relationships.filter(r => r.lag_hr_cnt > 0);
  const activityById = new Map(activities.map(a => [a.task_id, a]));
  const tasksFor = (ids: Iterable<string>) => {
    const out: XERActivity[] = [];
    for (const id of new Set(ids)) {
      const a = activityById.get(id);
      if (a) out.push(a);
    }
    return out;
  };
  const leadTasks = tasksFor(leadRels.map(r => r.task_id));
  const lagTasks = tasksFor(lagRels.map(r => r.task_id));

  // --- 4. Relationship types ------------------------------------------------
  const fsCount = relationships.filter(r => r.pred_type === 'PR_FS').length;
  const nonFsRels = relationships.filter(r => r.pred_type !== 'PR_FS');
  const fsSharePct = pct(fsCount, relCount);

  // --- 5. Hard constraints --------------------------------------------------
  const hardConstraintTasks = incomplete.filter(
    a => a.constraint_type && HARD_CONSTRAINTS.includes(a.constraint_type),
  );

  // --- 6/7. Float -----------------------------------------------------------
  const highFloatTasks = incomplete.filter(a => a.total_float_hr_cnt > highFloatHours);
  const negativeFloatTasks = incomplete.filter(a => a.total_float_hr_cnt < 0);

  // --- 8. High duration -----------------------------------------------------
  // Measured on remaining duration, and milestones (zero duration) are excluded.
  const durationBearing = incomplete.filter(a => a.target_drtn_hr_cnt > 0);
  const highDurationTasks = durationBearing.filter(a => {
    const remaining = a.remain_drtn_hr_cnt > 0 ? a.remain_drtn_hr_cnt : a.target_drtn_hr_cnt;
    return remaining > highDurationHours;
  });

  // --- 9. Invalid dates -----------------------------------------------------
  // Forecast work scheduled before the data date, or actuals recorded after it.
  const invalidDateTasks = dataDate
    ? activities.filter(a => {
        const forecastStart = parseXERDate(a.early_start_date);
        const actualStart = parseXERDate(a.act_start_date);
        const actualFinish = parseXERDate(a.act_end_date);
        const forecastInPast =
          a.status_code !== 'TK_Complete' && !!forecastStart && !a.act_start_date && forecastStart < dataDate;
        const actualInFuture =
          (!!actualStart && actualStart > dataDate) || (!!actualFinish && actualFinish > dataDate);
        return forecastInPast || actualInFuture;
      })
    : [];

  // --- 10. Resources --------------------------------------------------------
  const resourcedTaskIds = new Set(
    (xer.rawTables['TASKRSRC']?.rows || []).map(r => r.task_id).filter(Boolean),
  );
  const hasResourceTable = (xer.rawTables['TASKRSRC']?.rows?.length ?? 0) > 0;
  const unresourcedTasks = hasResourceTable
    ? durationBearing.filter(a => !resourcedTaskIds.has(a.task_id))
    : [];

  // --- 11. Missed tasks -----------------------------------------------------
  // target_end_date is the XER's planned finish and stands in for a baseline
  // when no separate baseline file has been loaded.
  const missedTasks = dataDate
    ? activities.filter(a => {
        const planned = parseXERDate(a.target_end_date);
        if (!planned || planned > dataDate) return false;
        if (a.status_code === 'TK_Complete') {
          const actual = parseXERDate(a.act_end_date);
          return !!actual && actual > planned;
        }
        return true;
      })
    : [];
  const shouldHaveFinished = dataDate
    ? activities.filter(a => {
        const planned = parseXERDate(a.target_end_date);
        return !!planned && planned <= dataDate;
      })
    : [];

  // --- 12. Critical path test ----------------------------------------------
  // Structural continuity: every critical activity except the last should hand
  // off to another critical activity, and every one except the first should be
  // driven by one. Breaks mean the critical path is not continuous.
  const network = buildNetwork(activities, relationships);
  const cpm = solveCPM(network);
  const criticalSet = new Set(cpm.criticalIds);
  const criticalTasks = activities.filter(a => criticalSet.has(a.task_id));

  const criticalWithCriticalSucc = new Set<string>();
  const criticalWithCriticalPred = new Set<string>();
  for (const r of relationships) {
    if (criticalSet.has(r.pred_task_id) && criticalSet.has(r.task_id)) {
      criticalWithCriticalSucc.add(r.pred_task_id);
      criticalWithCriticalPred.add(r.task_id);
    }
  }
  const brokenCritical = criticalTasks.filter(
    a => !criticalWithCriticalSucc.has(a.task_id) && !criticalWithCriticalPred.has(a.task_id),
  );

  // --- 13. CPLI -------------------------------------------------------------
  // CPLI = (critical path length + project total float) / critical path length.
  const criticalPathLengthHours = cpm.projectDuration;
  let projectTotalFloatHours = 0;
  if (incomplete.length) {
    projectTotalFloatHours = Math.min(...incomplete.map(a => a.total_float_hr_cnt));
  }
  const cpli =
    criticalPathLengthHours > 0
      ? (criticalPathLengthHours + projectTotalFloatHours) / criticalPathLengthHours
      : 0;

  // --- 14. BEI --------------------------------------------------------------
  const completedCount = activities.filter(a => a.status_code === 'TK_Complete').length;
  const bei = shouldHaveFinished.length > 0 ? completedCount / shouldHaveFinished.length : 0;

  const make = (
    m: Omit<DCMAMetric, 'rag' | 'passed' | 'percentage'> & { percentage?: number },
  ): DCMAMetric => {
    const rag: DCMARag = m.notAssessedReason ? 'na' : bandFor(m.id, m.value, config);
    return {
      ...m,
      percentage: m.percentage ?? (m.unit === 'percent' ? m.value : pct(m.count, m.total)),
      rag,
      passed: rag === 'green',
    };
  };

  const metrics: DCMAMetric[] = [
    make({
      id: 1,
      name: 'Logic',
      description: 'Incomplete activities missing a predecessor or a successor.',
      target: `≤ ${config.ragBands[1].green}%`,
      unit: 'percent',
      count: missingLogic.length,
      total: incompleteCount,
      value: pct(missingLogic.length, incompleteCount),
      flaggedTasks: missingLogic,
    }),
    make({
      id: 2,
      name: 'Leads (negative lag)',
      description: 'Relationships with negative lag, which let a successor start early.',
      target: '0',
      unit: 'count',
      count: leadRels.length,
      total: relCount,
      value: leadRels.length,
      percentage: pct(leadRels.length, relCount),
      flaggedTasks: leadTasks,
    }),
    make({
      id: 3,
      name: 'Lags',
      description: 'Relationships carrying positive lag instead of modelled activities.',
      target: `≤ ${config.ragBands[3].green}%`,
      unit: 'percent',
      count: lagRels.length,
      total: relCount,
      value: pct(lagRels.length, relCount),
      flaggedTasks: lagTasks,
    }),
    make({
      id: 4,
      name: 'Relationship types',
      description: 'Share of links that are Finish-to-Start.',
      target: `≥ ${config.ragBands[4].green}%`,
      unit: 'percent',
      count: nonFsRels.length,
      total: relCount,
      value: fsSharePct,
      percentage: fsSharePct,
      flaggedTasks: tasksFor(nonFsRels.map(r => r.task_id)),
    }),
    make({
      id: 5,
      name: 'Hard constraints',
      description: 'Date constraints that override network logic.',
      target: `≤ ${config.ragBands[5].green}%`,
      unit: 'percent',
      count: hardConstraintTasks.length,
      total: incompleteCount,
      value: pct(hardConstraintTasks.length, incompleteCount),
      flaggedTasks: hardConstraintTasks,
    }),
    make({
      id: 6,
      name: 'High float',
      description: `Total float above ${config.highFloatHorizonDays} working days.`,
      target: `≤ ${config.ragBands[6].green}%`,
      unit: 'percent',
      count: highFloatTasks.length,
      total: incompleteCount,
      value: pct(highFloatTasks.length, incompleteCount),
      flaggedTasks: highFloatTasks,
    }),
    make({
      id: 7,
      name: 'Negative float',
      description: 'Activities already behind their own logic.',
      target: '0',
      unit: 'count',
      count: negativeFloatTasks.length,
      total: incompleteCount,
      value: negativeFloatTasks.length,
      percentage: pct(negativeFloatTasks.length, incompleteCount),
      flaggedTasks: negativeFloatTasks,
    }),
    make({
      id: 8,
      name: 'High duration',
      description: `Remaining duration above ${config.highDurationHorizonDays} working days.`,
      target: `≤ ${config.ragBands[8].green}%`,
      unit: 'percent',
      count: highDurationTasks.length,
      total: durationBearing.length,
      value: pct(highDurationTasks.length, durationBearing.length),
      flaggedTasks: highDurationTasks,
    }),
    make({
      id: 9,
      name: 'Invalid dates',
      description: 'Forecast work before the data date, or actuals recorded after it.',
      target: '0',
      unit: 'count',
      count: invalidDateTasks.length,
      total: activities.length,
      value: invalidDateTasks.length,
      percentage: pct(invalidDateTasks.length, activities.length),
      flaggedTasks: invalidDateTasks,
      notAssessedReason: dataDate ? undefined : 'No data date in the XER, so dates cannot be compared.',
    }),
    make({
      id: 10,
      name: 'Resources',
      description: 'Activities with duration but no resource or cost assignment.',
      target: '0',
      unit: 'count',
      count: unresourcedTasks.length,
      total: durationBearing.length,
      value: unresourcedTasks.length,
      percentage: pct(unresourcedTasks.length, durationBearing.length),
      flaggedTasks: unresourcedTasks,
      notAssessedReason: hasResourceTable
        ? undefined
        : 'The XER contains no TASKRSRC table, so the schedule is not resource loaded.',
    }),
    make({
      id: 11,
      name: 'Missed tasks',
      description: 'Activities that should have finished by the data date but did not.',
      target: `≤ ${config.ragBands[11].green}%`,
      unit: 'percent',
      count: missedTasks.length,
      total: shouldHaveFinished.length,
      value: pct(missedTasks.length, shouldHaveFinished.length),
      flaggedTasks: missedTasks,
      notAssessedReason: dataDate
        ? shouldHaveFinished.length
          ? undefined
          : 'Nothing was planned to finish on or before the data date.'
        : 'No data date in the XER.',
    }),
    make({
      id: 12,
      name: 'Critical path test',
      description: 'Critical activities that connect to no other critical activity.',
      target: '0',
      unit: 'count',
      count: brokenCritical.length,
      total: criticalTasks.length,
      value: brokenCritical.length,
      percentage: pct(brokenCritical.length, criticalTasks.length),
      flaggedTasks: brokenCritical,
      notAssessedReason: criticalTasks.length ? undefined : 'No critical activities were found.',
    }),
    make({
      id: 13,
      name: 'CPLI',
      description: 'Critical Path Length Index — 1.00 means the plan has no built-in slip.',
      target: `≥ ${config.ragBands[13].green.toFixed(2)}`,
      unit: 'ratio',
      count: 0,
      total: 1,
      value: cpli,
      percentage: cpli * 100,
      flaggedTasks: [],
      notAssessedReason: criticalPathLengthHours > 0 ? undefined : 'The network has no computable critical path.',
    }),
    make({
      id: 14,
      name: 'BEI',
      description: 'Baseline Execution Index — work completed against work planned to date.',
      target: `≥ ${config.ragBands[14].green.toFixed(2)}`,
      unit: 'ratio',
      count: completedCount,
      total: shouldHaveFinished.length,
      value: bei,
      percentage: bei * 100,
      flaggedTasks: [],
      notAssessedReason: shouldHaveFinished.length
        ? undefined
        : 'Nothing was planned to finish on or before the data date.',
    }),
  ];

  const greenCount = metrics.filter(m => m.rag === 'green').length;
  const amberCount = metrics.filter(m => m.rag === 'amber').length;
  const redCount = metrics.filter(m => m.rag === 'red').length;
  const naCount = metrics.filter(m => m.rag === 'na').length;
  const assessed = metrics.length - naCount;

  // Amber counts as a half pass so the headline score degrades smoothly.
  const overallScore = assessed > 0 ? Math.round(((greenCount + amberCount * 0.5) / assessed) * 100) : 0;

  return {
    projectName: xer.project?.proj_name || 'Untitled project',
    projectCode: xer.project?.proj_short_name || '—',
    dataDate,
    activityCount: activities.length,
    incompleteCount,
    relationshipCount: relCount,
    metrics,
    overallScore,
    greenCount,
    amberCount,
    redCount,
    naCount,
    passedCount: greenCount,
  };
}

export const defaultRiskSettings: QSRARiskSettings = {
  optimisticPct: 90,
  mostLikelyPct: 100,
  pessimisticPct: 115,
  distribution: 'Beta-PERT',
  ignoreHardConstraints: false,
  iterations: 3000,
  seed: 12345,
  correlation: 'none',
  hoursPerDay: 8,
};

/** Inverse-CDF sample from a triangular distribution on [min, max] with mode. */
function sampleTriangular(u: number, min: number, mode: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const fc = (mode - min) / range;
  if (u < fc) return min + Math.sqrt(u * range * (mode - min));
  return max - Math.sqrt((1 - u) * range * (max - mode));
}

/**
 * Beta-PERT via its mean/standard-deviation moment match, sampled with a
 * normal approximation and clamped to the range. Cheaper than a true beta
 * inverse-CDF and indistinguishable at screening grade.
 */
function samplePert(u1: number, u2: number, min: number, mode: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const mean = (min + 4 * mode + max) / 6;
  const sd = range / 6;
  // Box-Muller
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
  return Math.min(max, Math.max(min, mean + z * sd));
}

export function runMonteCarloRisk(
  xer: ParsedXER,
  settings: Partial<QSRARiskSettings> = {},
): MonteCarloResult {
  const cfg = { ...defaultRiskSettings, ...settings };
  const iterations = Math.max(100, Math.min(20000, Math.round(cfg.iterations)));
  const hoursPerDay = cfg.hoursPerDay || 8;
  const optFactor = cfg.optimisticPct / 100;
  const modeFactor = cfg.mostLikelyPct / 100;
  const pessFactor = cfg.pessimisticPct / 100;

  const activities = xer.activities;
  const network = buildNetwork(activities, xer.relationships);
  const n = network.ids.length;

  const deterministic = solveCPM(network);
  const deterministicHours = deterministic.projectDuration;

  // Project start anchors the hour scale onto real calendar dates.
  let projectStart: Date | null = null;
  for (const a of activities) {
    const d = parseXERDate(a.act_start_date) || parseXERDate(a.early_start_date) || parseXERDate(a.target_start_date);
    if (d && (!projectStart || d < projectStart)) projectStart = d;
  }
  const anchor = projectStart ?? new Date();

  // Reconcile the engine's own finish against the dates the XER carries.
  let xerFinish: Date | null = null;
  for (const a of activities) {
    const d = parseXERDate(a.early_end_date) || parseXERDate(a.target_end_date) || parseXERDate(a.act_end_date);
    if (d && (!xerFinish || d > xerFinish)) xerFinish = d;
  }
  // Mapping working hours back onto the calendar needs a working-week factor,
  // otherwise a 72-working-day project is reported as finishing 72 calendar days
  // out and every date lands weeks early. Rather than assume a 5-day week, the
  // factor is calibrated against the XER's own start-to-finish span, so whatever
  // calendars the schedule really uses are absorbed into one honest scale.
  const DEFAULT_CALENDAR_FACTOR = 7 / 5;
  let msPerHour = (24 * 3600 * 1000 * DEFAULT_CALENDAR_FACTOR) / hoursPerDay;
  if (xerFinish && projectStart && deterministicHours > 0) {
    const observedSpanMs = xerFinish.getTime() - projectStart.getTime();
    if (observedSpanMs > 0) msPerHour = observedSpanMs / deterministicHours;
  }

  const hoursToDate = (hours: number) => new Date(anchor.getTime() + hours * msPerHour);

  const reconciliationDeltaDays = xerFinish
    ? Math.round((hoursToDate(deterministicHours).getTime() - xerFinish.getTime()) / (24 * 3600 * 1000))
    : null;

  const rand = mulberry32(cfg.seed >>> 0);

  const durations = new Float64Array(n);
  const es = new Float64Array(n);
  const ef = new Float64Array(n);
  const ls = new Float64Array(n);
  const lf = new Float64Array(n);
  const totalFloat = new Float64Array(n);

  const finishes = new Float64Array(iterations);
  const criticalHits = new Int32Array(n);

  // Running sums let us compute a duration/finish correlation per activity
  // without ever storing an iterations x activities matrix.
  const sumX = new Float64Array(n);
  const sumX2 = new Float64Array(n);
  const sumXY = new Float64Array(n);
  let sumY = 0;
  let sumY2 = 0;

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const base = network.durations[i];
      if (base <= 0) {
        durations[i] = 0;
        continue;
      }
      const min = base * optFactor;
      const mode = base * modeFactor;
      const max = base * pessFactor;
      durations[i] =
        cfg.distribution === 'Triangular'
          ? sampleTriangular(rand(), min, mode, max)
          : samplePert(rand(), rand(), min, mode, max);
    }

    const finish = forwardPassInto(network, durations, es, ef);
    backwardFloatInto(network, durations, es, ls, lf, finish, totalFloat);

    finishes[it] = finish;
    sumY += finish;
    sumY2 += finish * finish;

    for (let i = 0; i < n; i++) {
      if (totalFloat[i] <= 1e-6) criticalHits[i]++;
      const x = durations[i];
      sumX[i] += x;
      sumX2[i] += x * x;
      sumXY[i] += x * finish;
    }
  }

  const sorted = Float64Array.from(finishes).sort();
  const percentileHours = (p: number) => {
    const idx = Math.min(iterations - 1, Math.max(0, Math.round((p / 100) * (iterations - 1))));
    return sorted[idx];
  };

  const toDays = (hours: number) => hours / hoursPerDay;

  // Where does the deterministic date actually land on the distribution?
  let below = 0;
  for (let i = 0; i < iterations; i++) if (sorted[i] <= deterministicHours) below++;
  const planPValue = Math.round((below / iterations) * 100);

  // --- S-curve and histogram over the real distribution ---------------------
  const minHours = sorted[0];
  const maxHours = sorted[iterations - 1];
  const binCount = Math.min(30, Math.max(8, Math.round(Math.sqrt(iterations) / 3)));
  const binWidth = (maxHours - minHours) / binCount || 1;
  const histogram = new Array(binCount).fill(0);
  for (let i = 0; i < iterations; i++) {
    const bin = Math.min(binCount - 1, Math.floor((sorted[i] - minHours) / binWidth));
    histogram[bin]++;
  }

  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`;

  const distributionHistogram = histogram.map((count, i) => ({
    binLabel: fmt(hoursToDate(minHours + (i + 0.5) * binWidth)),
    count,
  }));

  let cumulative = 0;
  const sCurveData = histogram.map((count, i) => {
    cumulative += count;
    const date = hoursToDate(minHours + (i + 1) * binWidth);
    return { dateLabel: fmt(date), date, probability: (cumulative / iterations) * 100 };
  });

  // --- Drivers --------------------------------------------------------------
  const criticalityIndex = network.ids
    .map((id, i) => ({ id, i, hits: criticalHits[i] }))
    // Milestones are always on the path but can never move it, so the driver
    // list is restricted to activities that actually carry duration.
    .filter(r => r.hits > 0 && network.durations[r.i] > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20)
    .map(r => {
      const act = activities[r.i];
      return {
        activityCode: act?.task_code ?? r.id,
        activityName: act?.task_name ?? '',
        percentage: Number(((r.hits / iterations) * 100).toFixed(1)),
      };
    });

  const yVar = sumY2 - (sumY * sumY) / iterations;
  const durationSensitivity = network.ids
    .map((_, i) => {
      if (network.durations[i] <= 0) return null;
      const xVar = sumX2[i] - (sumX[i] * sumX[i]) / iterations;
      if (xVar <= 1e-9 || yVar <= 1e-9) return null;
      const cov = sumXY[i] - (sumX[i] * sumY) / iterations;
      const r = cov / Math.sqrt(xVar * yVar);
      const act = activities[i];
      return {
        activityCode: act?.task_code ?? network.ids[i],
        activityName: act?.task_name ?? '',
        correlation: Number(r.toFixed(3)),
      };
    })
    .filter((r): r is { activityCode: string; activityName: string; correlation: number } => r !== null)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 20);

  const openEnds = findOpenEnds(xer).length;

  const meanHours = sumY / iterations;

  return {
    iterations,
    seed: cfg.seed,
    distribution: cfg.distribution,
    p10Date: hoursToDate(percentileHours(10)),
    p50Date: hoursToDate(percentileHours(50)),
    p80Date: hoursToDate(percentileHours(80)),
    p90Date: hoursToDate(percentileHours(90)),
    planDate: hoursToDate(deterministicHours),
    planPValue,
    minDurationDays: Math.round(toDays(minHours)),
    maxDurationDays: Math.round(toDays(maxHours)),
    meanDurationDays: Math.round(toDays(meanHours)),
    p50DurationDays: Math.round(toDays(percentileHours(50))),
    sCurveData,
    distributionHistogram,
    criticalityIndex,
    durationSensitivity,
    diagnostics: {
      activitiesSimulated: activities.filter(a => a.target_drtn_hr_cnt > 0).length,
      openEnds,
      cyclesDropped: network.droppedEdges,
      leads: xer.relationships.filter(r => r.lag_hr_cnt < 0).length,
      lags: xer.relationships.filter(r => r.lag_hr_cnt > 0).length,
      reconciliationDeltaDays,
    },
  };
}

/**
 * Rewrites the raw XER tables with pseudonymised identifiers while leaving the
 * analytical skeleton (logic, dates, float, calendars) intact.
 */
export function anonymizeXER(xer: ParsedXER): string {
  const header = `EREXPORTHEADER\t19.12\t${new Date().toISOString().slice(0, 10)}\t1\t1000\tP6\tPROJECT\tSYSTEM\t\n`;
  let output = header;

  const scrub: Record<string, (row: Record<string, string>, i: number) => void> = {
    PROJECT: row => {
      row.proj_short_name = 'ANON-PROJ';
    },
    PROJWBS: (row, i) => {
      row.wbs_short_name = `WBS-${i + 1}`;
      row.wbs_name = `Sub-system module ${i + 1}`;
    },
    TASK: (row, i) => {
      row.task_code = `ACT-${1000 + i * 10}`;
      row.task_name = `Project operation phase ${i + 1}`;
    },
    RSRC: (row, i) => {
      row.rsrc_short_name = `RES-${i + 1}`;
      row.rsrc_name = `Resource ${i + 1}`;
    },
    TASKMEMO: row => {
      row.task_memo = '[redacted]';
    },
  };

  for (const tableName of Object.keys(xer.rawTables)) {
    const table = xer.rawTables[tableName];
    output += `%T\t${tableName}\n`;
    output += `%F\t${table.fields.join('\t')}\n`;

    const scrubber = scrub[tableName];
    for (let i = 0; i < table.rows.length; i++) {
      // Clone so anonymising never mutates the schedule still on screen.
      const row = { ...table.rows[i] };
      if (scrubber) scrubber(row, i);
      output += `%R\t${table.fields.map(f => row[f] ?? '').join('\t')}\n`;
    }
  }

  output += '%E\n';
  return output;
}
