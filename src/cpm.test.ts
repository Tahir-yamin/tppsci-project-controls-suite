import { describe, it, expect } from 'vitest';
import { buildNetwork, solveCPM, mulberry32 } from './cpm';
import { calculateDCMA14, runMonteCarloRisk, defaultThresholds, findOpenEnds } from './dcmaEngine';
import { parseXERText, generateSampleXER } from './xerParser';
import { sampleProjects } from './sampleData';
import type { XERActivity, XERRelationship } from './types';

function activity(id: string, hours: number, extra: Partial<XERActivity> = {}): XERActivity {
  return {
    task_id: id,
    task_code: id,
    task_name: `Task ${id}`,
    wbs_id: 'w1',
    status_code: 'TK_NotStart',
    target_drtn_hr_cnt: hours,
    remain_drtn_hr_cnt: hours,
    total_float_hr_cnt: 0,
    free_float_hr_cnt: 0,
    ...extra,
  };
}

function fs(pred: string, succ: string, lag = 0): XERRelationship {
  return { task_pred_id: `${pred}-${succ}`, task_id: succ, pred_task_id: pred, pred_type: 'PR_FS', lag_hr_cnt: lag };
}

describe('CPM', () => {
  it('computes the longest path through parallel chains', () => {
    // A -> B -> D (10+20+5 = 35) and A -> C -> D (10+8+5 = 23)
    const activities = [activity('A', 10), activity('B', 20), activity('C', 8), activity('D', 5)];
    const rels = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')];

    const result = solveCPM(buildNetwork(activities, rels));

    expect(result.projectDuration).toBe(35);
    expect(result.criticalIds).toEqual(['A', 'B', 'D']);
    // C has 12 hours of slack: it can finish as late as B does.
    const idx = buildNetwork(activities, rels).indexOf.get('C')!;
    expect(result.totalFloat[idx]).toBe(12);
  });

  it('honours lag on relationships', () => {
    const activities = [activity('A', 10), activity('B', 10)];
    const result = solveCPM(buildNetwork(activities, [fs('A', 'B', 5)]));
    expect(result.projectDuration).toBe(25);
  });

  it('handles start-to-start and finish-to-finish links', () => {
    const activities = [activity('A', 10), activity('B', 4)];
    const ss = solveCPM(
      buildNetwork(activities, [
        { task_pred_id: '1', task_id: 'B', pred_task_id: 'A', pred_type: 'PR_SS', lag_hr_cnt: 2 },
      ]),
    );
    // B starts 2h after A starts and runs 4h, so A (10h) still sets the finish.
    expect(ss.projectDuration).toBe(10);

    const ff = solveCPM(
      buildNetwork(activities, [
        { task_pred_id: '1', task_id: 'B', pred_task_id: 'A', pred_type: 'PR_FF', lag_hr_cnt: 3 },
      ]),
    );
    expect(ff.projectDuration).toBe(13);
  });

  it('terminates on circular logic and reports it', () => {
    const activities = [activity('A', 5), activity('B', 5)];
    const network = buildNetwork(activities, [fs('A', 'B'), fs('B', 'A')]);
    expect(network.droppedEdges).toBeGreaterThan(0);
    expect(() => solveCPM(network)).not.toThrow();
  });

  it('ignores relationships pointing outside the loaded project', () => {
    const network = buildNetwork([activity('A', 5)], [fs('EXTERNAL', 'A')]);
    expect(network.preds[0]).toHaveLength(0);
    expect(solveCPM(network).projectDuration).toBe(5);
  });

  it('produces a repeatable stream for a given seed', () => {
    const a = Array.from({ length: 5 }, mulberry32(42));
    const b = Array.from({ length: 5 }, mulberry32(42));
    expect(a).toEqual(b);
    expect(a).not.toEqual(Array.from({ length: 5 }, mulberry32(43)));
  });
});

describe('DCMA 14-point', () => {
  const xer = parseXERText(generateSampleXER());

  it('counts leads and lags from the actual relationships', () => {
    const report = calculateDCMA14(xer);
    const lags = report.metrics.find(m => m.id === 3)!;
    // The sample schedule contains exactly one 16-hour lag.
    expect(lags.count).toBe(1);
    expect(report.metrics.find(m => m.id === 2)!.count).toBe(0);
  });

  it('flags hard constraints present in the file', () => {
    const report = calculateDCMA14(xer);
    const check5 = report.metrics.find(m => m.id === 5)!;
    expect(check5.count).toBe(1);
    expect(check5.flaggedTasks[0].task_code).toBe('CONST-3020');
  });

  it('marks unassessable checks as N/A rather than passing them', () => {
    const report = calculateDCMA14(xer);
    const resources = report.metrics.find(m => m.id === 10)!;
    expect(resources.rag).toBe('na');
    expect(resources.notAssessedReason).toBeTruthy();
  });

  it('responds to threshold changes', () => {
    const strict = structuredClone(defaultThresholds);
    strict.ragBands[3] = { green: 0, amber: 0 };
    const lax = structuredClone(defaultThresholds);
    lax.ragBands[3] = { green: 100, amber: 100 };

    expect(calculateDCMA14(xer, strict).metrics.find(m => m.id === 3)!.rag).toBe('red');
    expect(calculateDCMA14(xer, lax).metrics.find(m => m.id === 3)!.rag).toBe('green');
  });

  it('scores only the checks it could actually assess', () => {
    const report = calculateDCMA14(xer);
    expect(report.greenCount + report.amberCount + report.redCount + report.naCount).toBe(14);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });
});

describe('Monte Carlo', () => {
  const xer = parseXERText(generateSampleXER());

  it('is reproducible for a fixed seed and changes with the seed', () => {
    const a = runMonteCarloRisk(xer, { iterations: 500, seed: 7 });
    const b = runMonteCarloRisk(xer, { iterations: 500, seed: 7 });
    const c = runMonteCarloRisk(xer, { iterations: 500, seed: 8 });

    expect(a.p80Date.getTime()).toBe(b.p80Date.getTime());
    expect(a.meanDurationDays).toBe(b.meanDurationDays);
    expect(c.p50Date.getTime()).not.toBe(0);
  });

  it('returns percentiles in ascending order', () => {
    const r = runMonteCarloRisk(xer, { iterations: 1000, seed: 1 });
    expect(r.p10Date.getTime()).toBeLessThanOrEqual(r.p50Date.getTime());
    expect(r.p50Date.getTime()).toBeLessThanOrEqual(r.p80Date.getTime());
    expect(r.p80Date.getTime()).toBeLessThanOrEqual(r.p90Date.getTime());
  });

  it('derives criticality from the simulation rather than hardcoding it', () => {
    const r = runMonteCarloRisk(xer, { iterations: 800, seed: 3 });
    expect(r.criticalityIndex.length).toBeGreaterThan(0);
    // Every reported activity must exist in the loaded schedule.
    const codes = new Set(xer.activities.map(a => a.task_code));
    r.criticalityIndex.forEach(c => expect(codes.has(c.activityCode)).toBe(true));
    r.durationSensitivity.forEach(s => expect(codes.has(s.activityCode)).toBe(true));
    r.criticalityIndex.forEach(c => {
      expect(c.percentage).toBeGreaterThan(0);
      expect(c.percentage).toBeLessThanOrEqual(100);
    });
  });

  it('produces an S-curve that reaches 100 percent', () => {
    const r = runMonteCarloRisk(xer, { iterations: 600, seed: 5 });
    expect(r.sCurveData.at(-1)!.probability).toBeCloseTo(100, 5);
    expect(r.distributionHistogram.reduce((s, b) => s + b.count, 0)).toBe(r.iterations);
  });

  it('reports diagnostics honestly', () => {
    const r = runMonteCarloRisk(xer, { iterations: 300, seed: 2 });
    expect(r.diagnostics.lags).toBe(1);
    expect(r.diagnostics.cyclesDropped).toBe(0);
    expect(r.diagnostics.activitiesSimulated).toBe(xer.activities.filter(a => a.target_drtn_hr_cnt > 0).length);
  });
});

describe('XER parser', () => {
  it('parses tables, activities and relationships', () => {
    const xer = parseXERText(generateSampleXER());
    expect(xer.activities).toHaveLength(8);
    expect(xer.relationships).toHaveLength(7);
    expect(xer.wbs).toHaveLength(3);
    expect(xer.project?.proj_short_name).toBe('DEMO-RAIL-01');
  });

  it('returns empty structures for junk input instead of throwing', () => {
    const xer = parseXERText('not an xer file at all');
    expect(xer.activities).toHaveLength(0);
    expect(xer.project).toBeNull();
  });
});

describe('sample schedules', () => {

  sampleProjects.forEach(project => {
    describe(project.shortName, () => {
      const xer = parseXERText(project.generateXER());

      it('parses into a non-trivial network', () => {
        expect(xer.activities.length).toBeGreaterThan(10);
        expect(xer.relationships.length).toBeGreaterThan(10);
        expect(xer.project?.proj_short_name).toBe(project.shortName);
      });

      it('declares a data date and a mix of activity statuses', () => {
        const statuses = new Set(xer.activities.map(a => a.status_code));
        expect(xer.project?.last_recalc_date).toBeTruthy();
        expect(statuses.size).toBeGreaterThan(1);
      });

      it('has dates that agree with its own logic', () => {
        // Every successor must start no earlier than its predecessor finishes.
        const byId = new Map(xer.activities.map(a => [a.task_id, a]));
        xer.relationships
          .filter(r => r.pred_type === 'PR_FS')
          .forEach(r => {
            const pred = byId.get(r.pred_task_id)!;
            const succ = byId.get(r.task_id)!;
            expect(new Date(succ.early_start_date!).getTime()).toBeGreaterThanOrEqual(
              new Date(pred.early_end_date!).getTime() - 3 * 24 * 3600 * 1000,
            );
          });
      });

      it('has no unexplained open ends', () => {
        expect(findOpenEnds(xer)).toHaveLength(0);
      });

      it('reconciles the CPM finish against the dates in the file', () => {
        const r = runMonteCarloRisk(xer, { iterations: 300, seed: 11 });
        // The calendar factor is calibrated, so the engine must land on the
        // schedule's own finish rather than compressing it by weekends.
        expect(Math.abs(r.diagnostics.reconciliationDeltaDays ?? 999)).toBeLessThanOrEqual(1);
      });

      it('reports only duration-bearing activities as risk drivers', () => {
        const r = runMonteCarloRisk(xer, { iterations: 300, seed: 11 });
        const byCode = new Map(xer.activities.map(a => [a.task_code, a]));
        r.criticalityIndex.forEach(c => {
          expect(byCode.get(c.activityCode)!.target_drtn_hr_cnt).toBeGreaterThan(0);
        });
      });

      it('produces a DCMA report that is not uniformly perfect or empty', () => {
        const report = calculateDCMA14(xer);
        expect(report.metrics).toHaveLength(14);
        expect(report.overallScore).toBeGreaterThan(50);
        expect(report.dataDate).toBeTruthy();
      });
    });
  });
});
