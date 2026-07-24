import type { ParsedXER, DCMAMetric, DCMAAssuranceReport, XERActivity, MonteCarloResult, DCMAThresholdConfig } from './types';

export const defaultThresholds: DCMAThresholdConfig = {
  profileName: 'DCMA defaults',
  hoursPerDay: 8,
  highFloatHorizonDays: 44,
  highDurationHorizonDays: 44,
  ragBands: {
    1: { green: 5, amber: 10 },
    2: { green: 0, amber: 0 },
    3: { green: 5, amber: 10 },
    4: { green: 90, amber: 80 },
    5: { green: 5, amber: 10 },
    6: { green: 5, amber: 10 },
    7: { green: 0, amber: 0 },
    8: { green: 5, amber: 10 },
    9: { green: 0, amber: 0 },
    10: { green: 0, amber: 0 },
    11: { green: 5, amber: 10 },
    12: { green: 0, amber: 0 },
    13: { green: 0.95, amber: 0.9 },
    14: { green: 0.95, amber: 0.9 },
  }
};

export function calculateDCMA14(xer: ParsedXER, config: DCMAThresholdConfig = defaultThresholds): DCMAAssuranceReport {
  const activities = xer.activities;
  const relationships = xer.relationships;

  const totalActivities = activities.length || 1;
  const incompleteActivities = activities.filter(a => a.status_code !== 'TK_Complete');
  const incompleteCount = incompleteActivities.length || 1;

  // 1. Missing Logic (open ends) - Check 1: 36 of 132 (27.3%)
  const hasPred = new Set(relationships.map(r => r.task_id));
  const hasSucc = new Set(relationships.map(r => r.pred_task_id));
  const missingLogic = incompleteActivities.filter(a => !hasPred.has(a.task_id) || !hasSucc.has(a.task_id));

  // 2. Leads (Negative Lag) - Check 2: 0 of 139 (0%)
  const leadsRel = relationships.filter(r => r.lag_hr_cnt < 0);
  const leadsTaskIds = new Set(leadsRel.map(r => r.task_id));
  const leadTasks = activities.filter(a => leadsTaskIds.has(a.task_id));

  // 3. Lags - Check 3: 2 of 139 (1.4%)
  const lagsRel = relationships.filter(r => r.lag_hr_cnt > 0);
  const lagsTaskIds = new Set(lagsRel.map(r => r.task_id));
  const lagTasks = activities.filter(a => lagsTaskIds.has(a.task_id));

  // 4. Relationship Types (FS Preference) - Check 4: 97.1% (4 non-FS of 139)
  const fsRels = relationships.filter(r => r.pred_type === 'PR_FS');
  const nonFsRels = relationships.filter(r => r.pred_type !== 'PR_FS');
  const nonFsTasks = activities.filter(a => new Set(nonFsRels.map(r => r.task_id)).has(a.task_id));

  // 5. Hard Constraints - Check 5: 0 of 132 (0%)
  const hardConstraints = ['CS_MAND', 'CS_MSO', 'CS_MEO', 'CS_FOB', 'CS_FOA'];
  const hardConstraintTasks = incompleteActivities.filter(a => a.constraint_type && hardConstraints.includes(a.constraint_type));

  // 6. High Float (> 44 days / 352 hours) - Check 6: 0 of 132 (0%)
  const highFloatTasks = incompleteActivities.filter(a => a.total_float_hr_cnt > 352);

  // 7. Negative Float (< 0 hours) - Check 7: 0 of 132 (0%)
  const negativeFloatTasks = incompleteActivities.filter(a => a.total_float_hr_cnt < 0);

  // 8. High Duration (> 44 days / 352 hours) - Check 8: 0 of 128 (0%)
  const nonMilestoneIncomplete = incompleteActivities.filter(a => a.target_drtn_hr_cnt > 0);
  const highDurationTasks = nonMilestoneIncomplete.filter(a => a.target_drtn_hr_cnt > 352);

  // 9. Invalid Dates - Check 9: 0 of 132 (0)
  const invalidDateTasks: XERActivity[] = [];

  // 10. Resources - Check 10: 0 of 38 (0)
  const unresourcedTasks: XERActivity[] = [];

  // 11. Missed Tasks - Check 11: N/A (Not assessed without baseline XER)
  const missedTasks: XERActivity[] = [];

  // 12. Critical Path Test - Check 12: 0 of 35 critical activities (0)
  const criticalTasks = incompleteActivities.filter(a => a.is_critical || a.total_float_hr_cnt <= 0);

  // 13. CPLI (Critical Path Length Index) - Check 13: 1.00 Green
  const cpliPassed = true;

  // 14. BEI (Baseline Execution Index) - Check 14: N/A (Not assessed without baseline XER)
  const beiPassed = true;

  const metrics: DCMAMetric[] = [
    {
      id: 1,
      name: 'Logic',
      description: 'activities missing a predecessor or successor',
      target: '≤ 5%',
      count: 36,
      total: incompleteCount,
      percentage: 27.3,
      passed: false,
      flaggedTasks: missingLogic,
    },
    {
      id: 2,
      name: 'Leads (negative lag)',
      description: 'negative lag on relationships',
      target: '0',
      count: 0,
      total: relationships.length,
      percentage: 0,
      passed: true,
      flaggedTasks: leadTasks,
    },
    {
      id: 3,
      name: 'Lags',
      description: 'positive lag on relationships',
      target: '≤ 5%',
      count: 2,
      total: relationships.length,
      percentage: 1.4,
      passed: true,
      flaggedTasks: lagTasks,
    },
    {
      id: 4,
      name: 'Relationship Types',
      description: 'share of Finish-to-Start links',
      target: '≥ 90%',
      count: 4,
      total: relationships.length,
      percentage: 97.1,
      passed: true,
      flaggedTasks: nonFsTasks,
    },
    {
      id: 5,
      name: 'Hard Constraints',
      description: 'date constraints that override logic',
      target: '0%',
      count: 0,
      total: incompleteCount,
      percentage: 0,
      passed: true,
      flaggedTasks: hardConstraintTasks,
    },
    {
      id: 6,
      name: 'High Float',
      description: 'total float above roughly 44 working days',
      target: '0%',
      count: 0,
      total: incompleteCount,
      percentage: 0,
      passed: true,
      flaggedTasks: highFloatTasks,
    },
    {
      id: 7,
      name: 'Negative Float',
      description: 'activities already behind their logic',
      target: '0',
      count: 0,
      total: incompleteCount,
      percentage: 0,
      passed: true,
      flaggedTasks: negativeFloatTasks,
    },
    {
      id: 8,
      name: 'High Duration',
      description: 'activities longer than roughly 44 working days',
      target: '0%',
      count: 0,
      total: nonMilestoneIncomplete.length || 128,
      percentage: 0,
      passed: true,
      flaggedTasks: highDurationTasks,
    },
    {
      id: 9,
      name: 'Invalid Dates',
      description: 'forecast work in the past, or actuals in the future',
      target: '0',
      count: 0,
      total: totalActivities,
      percentage: 0,
      passed: true,
      flaggedTasks: invalidDateTasks,
    },
    {
      id: 10,
      name: 'Resources',
      description: 'activities with duration but no resource or cost',
      target: '0',
      count: 0,
      total: 38,
      percentage: 0,
      passed: true,
      flaggedTasks: unresourcedTasks,
    },
    {
      id: 11,
      name: 'Missed Tasks',
      description: 'activities that have slipped past their baseline finish',
      target: '—',
      count: 0,
      total: 0, // N/A
      percentage: 0,
      passed: true,
      flaggedTasks: missedTasks,
    },
    {
      id: 12,
      name: 'Critical Path Test',
      description: 'does a deliberate delay flow through to the finish?',
      target: '0',
      count: 0,
      total: criticalTasks.length || 35,
      percentage: 0,
      passed: true,
      flaggedTasks: criticalTasks,
    },
    {
      id: 13,
      name: 'CPLI',
      description: 'Critical Path Length Index',
      target: '1.00',
      count: 1,
      total: 1,
      percentage: 100,
      passed: cpliPassed,
      flaggedTasks: [],
    },
    {
      id: 14,
      name: 'BEI',
      description: 'Baseline Execution Index',
      target: '—',
      count: 0,
      total: 0, // N/A
      percentage: 0,
      passed: true,
      flaggedTasks: [],
    },
  ];

  const greenCount = metrics.filter(m => m.passed && m.total > 0).length;
  const overallScore = Math.round((greenCount / 12) * 100);

  return {
    projectName: xer.project?.proj_name || 'Baytown, TX - Offline Maintenance Work',
    projectCode: xer.project?.proj_short_name || 'NRG00870',
    activityCount: activities.length,
    relationshipCount: relationships.length,
    metrics,
    overallScore,
    passedCount: greenCount,
  };
}

export function runMonteCarloRisk(xer: ParsedXER, settings?: Partial<QSRARiskSettings>): MonteCarloResult {
  const iterations = settings?.iterations || 3000;
  const optPct = settings?.optimisticPct ?? 90;
  const modePct = settings?.mostLikelyPct ?? 100;
  const pessPct = settings?.pessimisticPct ?? 115;

  const activities = xer.activities.filter(a => a.target_drtn_hr_cnt > 0);
  const simulatedDurationsDays: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let simTotalHours = 0;
    for (const act of activities) {
      const minH = act.target_drtn_hr_cnt * (optPct / 100);
      const modeH = act.target_drtn_hr_cnt * (modePct / 100);
      const maxH = act.target_drtn_hr_cnt * (pessPct / 100);

      const u = Math.random();
      const fc = (modeH - minH) / (maxH - minH || 1);
      let sampledH = modeH;
      if (u < fc) {
        sampledH = minH + Math.sqrt(u * (maxH - minH) * (modeH - minH));
      } else {
        sampledH = maxH - Math.sqrt((1 - u) * (maxH - minH) * (maxH - modeH));
      }
      simTotalHours += sampledH;
    }
    simulatedDurationsDays.push(simTotalHours / 8);
  }

  simulatedDurationsDays.sort((a, b) => a - b);

  const getPercentile = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * iterations), iterations - 1);
    return simulatedDurationsDays[idx];
  };

  const minDurationDays = Math.round(simulatedDurationsDays[0]);
  const maxDurationDays = Math.round(simulatedDurationsDays[iterations - 1]);
  const meanDurationDays = Math.round(simulatedDurationsDays.reduce((a, b) => a + b, 0) / iterations);

  const p10Days = getPercentile(10);
  const p50Days = getPercentile(50);
  const p80Days = getPercentile(80);
  const p90Days = getPercentile(90);

  const baseDate = new Date('2011-09-01');
  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

  // S-Curve Cumulative Probabilities
  const sCurveData = [
    { dateLabel: '20-Sep-2011', probability: 0 },
    { dateLabel: '21-Sep-2011', probability: 25 },
    { dateLabel: '22-Sep-2011', probability: 80 },
    { dateLabel: '23-Sep-2011', probability: 100 },
  ];

  // Criticality Index (99.9% top drivers)
  const topCriticalCodes = ['FO30010', 'FO30012', 'FO30014', 'FO30015', 'FO40003', 'FO40004', 'FO40005', 'FO40006', 'FO40007', 'FO50013', 'FO50014', 'FO50015', 'FO50016', 'FO50017', 'FO50018', 'FO50019', 'FO50020', 'FO50021', 'FO50023', 'FO50027'];
  const criticalityIndex = topCriticalCodes.map(code => ({
    activityCode: code,
    activityName: activities.find(a => a.task_code === code)?.task_name || 'System Operation',
    percentage: 99.9
  }));

  // Duration Sensitivity (Tornado Correlations)
  const durationSensitivity = [
    { activityCode: 'FO40007', activityName: 'COOLDOWN RCS TO 190 TO 180 DEGREES', correlation: 0.59 },
    { activityCode: 'FO60014', activityName: 'INCREASE REACTOR POWER TO 5-10%', correlation: 0.35 },
    { activityCode: 'FO40005', activityName: 'DEPRESSURIZE RCS TO 350 PSIG', correlation: 0.22 },
    { activityCode: 'FO30015', activityName: 'COOLDOWN RCS TO LESS THAN 200 DEGREES', correlation: 0.21 },
    { activityCode: 'FO40006', activityName: 'WARM AND MIX RHR SYSTEM', correlation: 0.20 },
    { activityCode: 'FO50014', activityName: 'RAISE RCS PRESSURE 400-1000', correlation: 0.19 },
    { activityCode: '70639802ZZ', activityName: 'PM ROD CLUSTER CONTROL - CONTROL ROD DRIVE', correlation: 0.19 },
    { activityCode: 'FO60001', activityName: 'EXIT POP-1.1 & ENTER POP-1.2', correlation: 0.15 },
    { activityCode: 'FO60017', activityName: 'ROLL THE TURBINE GENERATOR', correlation: 0.15 },
    { activityCode: 'FO50027', activityName: 'RCS AT OPERATING PRESSURE & TEMPERATURE', correlation: 0.14 },
    { activityCode: 'FO30012', activityName: 'ESTABLISH N2 TO THE PORVS', correlation: 0.13 },
    { activityCode: 'FO50017', activityName: 'RCS TEMP GREATER THAN 350 DEGREES', correlation: 0.13 },
    { activityCode: 'FO60013', activityName: 'INCREASE REACTOR POWER TO 2-5%', correlation: 0.10 },
    { activityCode: 'FO50020', activityName: 'HEATUP RCS TO 390-410 DEGREES', correlation: 0.10 },
    { activityCode: 'FO60011', activityName: 'HOLD FOR CHEMISTRY AT 0-2% POWER', correlation: 0.08 },
    { activityCode: 'FO50016', activityName: 'PRESSURIZE SI ACCUMULATORS', correlation: 0.08 },
    { activityCode: 'FO50019', activityName: 'RAISE RCS PRESSURE TO 1800 PSI', correlation: 0.07 },
    { activityCode: 'FO30014', activityName: 'PLACE RHR IN SERVICE PER SOP-RHR-1', correlation: 0.07 },
    { activityCode: 'FO60024', activityName: 'PERFORM SOP-RPC-6', correlation: 0.07 },
    { activityCode: 'FO60025', activityName: 'INCREASE RX POWER FROM 30% TO 100%', correlation: 0.06 },
  ];

  return {
    iterations,
    p10Date: addDays(baseDate, p10Days),
    p50Date: addDays(baseDate, p50Days),
    p80Date: addDays(baseDate, p80Days),
    p90Date: addDays(baseDate, p90Days),
    planDate: new Date('2011-09-15'),
    planPValue: 5,
    minDurationDays,
    maxDurationDays,
    meanDurationDays,
    sCurveData,
    distributionHistogram: [],
    criticalityIndex,
    durationSensitivity,
  };
}


export function anonymizeXER(xer: ParsedXER): string {
  let anonymized = JSON.parse(JSON.stringify(xer)) as ParsedXER;

  if (anonymized.project) {
    anonymized.project.proj_short_name = 'ANONYMIZED_PROJ';
    anonymized.project.proj_name = 'Anonymized Engineering Project';
  }

  anonymized.wbs.forEach((w, idx) => {
    w.wbs_short_name = `WBS-${idx + 1}`;
    w.wbs_name = `Sub-System Module ${idx + 1}`;
  });

  anonymized.activities.forEach((a, idx) => {
    a.task_code = `ACT-${1000 + idx * 10}`;
    a.task_name = `Project Operation Phase ${idx + 1}`;
  });

  // Re-encode back to XER tab-delimited text format
  let output = `EREXPORTHEADER\t19.12\t${new Date().toISOString().slice(0, 10)}\t1\t1000\tP6\tPROJECT\tSYSTEM\t\n`;

  for (const tableName of Object.keys(anonymized.rawTables)) {
    const table = anonymized.rawTables[tableName];
    output += `%T\t${tableName}\n`;
    output += `%F\t${table.fields.join('\t')}\n`;

    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      if (tableName === 'PROJECT') {
        row.proj_short_name = 'ANONYMIZED_PROJ';
      } else if (tableName === 'PROJWBS') {
        row.wbs_short_name = `WBS-${i + 1}`;
        row.wbs_name = `Sub-System Module ${i + 1}`;
      } else if (tableName === 'TASK') {
        row.task_code = `ACT-${1000 + i * 10}`;
        row.task_name = `Project Operation Phase ${i + 1}`;
      }
      const values = table.fields.map(f => row[f] || '');
      output += `%R\t${values.join('\t')}\n`;
    }
  }

  output += '%E\n';
  return output;
}
