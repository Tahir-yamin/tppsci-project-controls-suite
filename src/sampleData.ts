/**
 * Sample schedules.
 *
 * These are generated from a small activity spec and then *scheduled* — a
 * forward and backward pass on a 5-day / 8-hour calendar produces the dates and
 * float that go into the XER. The demo data is therefore internally consistent:
 * the dates agree with the logic, float agrees with the network, and progress
 * agrees with the data date. That matters because the whole suite is judged on
 * what it shows before a user loads a file of their own.
 */

const HOURS_PER_DAY = 8;

type RelType = 'PR_FS' | 'PR_SS' | 'PR_FF' | 'PR_SF';

interface SpecActivity {
  code: string;
  name: string;
  wbs: string;
  /** Duration in working days; 0 makes it a milestone. */
  days: number;
  preds?: { code: string; type?: RelType; lagDays?: number }[];
  constraint?: string;
  /** Omit to have the activity resourced with a default crew. */
  unresourced?: boolean;
  finishMilestone?: boolean;
}

interface SpecProject {
  id: string;
  shortName: string;
  name: string;
  /** Project start; every date is derived forward from here. */
  start: string;
  /** Data date; progress is applied to everything scheduled before it. */
  dataDate: string;
  wbs: { id: string; code: string; name: string; parent?: string }[];
  activities: SpecActivity[];
}

// --------------------------------------------------------------------------
// Working-calendar helpers (Mon-Fri, 8h/day)
// --------------------------------------------------------------------------

function isWorkday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** Advance `workdays` working days from a date, landing on a working day. */
function addWorkdays(from: Date, workdays: number): Date {
  const d = new Date(from.getTime());
  let remaining = Math.round(workdays);
  while (!isWorkday(d)) d.setUTCDate(d.getUTCDate() + 1);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkday(d)) remaining--;
  }
  return d;
}

function fmtXERDate(d: Date, hour: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(hour)}:00`;
}

// --------------------------------------------------------------------------
// Scheduler
// --------------------------------------------------------------------------

interface Scheduled extends SpecActivity {
  taskId: number;
  esDay: number;
  efDay: number;
  lsDay: number;
  lfDay: number;
  totalFloatDays: number;
  status: 'TK_NotStart' | 'TK_Active' | 'TK_Complete';
  percentComplete: number;
}

function scheduleProject(spec: SpecProject): Scheduled[] {
  const byCode = new Map<string, SpecActivity>(spec.activities.map(a => [a.code, a]));
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  // Depth-first topological order. The specs below are acyclic by construction;
  // the guard exists so a future edit fails loudly rather than hanging.
  const visit = (code: string) => {
    const s = state.get(code);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`Circular logic in sample data at ${code}`);
    state.set(code, 'visiting');
    for (const p of byCode.get(code)?.preds ?? []) {
      if (!byCode.has(p.code)) throw new Error(`Unknown predecessor ${p.code} for ${code}`);
      visit(p.code);
    }
    state.set(code, 'done');
    order.push(code);
  };
  spec.activities.forEach(a => visit(a.code));

  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  for (const code of order) {
    const a = byCode.get(code)!;
    let start = 0;
    for (const p of a.preds ?? []) {
      const lag = p.lagDays ?? 0;
      const type = p.type ?? 'PR_FS';
      const candidate =
        type === 'PR_SS' ? es.get(p.code)! + lag
        : type === 'PR_FF' ? ef.get(p.code)! + lag - a.days
        : type === 'PR_SF' ? es.get(p.code)! + lag - a.days
        : ef.get(p.code)! + lag;
      start = Math.max(start, candidate);
    }
    es.set(code, start);
    ef.set(code, start + a.days);
  }

  const projectFinish = Math.max(...[...ef.values()]);

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  const succs = new Map<string, { code: string; type: RelType; lagDays: number }[]>();
  spec.activities.forEach(a => {
    for (const p of a.preds ?? []) {
      const list = succs.get(p.code) ?? [];
      list.push({ code: a.code, type: p.type ?? 'PR_FS', lagDays: p.lagDays ?? 0 });
      succs.set(p.code, list);
    }
  });

  for (let i = order.length - 1; i >= 0; i--) {
    const code = order[i];
    const a = byCode.get(code)!;
    let finish = projectFinish;
    for (const s of succs.get(code) ?? []) {
      const candidate =
        s.type === 'PR_SS' ? ls.get(s.code)! - s.lagDays + a.days
        : s.type === 'PR_FF' ? lf.get(s.code)! - s.lagDays
        : s.type === 'PR_SF' ? lf.get(s.code)! - s.lagDays + a.days
        : ls.get(s.code)! - s.lagDays;
      finish = Math.min(finish, candidate);
    }
    lf.set(code, finish);
    ls.set(code, finish - a.days);
  }

  const startDate = new Date(`${spec.start}T00:00:00Z`);
  const dataDate = new Date(`${spec.dataDate}T00:00:00Z`);
  const dataDateWorkdayOffset = (() => {
    let count = 0;
    const cursor = new Date(startDate.getTime());
    while (cursor.getTime() < dataDate.getTime()) {
      if (isWorkday(cursor)) count++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  })();

  return spec.activities.map((a, i) => {
    const esDay = es.get(a.code)!;
    const efDay = ef.get(a.code)!;

    // Progress is a function of where the activity sits relative to the data
    // date, so status, remaining duration and actual dates all agree.
    let status: Scheduled['status'] = 'TK_NotStart';
    let percentComplete = 0;
    if (efDay <= dataDateWorkdayOffset) {
      status = 'TK_Complete';
      percentComplete = 100;
    } else if (esDay < dataDateWorkdayOffset) {
      status = 'TK_Active';
      percentComplete = Math.round(((dataDateWorkdayOffset - esDay) / Math.max(1, a.days)) * 100);
    }

    return {
      ...a,
      taskId: 1000 + i,
      esDay,
      efDay,
      lsDay: ls.get(a.code)!,
      lfDay: lf.get(a.code)!,
      totalFloatDays: ls.get(a.code)! - esDay,
      status,
      percentComplete,
    };
  });
}

// --------------------------------------------------------------------------
// XER emitter
// --------------------------------------------------------------------------

function toXER(spec: SpecProject): string {
  const scheduled = scheduleProject(spec);
  const startDate = new Date(`${spec.start}T00:00:00Z`);
  const dataDate = new Date(`${spec.dataDate}T00:00:00Z`);
  const wbsIndex = new Map(spec.wbs.map((w, i) => [w.code, i + 1]));
  const byCode = new Map(scheduled.map(a => [a.code, a]));

  const dayToDate = (day: number) => addWorkdays(startDate, day);

  const projId = 900;
  const lines: string[] = [];

  lines.push(`ERMHDR\t19.12\t${new Date().toISOString().slice(0, 10)}\tProject\tTPPSCI\tSample\tSample\tUSD`);

  lines.push('%T\tPROJECT');
  lines.push('%F\tproj_id\tproj_short_name\tlast_recalc_date\tplan_start_date\tclndr_id');
  lines.push(`%R\t${projId}\t${spec.shortName}\t${fmtXERDate(dataDate, 8)}\t${fmtXERDate(startDate, 8)}\t1`);

  lines.push('%T\tCALENDAR');
  lines.push('%F\tclndr_id\tclndr_name\tday_hr_cnt\tweek_hr_cnt');
  lines.push(`%R\t1\tStandard 5 Day Workweek\t${HOURS_PER_DAY}\t${HOURS_PER_DAY * 5}`);

  lines.push('%T\tPROJWBS');
  lines.push('%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id');
  // The root node carries the readable project title, exactly as P6 exports it.
  lines.push(`%R\t100\t${projId}\t${spec.shortName}\t${spec.name}\t`);
  spec.wbs.forEach(w => {
    const parent = w.parent ? wbsIndex.get(w.parent) : 100;
    lines.push(`%R\t${wbsIndex.get(w.code)}\t${projId}\t${w.code}\t${w.name}\t${parent ?? 100}`);
  });

  lines.push('%T\tTASK');
  lines.push(
    '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code\t' +
      'target_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tfree_float_hr_cnt\t' +
      'target_start_date\ttarget_end_date\tearly_start_date\tearly_end_date\t' +
      'late_start_date\tlate_end_date\tact_start_date\tact_end_date\tcstr_type\tcstr_date',
  );

  scheduled.forEach(a => {
    const wbsId = wbsIndex.get(a.wbs) ?? 100;
    const taskType = a.days === 0 ? (a.finishMilestone ? 'TT_FinMile' : 'TT_Mile') : 'TT_Task';

    const esd = dayToDate(a.esDay);
    const efd = dayToDate(a.efDay);
    const lsd = dayToDate(a.lsDay);
    const lfd = dayToDate(a.lfDay);

    const targetHours = (a.days * HOURS_PER_DAY).toFixed(1);
    const remainHours = ((a.days * HOURS_PER_DAY * (100 - a.percentComplete)) / 100).toFixed(1);
    const floatHours = (a.totalFloatDays * HOURS_PER_DAY).toFixed(1);

    const actStart = a.status === 'TK_NotStart' ? '' : fmtXERDate(esd, 8);
    const actEnd = a.status === 'TK_Complete' ? fmtXERDate(efd, 17) : '';

    lines.push(
      [
        '%R', a.taskId, projId, wbsId, 1, a.code, a.name, taskType, a.status,
        targetHours, remainHours, floatHours, floatHours,
        fmtXERDate(esd, 8), fmtXERDate(efd, 17),
        fmtXERDate(esd, 8), fmtXERDate(efd, 17),
        fmtXERDate(lsd, 8), fmtXERDate(lfd, 17),
        actStart, actEnd,
        a.constraint ?? '', a.constraint ? fmtXERDate(esd, 8) : '',
      ].join('\t'),
    );
  });

  lines.push('%T\tTASKPRED');
  lines.push('%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt');
  let relId = 5000;
  scheduled.forEach(a => {
    (a.preds ?? []).forEach(p => {
      const pred = byCode.get(p.code)!;
      lines.push(
        [
          '%R', relId++, a.taskId, pred.taskId, projId, projId,
          p.type ?? 'PR_FS', ((p.lagDays ?? 0) * HOURS_PER_DAY).toFixed(1),
        ].join('\t'),
      );
    });
  });

  lines.push('%T\tRSRC');
  lines.push('%F\trsrc_id\trsrc_short_name\trsrc_name\trsrc_type');
  lines.push('%R\t1\tCREW-A\tConstruction Crew A\tRT_Labor');
  lines.push('%R\t2\tENG\tEngineering Team\tRT_Labor');

  lines.push('%T\tTASKRSRC');
  lines.push('%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\ttarget_qty\ttarget_cost');
  let assignmentId = 8000;
  scheduled.forEach(a => {
    if (a.unresourced || a.days === 0) return;
    const rsrc = a.wbs.includes('ENG') || a.wbs.includes('DES') ? 2 : 1;
    const qty = a.days * HOURS_PER_DAY;
    lines.push(
      ['%R', assignmentId++, a.taskId, projId, rsrc, qty.toFixed(1), (qty * 85).toFixed(2)].join('\t'),
    );
  });

  lines.push('%E');
  return lines.join('\n') + '\n';
}

// --------------------------------------------------------------------------
// Project specs
// --------------------------------------------------------------------------

/**
 * A mid-size outage schedule with genuinely parallel work fronts, so criticality
 * and sensitivity in the risk module have something real to discriminate between.
 */
const outageSpec: SpecProject = {
  id: 'NRG00870',
  shortName: 'NRG00870',
  name: 'Baytown TX — Unit 2 Offline Maintenance Outage',
  start: '2026-03-02',
  dataDate: '2026-04-13',
  wbs: [
    { id: 'w1', code: 'FO.PREP', name: 'Outage Preparation' },
    { id: 'w2', code: 'FO.SHUT', name: 'Plant Shutdown & Cooldown' },
    { id: 'w3', code: 'FO.MECH', name: 'Mechanical Maintenance' },
    { id: 'w4', code: 'FO.ELEC', name: 'Electrical & I&C' },
    { id: 'w5', code: 'FO.VALVE', name: 'Valve & Pump Overhaul' },
    { id: 'w6', code: 'FO.START', name: 'Startup & Return to Service' },
  ],
  activities: [
    { code: 'MS-1000', name: 'Outage window opens', wbs: 'FO.PREP', days: 0 },
    { code: 'PREP-1010', name: 'Mobilise contractor workforce', wbs: 'FO.PREP', days: 5, preds: [{ code: 'MS-1000' }] },
    { code: 'PREP-1020', name: 'Scaffold erection — turbine hall', wbs: 'FO.PREP', days: 8, preds: [{ code: 'PREP-1010' }] },
    { code: 'PREP-1030', name: 'Pre-outage isolation & tagging', wbs: 'FO.PREP', days: 4, preds: [{ code: 'PREP-1010' }] },
    { code: 'PREP-1040', name: 'Spares receipt & staging', wbs: 'FO.PREP', days: 6, preds: [{ code: 'PREP-1010' }], unresourced: true },

    { code: 'SHUT-2010', name: 'Reduce load to 30% power', wbs: 'FO.SHUT', days: 2, preds: [{ code: 'PREP-1030' }] },
    { code: 'SHUT-2020', name: 'Generator offline & breaker open', wbs: 'FO.SHUT', days: 1, preds: [{ code: 'SHUT-2010' }] },
    { code: 'SHUT-2030', name: 'Cooldown RCS to below 200 degrees', wbs: 'FO.SHUT', days: 4, preds: [{ code: 'SHUT-2020' }] },
    { code: 'SHUT-2040', name: 'Depressurise and drain to mid-loop', wbs: 'FO.SHUT', days: 3, preds: [{ code: 'SHUT-2030' }] },
    { code: 'MS-2050', name: 'Plant available for maintenance', wbs: 'FO.SHUT', days: 0, preds: [{ code: 'SHUT-2040' }] },

    { code: 'MECH-3010', name: 'Turbine casing removal', wbs: 'FO.MECH', days: 6, preds: [{ code: 'MS-2050' }, { code: 'PREP-1020' }] },
    { code: 'MECH-3020', name: 'Rotor inspection & NDT', wbs: 'FO.MECH', days: 10, preds: [{ code: 'MECH-3010' }] },
    { code: 'MECH-3030', name: 'Blade repair & rebalancing', wbs: 'FO.MECH', days: 12, preds: [{ code: 'MECH-3020' }] },
    { code: 'MECH-3040', name: 'Bearing replacement', wbs: 'FO.MECH', days: 5, preds: [{ code: 'MECH-3020' }] },
    { code: 'MECH-3050', name: 'Turbine casing reinstatement', wbs: 'FO.MECH', days: 6, preds: [{ code: 'MECH-3030' }, { code: 'MECH-3040' }] },

    { code: 'ELEC-4010', name: 'Generator stator wedge survey', wbs: 'FO.ELEC', days: 7, preds: [{ code: 'MS-2050' }] },
    { code: 'ELEC-4020', name: 'Excitation system upgrade', wbs: 'FO.ELEC', days: 9, preds: [{ code: 'ELEC-4010' }] },
    { code: 'ELEC-4030', name: 'Protection relay calibration', wbs: 'FO.ELEC', days: 4, preds: [{ code: 'ELEC-4020' }] },
    { code: 'ELEC-4040', name: 'I&C loop checks', wbs: 'FO.ELEC', days: 6, preds: [{ code: 'ELEC-4030', type: 'PR_SS', lagDays: 2 }] },

    { code: 'VLV-5010', name: 'Main steam isolation valve overhaul', wbs: 'FO.VALVE', days: 8, preds: [{ code: 'MS-2050' }] },
    { code: 'VLV-5020', name: 'Feedwater pump seal replacement', wbs: 'FO.VALVE', days: 5, preds: [{ code: 'MS-2050' }] },
    { code: 'VLV-5030', name: 'Safety relief valve bench test', wbs: 'FO.VALVE', days: 6, preds: [{ code: 'VLV-5010' }, { code: 'PREP-1040' }] },
    { code: 'VLV-5040', name: 'Valve reinstatement & leak test', wbs: 'FO.VALVE', days: 4, preds: [{ code: 'VLV-5030' }, { code: 'VLV-5020' }] },

    { code: 'START-6010', name: 'System restoration & de-isolation', wbs: 'FO.START', days: 4, preds: [{ code: 'MECH-3050' }, { code: 'ELEC-4040' }, { code: 'VLV-5040' }] },
    { code: 'START-6020', name: 'Scaffold dismantling', wbs: 'FO.START', days: 5, preds: [{ code: 'MECH-3050' }] },
    { code: 'START-6030', name: 'Fill and vent RCS', wbs: 'FO.START', days: 3, preds: [{ code: 'START-6010' }] },
    { code: 'START-6040', name: 'Heatup to operating temperature', wbs: 'FO.START', days: 4, preds: [{ code: 'START-6030' }, { code: 'START-6020' }] },
    { code: 'START-6050', name: 'Roll turbine and synchronise', wbs: 'FO.START', days: 3, preds: [{ code: 'START-6040' }], constraint: 'CS_MSO' },
    { code: 'START-6060', name: 'Power ascension to 100%', wbs: 'FO.START', days: 5, preds: [{ code: 'START-6050' }, { code: 'ELEC-4030' }] },
    { code: 'MS-6070', name: 'Unit returned to service', wbs: 'FO.START', days: 0, preds: [{ code: 'START-6060' }], finishMilestone: true },
  ],
};

const railSpec: SpecProject = {
  id: 'DEMO-RAIL-01',
  shortName: 'DEMO-RAIL-01',
  name: 'Metro Rail Infrastructure Expansion — Phase 2',
  start: '2026-01-05',
  dataDate: '2026-04-13',
  wbs: [
    { id: 'r1', code: 'RAIL.ENG', name: 'Engineering & Civil Design' },
    { id: 'r2', code: 'RAIL.PROC', name: 'Track & Signals Procurement' },
    { id: 'r3', code: 'RAIL.CIV', name: 'Civils & Earthworks' },
    { id: 'r4', code: 'RAIL.TRACK', name: 'Track Laying & Electrification' },
    { id: 'r5', code: 'RAIL.TEST', name: 'Testing & Commissioning' },
  ],
  activities: [
    { code: 'MS-100', name: 'Notice to proceed', wbs: 'RAIL.ENG', days: 0 },
    { code: 'ENG-101', name: 'Geotechnical survey & alignment', wbs: 'RAIL.ENG', days: 15, preds: [{ code: 'MS-100' }] },
    { code: 'ENG-102', name: 'Track detailed civil specifications', wbs: 'RAIL.ENG', days: 25, preds: [{ code: 'ENG-101' }] },
    { code: 'ENG-103', name: 'Signalling & OLE design', wbs: 'RAIL.ENG', days: 30, preds: [{ code: 'ENG-101' }] },
    { code: 'ENG-104', name: 'Design assurance & approval', wbs: 'RAIL.ENG', days: 10, preds: [{ code: 'ENG-102' }, { code: 'ENG-103' }] },

    { code: 'PROC-201', name: 'Steel rail & sleeper procurement', wbs: 'RAIL.PROC', days: 45, preds: [{ code: 'ENG-102' }], unresourced: true },
    { code: 'PROC-202', name: 'Signalling equipment procurement', wbs: 'RAIL.PROC', days: 60, preds: [{ code: 'ENG-103' }], unresourced: true },
    { code: 'PROC-203', name: 'OLE mast & catenary delivery', wbs: 'RAIL.PROC', days: 40, preds: [{ code: 'ENG-104' }], unresourced: true },

    { code: 'CIV-301', name: 'Site clearance & haul roads', wbs: 'RAIL.CIV', days: 12, preds: [{ code: 'ENG-101' }] },
    { code: 'CIV-302', name: 'Earthworks & sub-grade (km 0-10)', wbs: 'RAIL.CIV', days: 35, preds: [{ code: 'CIV-301' }, { code: 'ENG-104' }] },
    { code: 'CIV-303', name: 'Drainage & ducting', wbs: 'RAIL.CIV', days: 20, preds: [{ code: 'CIV-302', type: 'PR_SS', lagDays: 10 }] },
    { code: 'CIV-304', name: 'Structures & underbridge works', wbs: 'RAIL.CIV', days: 30, preds: [{ code: 'CIV-301' }] },

    { code: 'TRK-401', name: 'Ballast placement (km 0-10)', wbs: 'RAIL.TRACK', days: 18, preds: [{ code: 'CIV-303' }, { code: 'PROC-201' }] },
    { code: 'TRK-402', name: 'Sleeper and rail laying', wbs: 'RAIL.TRACK', days: 28, preds: [{ code: 'TRK-401' }] },
    { code: 'TRK-403', name: 'Tamping & alignment', wbs: 'RAIL.TRACK', days: 12, preds: [{ code: 'TRK-402' }] },
    { code: 'TRK-404', name: 'OLE mast erection & wiring', wbs: 'RAIL.TRACK', days: 25, preds: [{ code: 'TRK-402', type: 'PR_SS', lagDays: 8 }, { code: 'PROC-203' }] },
    { code: 'TRK-405', name: 'Signalling installation', wbs: 'RAIL.TRACK', days: 22, preds: [{ code: 'TRK-403' }, { code: 'PROC-202' }] },

    { code: 'TST-501', name: 'Static testing & energisation', wbs: 'RAIL.TEST', days: 10, preds: [{ code: 'TRK-404' }, { code: 'TRK-405' }] },
    { code: 'TST-502', name: 'Dynamic testing & driver training', wbs: 'RAIL.TEST', days: 15, preds: [{ code: 'TST-501' }] },
    { code: 'TST-503', name: 'Safety case & authority approval', wbs: 'RAIL.TEST', days: 12, preds: [{ code: 'TST-502' }], constraint: 'CS_MEO' },
    { code: 'MS-600', name: 'Entry into passenger service', wbs: 'RAIL.TEST', days: 0, preds: [{ code: 'TST-503' }], finishMilestone: true },
  ],
};

const highwaySpec: SpecProject = {
  id: 'HIGHWAY-UK-02',
  shortName: 'HIGHWAY-UK-02',
  name: 'Smart Motorway Resurfacing & Barrier Replacement',
  start: '2026-02-02',
  dataDate: '2026-04-13',
  wbs: [
    { id: 'h1', code: 'HWY.DES', name: 'Design & Consents' },
    { id: 'h2', code: 'HWY.TRAF', name: 'Traffic Management' },
    { id: 'h3', code: 'HWY.PAVE', name: 'Milling & Resurfacing' },
    { id: 'h4', code: 'HWY.BAR', name: 'Barrier & Drainage' },
    { id: 'h5', code: 'HWY.HAND', name: 'Handback' },
  ],
  activities: [
    { code: 'MS-10', name: 'Works order issued', wbs: 'HWY.DES', days: 0 },
    { code: 'DES-11', name: 'Pavement condition survey', wbs: 'HWY.DES', days: 8, preds: [{ code: 'MS-10' }] },
    { code: 'DES-12', name: 'Resurfacing design & mix approval', wbs: 'HWY.DES', days: 12, preds: [{ code: 'DES-11' }] },
    { code: 'DES-13', name: 'Traffic management plan consent', wbs: 'HWY.DES', days: 15, preds: [{ code: 'DES-11' }] },

    { code: 'TRAF-21', name: 'Advance signage installation', wbs: 'HWY.TRAF', days: 4, preds: [{ code: 'DES-13' }] },
    { code: 'TRAF-22', name: 'Contraflow setup (km 12-18)', wbs: 'HWY.TRAF', days: 6, preds: [{ code: 'TRAF-21' }] },
    { code: 'TRAF-23', name: 'Night closure regime — ongoing', wbs: 'HWY.TRAF', days: 40, preds: [{ code: 'TRAF-22', type: 'PR_SS' }] },

    { code: 'PAVE-31', name: 'Surface milling 50mm (km 12-15)', wbs: 'HWY.PAVE', days: 10, preds: [{ code: 'TRAF-22' }, { code: 'DES-12' }] },
    { code: 'PAVE-32', name: 'Binder course laying (km 12-15)', wbs: 'HWY.PAVE', days: 8, preds: [{ code: 'PAVE-31' }] },
    { code: 'PAVE-33', name: 'Surface milling 50mm (km 15-18)', wbs: 'HWY.PAVE', days: 10, preds: [{ code: 'PAVE-31' }] },
    { code: 'PAVE-34', name: 'Binder course laying (km 15-18)', wbs: 'HWY.PAVE', days: 8, preds: [{ code: 'PAVE-33' }, { code: 'PAVE-32' }] },
    { code: 'PAVE-35', name: 'Surface course & texture depth test', wbs: 'HWY.PAVE', days: 12, preds: [{ code: 'PAVE-34' }] },

    { code: 'BAR-41', name: 'Central reserve barrier removal', wbs: 'HWY.BAR', days: 9, preds: [{ code: 'TRAF-22' }] },
    { code: 'BAR-42', name: 'Concrete barrier installation', wbs: 'HWY.BAR', days: 18, preds: [{ code: 'BAR-41' }] },
    { code: 'BAR-43', name: 'Drainage gully replacement', wbs: 'HWY.BAR', days: 12, preds: [{ code: 'BAR-41' }], unresourced: true },

    { code: 'HAND-51', name: 'Road markings & studs', wbs: 'HWY.HAND', days: 6, preds: [{ code: 'PAVE-35' }, { code: 'BAR-42' }] },
    { code: 'HAND-52', name: 'Traffic management removal', wbs: 'HWY.HAND', days: 4, preds: [{ code: 'HAND-51' }, { code: 'BAR-43' }, { code: 'TRAF-23' }] },
    { code: 'HAND-53', name: 'Final inspection & certification', wbs: 'HWY.HAND', days: 5, preds: [{ code: 'HAND-52' }] },
    { code: 'MS-60', name: 'Motorway handed back', wbs: 'HWY.HAND', days: 0, preds: [{ code: 'HAND-53' }], finishMilestone: true },
  ],
};

export function generateDetailedXER(): string {
  return toXER(outageSpec);
}

export function generateMetroRailXER(): string {
  return toXER(railSpec);
}

export function generateHighwayXER(): string {
  return toXER(highwaySpec);
}

export const sampleProjects = [
  {
    id: outageSpec.shortName,
    shortName: outageSpec.shortName,
    name: `${outageSpec.shortName} — ${outageSpec.name}`,
    dataDate: outageSpec.dataDate,
    generateXER: generateDetailedXER,
  },
  {
    id: railSpec.shortName,
    shortName: railSpec.shortName,
    name: `${railSpec.shortName} — ${railSpec.name}`,
    dataDate: railSpec.dataDate,
    generateXER: generateMetroRailXER,
  },
  {
    id: highwaySpec.shortName,
    shortName: highwaySpec.shortName,
    name: `${highwaySpec.shortName} — ${highwaySpec.name}`,
    dataDate: highwaySpec.dataDate,
    generateXER: generateHighwayXER,
  },
];
