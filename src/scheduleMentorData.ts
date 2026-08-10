import type { MentorTopic } from './types';

export const mentorTopics: MentorTopic[] = [
  // LOGIC CATEGORY
  {
    id: 'L1',
    category: 'Logic',
    code: 'L1',
    title: 'Missing logic (open ends)',
    whyItMatters: `A schedule is a network, not a bar chart. An activity with no predecessor floats to the start; one with no successor never passes delay on. When change happens, P6 can’t calculate the knock-on through an open end — so your forecast is quietly wrong exactly where it matters.`,
    howToFixInP6: `In P6, run Tools → Schedule (F9) and open the Schedule Log — it lists activities without predecessors and without successors. Work through them and add the real driving relationship. The Trace Logic view helps you see what should connect.`,
    whenItsFine: `Exactly one activity should legitimately have no predecessor (your true start milestone) and one no successor (your true finish milestone). Everything else earns its place in the network.`,
    getAffectedTasks: (activities, relationships) => {
      const preds = new Set(relationships.map(r => r.task_id));
      const succs = new Set(relationships.map(r => r.pred_task_id));
      return activities.filter(a => !preds.has(a.task_id) || !succs.has(a.task_id));
    }
  },
  {
    id: 'L2',
    category: 'Logic',
    code: 'L2',
    title: 'Danglers',
    whyItMatters: `A dangler happens when an activity is linked by a Start-to-Start link but has no successor from its Finish, or vice versa. The activity start is driven, but its finish can drift infinitely without delaying anything.`,
    howToFixInP6: `Ensure every activity has logic driving BOTH its Start (e.g. FS or SS) AND its Finish (e.g. FS or FF). Check the Activity Details → Relationships tab in P6.`,
    whenItsFine: `Milestone activities (Start Milestone / Finish Milestone) only have a single logic point by definition.`,
    getAffectedTasks: (activities, relationships) => {
      const ssPreds = new Set(relationships.filter(r => r.pred_type === 'PR_SS').map(r => r.task_id));
      const fsPreds = new Set(relationships.filter(r => r.pred_type === 'PR_FS' || r.pred_type === 'PR_FF').map(r => r.task_id));
      return activities.filter(a => ssPreds.has(a.task_id) && !fsPreds.has(a.task_id));
    }
  },
  {
    id: 'L3',
    category: 'Logic',
    code: 'L3',
    title: 'Duplicate / redundant relationship pairs',
    whyItMatters: `Having multiple relationship types between the exact same pair of activities (e.g. both FS and SS) creates redundant constraints that clutter the network and confuse CPM calculations.`,
    howToFixInP6: `Open Activity Details → Relationships. Look for duplicate predecessor rows pointing to the same Activity ID and delete the weaker or redundant relationship.`,
    whenItsFine: `Rarely necessary. Use a single relationship type that represents the actual physical constraint.`,
    getAffectedTasks: (activities, relationships) => {
      const pairCounts = new Map<string, number>();
      relationships.forEach(r => {
        const key = `${r.pred_task_id}->${r.task_id}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      });
      const dupTaskIds = new Set<string>();
      relationships.forEach(r => {
        const key = `${r.pred_task_id}->${r.task_id}`;
        if ((pairCounts.get(key) || 0) > 1) {
          dupTaskIds.add(r.task_id);
          dupTaskIds.add(r.pred_task_id);
        }
      });
      return activities.filter(a => dupTaskIds.has(a.task_id));
    }
  },
  {
    id: 'L4',
    category: 'Logic',
    code: 'L4',
    title: 'Redundant transitive links',
    whyItMatters: `If Task A drives Task B, and Task B drives Task C, adding a direct link from Task A to Task C is redundant. It bloats the database and makes logic reviews harder.`,
    howToFixInP6: `Use P6 Schedule Log or automated logic cleanup to identify transitive relationships and remove direct links between non-adjacent sequence tasks.`,
    whenItsFine: `When A to C represents an independent physical safety or access constraint beyond the B sequence.`,
    getAffectedTasks: (activities) => activities.slice(0, 0)
  },
  {
    id: 'L5',
    category: 'Logic',
    code: 'L5',
    title: 'Start-to-Finish relationships',
    whyItMatters: `Start-to-Finish (SF) links mean Task B cannot finish until Task A starts. This is counter-intuitive, hard to explain to site teams, and often hides modeling errors.`,
    howToFixInP6: `Replace SF relationships with standard Finish-to-Start (FS) or Start-to-Start (SS) logic by reformulating the task sequence.`,
    whenItsFine: `Extremely rare shift-handover scenarios. Virtually never recommended in construction or engineering.`,
    getAffectedTasks: (activities, relationships) => {
      const sfTaskIds = new Set(relationships.filter(r => r.pred_type === 'PR_SF').map(r => r.task_id));
      return activities.filter(a => sfTaskIds.has(a.task_id));
    }
  },
  {
    id: 'L6',
    category: 'Logic',
    code: 'L6',
    title: 'Negative lag (leads)',
    whyItMatters: `Negative lag lets a successor start before its predecessor finishes. It implies working backwards in time or predicting future completion, masking true logic flow.`,
    howToFixInP6: `Break the predecessor into smaller sub-activities (e.g. "Draft Specs Phase 1") and use standard FS links with 0 lag.`,
    whenItsFine: `Never recommended by DCMA or UK Association for Project Management (APM) guidelines.`,
    getAffectedTasks: (activities, relationships) => {
      const leadTaskIds = new Set(relationships.filter(r => r.lag_hr_cnt < 0).map(r => r.task_id));
      return activities.filter(a => leadTaskIds.has(a.task_id));
    }
  },
  {
    id: 'L7',
    category: 'Logic',
    code: 'L7',
    title: 'Lag hygiene',
    whyItMatters: `Excessive positive lag (e.g. 30 days lag) acts like a hidden activity with no name, owner, or resource. It makes float calculations fragile.`,
    howToFixInP6: `Convert long lags into explicit milestone or buffer activities (e.g. "Concrete Curing Period") with defined calendars.`,
    whenItsFine: `Short operational lags (1–2 days) for minor handovers.`,
    getAffectedTasks: (activities, relationships) => {
      const longLagTaskIds = new Set(relationships.filter(r => r.lag_hr_cnt > 80).map(r => r.task_id));
      return activities.filter(a => longLagTaskIds.has(a.task_id));
    }
  },
  {
    id: 'L8',
    category: 'Logic',
    code: 'L8',
    title: 'Relationship-type mix',
    whyItMatters: `A healthy schedule is built primarily on Finish-to-Start (FS) logic. Overusing SS or FF links makes critical paths volatile and hard to trace.`,
    howToFixInP6: `Aim for at least 90% FS relationships across your schedule. Convert complex SS/FF overlapping logic into sequential discrete tasks.`,
    whenItsFine: `Parallel trade work (e.g. cabling following duct installation).`,
    getAffectedTasks: (activities, relationships) => {
      const nonFsTaskIds = new Set(relationships.filter(r => r.pred_type !== 'PR_FS').map(r => r.task_id));
      return activities.filter(a => nonFsTaskIds.has(a.task_id));
    }
  },

  // CONSTRAINTS CATEGORY
  {
    id: 'C1',
    category: 'Constraints',
    code: 'C1',
    title: 'Hard constraints',
    whyItMatters: `Hard constraints (Mandatory Start/Finish, Must Finish By) override network logic. They force P6 to show artificial float or hide delays, rendering critical path analysis useless.`,
    howToFixInP6: `In Activity Details → Primary Constraints, change Hard Constraints to "As Late As Possible" or remove them entirely, letting logic dictate dates.`,
    whenItsFine: `Contractual completion milestones where negative float MUST be highlighted for legal claims.`,
    getAffectedTasks: (activities) => {
      const hardTypes = ['CS_MAND', 'CS_MSO', 'CS_MEO', 'CS_FOB', 'CS_FOA'];
      return activities.filter(a => a.constraint_type && hardTypes.includes(a.constraint_type));
    }
  },
  {
    id: 'C2',
    category: 'Constraints',
    code: 'C2',
    title: 'Constraint instead of logic',
    whyItMatters: `Using Start On or Finish On constraints to anchor activities instead of linking them to predecessors creates an artificial bar chart that won't update dynamically when predecessor work slips.`,
    howToFixInP6: `Remove soft/hard constraints and link the activity to its true site predecessor.`,
    whenItsFine: `External site access dates or client supply handover dates.`,
    getAffectedTasks: (activities) => activities.filter(a => !!a.constraint_type)
  },
  {
    id: 'C3',
    category: 'Constraints',
    code: 'C3',
    title: 'Constraint census',
    whyItMatters: `More than 5% constrained tasks indicates a schedule that is manually held together rather than logically driven.`,
    howToFixInP6: `Filter by Constraints in P6, review each task, and replace date constraints with logic ties.`,
    whenItsFine: `Key client milestone delivery obligations.`,
    getAffectedTasks: (activities) => activities.filter(a => !!a.constraint_type)
  },

  // CALENDARS & DURATIONS
  {
    id: 'K1',
    category: 'Calendars & durations',
    code: 'K1',
    title: 'Calendar mix on a driving chain',
    whyItMatters: `Mixing 5-day, 7-day, and shift calendars along the same critical path creates sudden float jumps and false critical path shifts over weekends.`,
    howToFixInP6: `Standardize project calendars across sequential trade handovers where possible.`,
    whenItsFine: `Continuous curing / offshore works interlinked with office design teams.`,
    getAffectedTasks: () => []
  },
  {
    id: 'K2',
    category: 'Calendars & durations',
    code: 'K2',
    title: 'Odd calendars',
    whyItMatters: `Unused or customized calendars with non-standard working hours lead to unexpected 1-hour activity splits.`,
    howToFixInP6: `Assign standard global or project calendars in P6 Activity Details → General.`,
    whenItsFine: `Specific tidal or weather-window operations.`,
    getAffectedTasks: () => []
  },
  {
    id: 'K3',
    category: 'Calendars & durations',
    code: 'K3',
    title: 'Long durations',
    whyItMatters: `Activities longer than 44 working days (2 reporting cycles) are impossible to status accurately and obscure progress transparency.`,
    howToFixInP6: `Decompose long activities into smaller discrete work packages in the WBS.`,
    whenItsFine: `Level of Effort (LOE) management activities or long-lead procurement monitoring.`,
    getAffectedTasks: (activities) => activities.filter(a => a.target_drtn_hr_cnt > 352)
  },
  {
    id: 'K4',
    category: 'Calendars & durations',
    code: 'K4',
    title: 'Suspicious durations',
    whyItMatters: `Tasks with fractional or 0.1-hour durations often indicate copy-paste mistakes or calendar unit conversion errors.`,
    howToFixInP6: `Round durations to standard shifts or days in P6.`,
    whenItsFine: `Sub-hour high-voltage switching windows.`,
    getAffectedTasks: (activities) => activities.filter(a => a.target_drtn_hr_cnt > 0 && a.target_drtn_hr_cnt < 4)
  },

  // PROGRESS
  {
    id: 'P1',
    category: 'Progress',
    code: 'P1',
    title: 'Broken statusing',
    whyItMatters: `Incomplete tasks with actual finish dates or finished tasks with remaining duration confuse status reporting and S-curves.`,
    howToFixInP6: `Use P6 Progress Spotlight and update remaining duration or status correctly.`,
    whenItsFine: `Never.`,
    getAffectedTasks: (activities) => activities.filter(a => a.status_code === 'TK_Complete' && a.remain_drtn_hr_cnt > 0)
  },
  {
    id: 'P2',
    category: 'Progress',
    code: 'P2',
    title: 'Progress smell checks',
    whyItMatters: `Out-of-sequence progress occurs when a successor starts before its predecessor finishes, creating negative float logic loops.`,
    howToFixInP6: `In P6 Schedule (F9) Options, select "Retained Logic" instead of "Progress Override" to ensure realistic forecast calculations.`,
    whenItsFine: `When work actually bypassed site dependencies due to re-sequencing.`,
    getAffectedTasks: (activities) => activities.filter(a => a.status_code === 'TK_Active')
  },

  // STRUCTURE
  {
    id: 'S1',
    category: 'Structure',
    code: 'S1',
    title: 'WBS shape',
    whyItMatters: `Deep, overly nested WBS trees (more than 6 levels) make navigation frustrating and clutter executive dashboards.`,
    howToFixInP6: `Re-organize WBS hierarchy in P6 Project → WBS into clean 3 to 4 tier levels.`,
    whenItsFine: `Massive megaprojects with multi-disciplinary sub-contracts.`,
    getAffectedTasks: () => []
  },
  {
    id: 'S2',
    category: 'Structure',
    code: 'S2',
    title: 'Activity ID discipline',
    whyItMatters: `Inconsistent Activity IDs (e.g. mixing A1000 with random numbers) make cross-project filtering and coding difficult.`,
    howToFixInP6: `Use P6 Tools → Renumber Activity IDs to establish a clean prefix & increment scheme.`,
    whenItsFine: `Legacy imported sub-contractor programs.`,
    getAffectedTasks: () => []
  },
  {
    id: 'S3',
    category: 'Structure',
    code: 'S3',
    title: 'Activity naming',
    whyItMatters: `Vague task names like "Engineering" or "Construction" don't specify action, location, or trade, causing miscommunication.`,
    howToFixInP6: `Name tasks using [Verb] + [Noun] + [Location/Specs] format (e.g. "Install Track Ballast km 0-5").`,
    whenItsFine: `High-level summary milestones.`,
    getAffectedTasks: (activities) => activities.filter(a => a.task_name.length < 8)
  },
  {
    id: 'S4',
    category: 'Structure',
    code: 'S4',
    title: 'Float sanity',
    whyItMatters: `Activities with total float > 200 days are disconnected from the true project finish and hide missing logic ties.`,
    howToFixInP6: `Review high float tasks and connect them to downstream commissioning or handovers.`,
    whenItsFine: `Optional aesthetic site works.`,
    getAffectedTasks: (activities) => activities.filter(a => a.total_float_hr_cnt > 1600)
  }
];
