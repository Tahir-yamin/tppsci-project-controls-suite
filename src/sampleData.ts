export const sampleProjects = [
  {
    id: 'NRG00870',
    shortName: 'NRG00870',
    name: 'NRG00870 — Baytown, TX - Offline Maintenance Work',
    dataDate: '2011-08-01',
    generateXER: generateDetailedXER
  },
  {
    id: 'DEMO-RAIL-01',
    shortName: 'DEMO-RAIL-01',
    name: 'DEMO-RAIL-01 — Metro Rail Infrastructure Expansion',
    dataDate: '2026-01-01',
    generateXER: generateMetroRailXER
  },
  {
    id: 'HIGHWAY-UK-02',
    shortName: 'HIGHWAY-UK-02',
    name: 'HIGHWAY-UK-02 — Smart Motorway Resurfacing & Barrier Works',
    dataDate: '2026-03-15',
    generateXER: generateHighwayXER
  }
];

export function generateDetailedXER(): string {
  const wbsRows = [
    `%R\t1\t101\tNRG00870.FO\tForced Outage\t`,
    `%R\t2\t101\tNRG00870.FO.PS\tPower Systems\t1`,
    `%R\t3\t101\tNRG00870.FO.PS.69KV\t69 KV\t2`,
    `%R\t4\t101\tNRG00870.FO.PS.138KV\t138 KV\t2`,
    `%R\t5\t101\tNRG00870.FO.PSD\tPlant Shutdown\t1`,
    `%R\t6\t101\tNRG00870.FO.CVC\tChemical and Volume Control\t1`,
  ];

  let taskRows = '';
  const sampleCodes = [
    'OPS980010H', 'OPS980010R', 'OPS980011H', 'OPS980011R',
    '70172304ZZ', '70172404ZZ', '70172604ZZ', '70174304ZZ', '70174804ZZ', '70174904ZZ', '70175004ZZ', '70175204ZZ', '70175504ZZ',
    'FO10006', 'FO10010', 'FO10020', 'FO10030', 'FO10040', 'FO10050'
  ];

  for (let i = 1; i <= 132; i++) {
    const taskId = 1000 + i;
    const code = sampleCodes[(i - 1) % sampleCodes.length] + (i > 19 ? `_${i}` : '');
    const wbsId = (i % 6) + 1;
    const isCritical = i <= 35;
    const totalFloat = isCritical ? 0.0 : 160.0;
    const duration = (i % 5 === 0) ? 0.0 : 16.0;

    taskRows += `%R\t${taskId}\t101\t${wbsId}\t${code}\tMaintenance Task Operation ${i}\tTK_NotStart\t${duration}\t${duration}\t${totalFloat}\t${totalFloat}\t2011-08-01 08:00\t2011-08-15 17:00\t\n`;
  }

  let predRows = '';
  for (let i = 1; i <= 139; i++) {
    const predId = 1000 + i;
    const succId = 1000 + i + 1;
    const lag = (i === 10 || i === 20) ? 16.0 : 0.0;
    predRows += `%R\t5000${i}\t${succId}\t${predId}\tPR_FS\t${lag}\n`;
  }

  return `EREXPORTHEADER\t19.12\t2026-07-24\t1\t1000\tP6\tPROJECT\tSYSTEM\t
%T\tPROJECT
%F\tproj_id\tproj_short_name\tcreate_date
%R\t101\tNRG00870 — Baytown, TX - Offline Maintenance Work\t2011-08-01 08:00
%T\tPROJWBS
%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id
${wbsRows.join('\n')}
%T\tTASK
%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tfree_float_hr_cnt\tearly_start_date\tearly_end_date\tcstr_type
${taskRows}%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt
${predRows}%E
`;
}

export function generateMetroRailXER(): string {
  return `EREXPORTHEADER\t19.12\t2026-07-24\t1\t1000\tP6\tPROJECT\tSYSTEM\t
%T\tPROJECT
%F\tproj_id\tproj_short_name\tcreate_date
%R\t102\tDEMO-RAIL-01 — Metro Rail Infrastructure Expansion\t2026-01-01 08:00
%T\tPROJWBS
%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id
%R\t1\t102\tRAIL.ENG\tEngineering & Civil Design\t
%R\t2\t102\tRAIL.PROC\tTrack & Signals Procurement\t
%R\t3\t102\tRAIL.CONST\tTrack Laying & Electrification\t
%T\tTASK
%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tfree_float_hr_cnt\tearly_start_date\tearly_end_date\tcstr_type
%R\t2001\t102\t1\tENG-101\tGeotechnical Survey & Alignment\tTK_Complete\t80.0\t0.0\t0.0\t0.0\t2026-01-05 08:00\t2026-01-16 17:00\t
%R\t2002\t102\t1\tENG-102\tTrack Detailed Civil Specifications\tTK_Active\t160.0\t80.0\t0.0\t0.0\t2026-01-19 08:00\t2026-02-13 17:00\t
%R\t2003\t102\t2\tPROC-201\tSteel Rail & Sleeper Delivery\tTK_NotStart\t240.0\t240.0\t0.0\t0.0\t2026-02-16 08:00\t2026-03-27 17:00\t
%R\t2004\t102\t3\tCONST-301\tSub-grade & Ballast Laying (km 0-10)\tTK_NotStart\t200.0\t200.0\t0.0\t0.0\t2026-03-30 08:00\t2026-05-01 17:00\t
%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt
%R\t6001\t2002\t2001\tPR_FS\t0.0
%R\t6002\t2003\t2002\tPR_FS\t0.0
%R\t6003\t2004\t2003\tPR_FS\t0.0
%E
`;
}

export function generateHighwayXER(): string {
  return `EREXPORTHEADER\t19.12\t2026-07-24\t1\t1000\tP6\tPROJECT\tSYSTEM\t
%T\tPROJECT
%F\tproj_id\tproj_short_name\tcreate_date
%R\t103\tHIGHWAY-UK-02 — Smart Motorway Resurfacing & Barrier Works\t2026-03-15 08:00
%T\tPROJWBS
%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id
%R\t1\t103\tHWY.TRAF\tTraffic Management & Closures\t
%R\t2\t103\tHWY.PAVE\tAsphalt Milling & Resurfacing\t
%T\tTASK
%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tfree_float_hr_cnt\tearly_start_date\tearly_end_date\tcstr_type
%R\t3001\t103\t1\tTRAF-01\tNighttime Lane 1-2 Closure Setup\tTK_NotStart\t12.0\t12.0\t0.0\t0.0\t2026-03-15 20:00\t2026-03-16 08:00\t
%R\t3002\t103\t2\tPAVE-01\tSurface Milling 50mm Depth (km 12-18)\tTK_NotStart\t40.0\t40.0\t0.0\t0.0\t2026-03-16 08:00\t2026-03-20 17:00\t
%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt
%R\t7001\t3002\t3001\tPR_FS\t0.0
%E
`;
}
