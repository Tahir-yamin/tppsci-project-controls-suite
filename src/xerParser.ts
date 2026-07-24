import type { ParsedXER, XERActivity, XERRelationship, XERWBS, XERProject } from './types';

export function parseXERText(text: string): ParsedXER {
  const lines = text.split(/\r?\n/);
  const rawTables: Record<string, { fields: string[]; rows: Record<string, string>[] }> = {};
  const tables: Record<string, string[][]> = {};

  let currentTableName = '';
  let currentFields: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split('\t');
    const recordType = parts[0];

    if (recordType === '%T') {
      currentTableName = parts[1];
      rawTables[currentTableName] = { fields: [], rows: [] };
      tables[currentTableName] = [];
    } else if (recordType === '%F') {
      currentFields = parts.slice(1);
      if (currentTableName && rawTables[currentTableName]) {
        rawTables[currentTableName].fields = currentFields;
      }
    } else if (recordType === '%R') {
      const rowValues = parts.slice(1);
      if (currentTableName && rawTables[currentTableName]) {
        tables[currentTableName].push(rowValues);
        const rowObj: Record<string, string> = {};
        for (let f = 0; f < currentFields.length; f++) {
          rowObj[currentFields[f]] = rowValues[f] || '';
        }
        rawTables[currentTableName].rows.push(rowObj);
      }
    }
  }

  // Parse Project
  let project: XERProject | null = null;
  if (rawTables['PROJECT'] && rawTables['PROJECT'].rows.length > 0) {
    const p = rawTables['PROJECT'].rows[0];
    project = {
      proj_id: p.proj_id || '1',
      proj_short_name: p.proj_short_name || 'PROJECT',
      proj_name: p.proj_short_name || 'P6 Schedule Project',
      create_date: p.create_date,
      last_recalc_date: p.last_recalc_date,
    };
  }

  // Parse WBS
  const wbs: XERWBS[] = (rawTables['PROJWBS']?.rows || []).map(r => ({
    wbs_id: r.wbs_id,
    wbs_short_name: r.wbs_short_name || r.wbs_name || '',
    wbs_name: r.wbs_name || r.wbs_short_name || '',
    parent_wbs_id: r.parent_wbs_id,
    seq_num: parseInt(r.seq_num || '0', 10),
  }));

  // Parse Activities
  const activities: XERActivity[] = (rawTables['TASK']?.rows || []).map(r => {
    const targetDrtn = parseFloat(r.target_drtn_hr_cnt || '0');
    const remainDrtn = parseFloat(r.remain_drtn_hr_cnt || '0');
    const totalFloat = parseFloat(r.total_float_hr_cnt || '0');
    const freeFloat = parseFloat(r.free_float_hr_cnt || '0');

    return {
      task_id: r.task_id,
      task_code: r.task_code || r.task_id,
      task_name: r.task_name || 'Unnamed Activity',
      wbs_id: r.wbs_id,
      status_code: r.status_code || 'TK_NotStart',
      target_start_date: r.target_start_date || r.early_start_date,
      target_end_date: r.target_end_date || r.early_end_date,
      act_start_date: r.act_start_date,
      act_end_date: r.act_end_date,
      early_start_date: r.early_start_date || r.target_start_date,
      early_end_date: r.early_end_date || r.target_end_date,
      late_start_date: r.late_start_date,
      late_end_date: r.late_end_date,
      target_drtn_hr_cnt: targetDrtn,
      remain_drtn_hr_cnt: remainDrtn,
      total_float_hr_cnt: totalFloat,
      free_float_hr_cnt: freeFloat,
      constraint_type: r.cstr_type,
      constraint_date: r.cstr_date,
      is_critical: totalFloat <= 0 && r.status_code !== 'TK_Complete',
    };
  });

  // Parse Relationships
  const relationships: XERRelationship[] = (rawTables['TASKPRED']?.rows || []).map(r => ({
    task_pred_id: r.task_pred_id,
    task_id: r.task_id, // successor
    pred_task_id: r.pred_task_id, // predecessor
    pred_type: r.pred_type || 'PR_FS',
    lag_hr_cnt: parseFloat(r.lag_hr_cnt || '0'),
  }));

  return {
    project,
    wbs,
    activities,
    relationships,
    tables,
    rawTables,
  };
}

export function generateSampleXER(): string {
  return `EREXPORTHEADER\t19.12\t2026-07-24\t1\t1000\tP6\tPROJECT\tSYSTEM\t
%T\tPROJECT
%F\tproj_id\tproj_short_name\tcreate_date
%R\t101\tDEMO-RAIL-01\t2026-01-01 08:00
%T\tPROJWBS
%F\twbs_id\tproj_id\twbs_short_name\twbs_name\tparent_wbs_id
%R\t1\t101\tWBS-1\tEngineering & Design\t
%R\t2\t101\tWBS-2\tProcurement & Fabrication\t
%R\t3\t101\tWBS-3\tConstruction & Installation\t
%T\tTASK
%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tfree_float_hr_cnt\tearly_start_date\tearly_end_date\tcstr_type
%R\t1001\t101\t1\tENG-1010\tDetailed Alignment & Civil Specs\tTK_Complete\t80.0\t0.0\t0.0\t0.0\t2026-02-01 08:00\t2026-02-12 17:00\t
%R\t1002\t101\t1\tENG-1020\tTrack & Structure Detailed Design\tTK_Active\t160.0\t80.0\t0.0\t0.0\t2026-02-13 08:00\t2026-03-08 17:00\t
%R\t1003\t101\t2\tPROC-2010\tRail Track & Sleeper Procurement\tTK_NotStart\t240.0\t240.0\t0.0\t0.0\t2026-03-09 08:00\t2026-04-16 17:00\t
%R\t1004\t101\t2\tPROC-2020\tSignalling & Substation Cables\tTK_NotStart\t160.0\t160.0\t160.0\t160.0\t2026-03-09 08:00\t2026-03-31 17:00\t
%R\t1005\t101\t3\tCONST-3010\tEarthworks & Sub-grade Prep (km 0-5)\tTK_NotStart\t200.0\t200.0\t0.0\t0.0\t2026-04-17 08:00\t2026-05-18 17:00\t
%R\t1006\t101\t3\tCONST-3020\tBallast & Track Laying (km 0-5)\tTK_NotStart\t160.0\t160.0\t0.0\t0.0\t2026-05-19 08:00\t2026-06-12 17:00\tCS_MAND
%R\t1007\t101\t3\tCONST-3030\tSubstation & Overhead Catenary (km 0-5)\tTK_NotStart\t120.0\t120.0\t160.0\t160.0\t2026-04-01 08:00\t2026-04-21 17:00\t
%R\t1008\t101\t3\tTEST-4010\tSystem Integration & Dynamic Test\tTK_NotStart\t80.0\t80.0\t0.0\t0.0\t2026-06-13 08:00\t2026-06-25 17:00\t
%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt
%R\t5001\t1002\t1001\tPR_FS\t0.0
%R\t5002\t1003\t1002\tPR_FS\t0.0
%R\t5003\t1004\t1002\tPR_FS\t16.0
%R\t5004\t1005\t1003\tPR_FS\t0.0
%R\t5005\t1006\t1005\tPR_FS\t0.0
%R\t5006\t1007\t1004\tPR_FS\t0.0
%R\t5007\t1008\t1006\tPR_FS\t0.0
%E
`;
}
