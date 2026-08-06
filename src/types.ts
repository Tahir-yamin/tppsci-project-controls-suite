export interface XERActivity {
  task_id: string;
  task_code: string;
  task_name: string;
  wbs_id: string;
  status_code: string; // TK_NotStart, TK_Active, TK_Complete
  target_start_date?: string;
  target_end_date?: string;
  act_start_date?: string;
  act_end_date?: string;
  early_start_date?: string;
  early_end_date?: string;
  late_start_date?: string;
  late_end_date?: string;
  target_drtn_hr_cnt: number; // duration in hours
  remain_drtn_hr_cnt: number;
  total_float_hr_cnt: number;
  free_float_hr_cnt: number;
  constraint_type?: string;
  constraint_date?: string;
  /** TT_Task, TT_Mile, TT_FinMile, TT_LOE, TT_WBS */
  task_type?: string;
  is_milestone?: boolean;
  is_critical?: boolean;
}

export interface XERRelationship {
  task_pred_id: string;
  task_id: string; // successor
  pred_task_id: string; // predecessor
  pred_type: string; // PR_FS, PR_SS, PR_FF, PR_SF
  lag_hr_cnt: number;
}

export interface XERWBS {
  wbs_id: string;
  wbs_short_name: string;
  wbs_name: string;
  parent_wbs_id?: string;
  seq_num?: number;
}

export interface XERProject {
  proj_id: string;
  proj_short_name: string;
  proj_name: string;
  create_date?: string;
  last_recalc_date?: string;
}

export interface ParsedXER {
  project: XERProject | null;
  wbs: XERWBS[];
  activities: XERActivity[];
  relationships: XERRelationship[];
  tables: Record<string, string[][]>;
  rawTables: Record<string, { fields: string[]; rows: Record<string, string>[] }>;
}

export interface DCMAThresholdConfig {
  profileName: string;
  hoursPerDay: number;
  highFloatHorizonDays: number;
  highDurationHorizonDays: number;
  ragBands: Record<number, { green: number; amber: number }>;
}

export type DCMARag = 'green' | 'amber' | 'red' | 'na';

export interface DCMAMetric {
  id: number;
  name: string;
  description: string;
  target: string;
  /** Unit the measured value is expressed in. */
  unit: 'count' | 'percent' | 'ratio';
  /** Raw numerator (flagged items) — 0 when the check is a ratio. */
  count: number;
  /** Denominator the check is measured against. */
  total: number;
  /** The measured value in `unit` terms; this is what is compared to the bands. */
  value: number;
  percentage: number;
  rag: DCMARag;
  passed: boolean;
  /** Populated when the check cannot be assessed (e.g. no baseline loaded). */
  notAssessedReason?: string;
  flaggedTasks: XERActivity[];
}

export interface DCMAAssuranceReport {
  projectName: string;
  projectCode: string;
  dataDate: Date | null;
  activityCount: number;
  incompleteCount: number;
  relationshipCount: number;
  metrics: DCMAMetric[];
  overallScore: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  naCount: number;
  passedCount: number;
}

export interface QSRARiskSettings {
  optimisticPct: number; // e.g. 90
  mostLikelyPct: number; // e.g. 100
  pessimisticPct: number; // e.g. 115
  distribution: 'Triangular' | 'Beta-PERT';
  ignoreHardConstraints: boolean;
  iterations: number;
  seed: number;
  correlation: string;
  /** Divisor used to convert XER hour counts into working days. */
  hoursPerDay: number;
}

export interface QSRARangeRow {
  activityCode: string;
  activityName: string;
  wbsName: string;
  durationWd: number;
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
  source: string;
}

export interface MonteCarloResult {
  iterations: number;
  seed: number;
  distribution: QSRARiskSettings['distribution'];
  p10Date: Date;
  p50Date: Date;
  p80Date: Date;
  p90Date: Date;
  /** Deterministic (as-scheduled) finish produced by the same CPM engine. */
  planDate: Date;
  /** Confidence the deterministic date actually carries, 0-100. */
  planPValue: number;
  minDurationDays: number;
  maxDurationDays: number;
  meanDurationDays: number;
  p50DurationDays: number;
  sCurveData: { dateLabel: string; date: Date; probability: number }[];
  distributionHistogram: { binLabel: string; count: number }[];
  criticalityIndex: { activityCode: string; activityName: string; percentage: number }[];
  durationSensitivity: { activityCode: string; activityName: string; correlation: number }[];
  /** Honest reporting of what the engine could and could not do. */
  diagnostics: {
    activitiesSimulated: number;
    openEnds: number;
    cyclesDropped: number;
    leads: number;
    lags: number;
    /** Working days between the engine's CPM finish and the XER's own dates. */
    reconciliationDeltaDays: number | null;
  };
}

export interface TimeChainageItem {
  task_code: string;
  task_name: string;
  start_chainage: number; // e.g. km 10.5
  end_chainage: number;   // e.g. km 14.2
  start_date: Date;
  end_date: Date;
  is_critical?: boolean;
}

export interface MentorTopic {
  id: string;
  category: 'Logic' | 'Constraints' | 'Calendars & durations' | 'Progress' | 'Structure';
  code: string;
  title: string;
  whyItMatters: string;
  howToFixInP6: string;
  whenItsFine: string;
  getAffectedTasks: (activities: XERActivity[], relationships: XERRelationship[]) => XERActivity[];
}

