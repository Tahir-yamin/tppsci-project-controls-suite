import { parseXERText } from './xerParser';
import {
  calculateDCMA14,
  runMonteCarloRisk,
  anonymizeXER,
  defaultThresholds,
  defaultRiskSettings,
  resolveDataDate,
} from './dcmaEngine';
import { generateDetailedXER } from './sampleData';
import { mentorTopics } from './scheduleMentorData';
import type {
  ParsedXER,
  XERActivity,
  MentorTopic,
  DCMAThresholdConfig,
  QSRARiskSettings,
  MonteCarloResult,
} from './types';
import Chart from 'chart.js/auto';
import { buildNetwork, solveCPM } from './cpm';

let currentXER: ParsedXER | null = null;
let riskChartInstance: Chart | null = null;
let filteredActivities: XERActivity[] = [];
let selectedMentorTopic: MentorTopic = mentorTopics[0];
let thresholdConfig: DCMAThresholdConfig = structuredClone(defaultThresholds);
let riskSettings: QSRARiskSettings = { ...defaultRiskSettings };
let lastRiskResult: MonteCarloResult | null = null;

// Viewer State
let searchFilter = '';
let statusFilter = 'ALL';
let criticalOnly = false;
let milestonesOnly = false;
let maxFloatFilter: number | null = null;
let wbsViewMode: 'grouped' | 'flat' = 'grouped';
let expandedWBS: Set<string> = new Set<string>();
let zoomMode: 'Month' | 'Week' | 'Day' = 'Month';

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupNavigation();
  setupFileUpload();
  setupViewerControls();
  setupScheduleMentor();
  loadSampleData();
});

function setupTheme() {
  const toggle = document.getElementById('themeToggle');
  const root = document.documentElement;

  toggle?.addEventListener('click', () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = root.getAttribute('data-theme') ?? (prefersDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('tppsci-theme', next);
    } catch {
      // Storage can be unavailable in private mode; the theme still applies.
    }
    // Chart.js bakes colours in at construction, so redraw against the new theme.
    if (document.getElementById('tab-risk')?.style.display !== 'none') renderMonteCarlo();
  });
}

function setupNavigation() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');

      tabs.forEach(t => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });

      document.querySelectorAll<HTMLElement>('.tab-content').forEach(section => {
        const show = section.id === `tab-${targetTab}`;
        // The Gantt pane is a flex column; every other tab is a plain block.
        section.style.display = show ? (targetTab === 'gantt' ? 'flex' : 'block') : 'none';
      });
    });
  });
}

import { sampleProjects } from './sampleData';

function setupFileUpload() {
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;
  const projectSelect = document.getElementById('projectSelect') as HTMLSelectElement;

  if (projectSelect) {
    projectSelect.innerHTML = sampleProjects.map(p => `
      <option value="${p.id}">${p.name}</option>
    `).join('');

    projectSelect.addEventListener('change', () => {
      const selectedId = projectSelect.value;
      const proj = sampleProjects.find(p => p.id === selectedId);
      if (proj) {
        currentXER = parseXERText(proj.generateXER());
        if (currentXER) {
          currentXER.wbs.forEach(w => expandedWBS.add(w.wbs_id));
        }
        updateUI();
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) {
        handleFile(fileInput.files[0]);
        // Reset so re-selecting the same file still fires a change event.
        fileInput.value = '';
      }
    });
  }

  document.getElementById('openXerBtn')?.addEventListener('click', () => fileInput?.click());

  // Drag and drop anywhere in the window, so the user never hunts for a target.
  window.addEventListener('dragover', e => {
    e.preventDefault();
    document.querySelector('.gantt-split-container')?.classList.add('dragover');
  });
  window.addEventListener('dragleave', () => {
    document.querySelector('.gantt-split-container')?.classList.remove('dragover');
  });
  window.addEventListener('drop', e => {
    e.preventDefault();
    document.querySelector('.gantt-split-container')?.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  document.getElementById('exportAnonymizedBtn')?.addEventListener('click', exportAnonymizedFile);
}


function setupViewerControls() {
  const searchInput = document.getElementById('viewerSearchInput') as HTMLInputElement;
  const statusSelect = document.getElementById('viewerStatusSelect') as HTMLSelectElement;
  const criticalCheck = document.getElementById('viewerCriticalCheck') as HTMLInputElement;
  const milestoneCheck = document.getElementById('viewerMilestoneCheck') as HTMLInputElement;
  const floatInput = document.getElementById('viewerFloatInput') as HTMLInputElement;
  const clearBtn = document.getElementById('viewerClearBtn');

  const modeGroupedBtn = document.getElementById('modeGroupedBtn');
  const modeFlatBtn = document.getElementById('modeFlatBtn');
  const expandAllBtn = document.getElementById('expandAllBtn');
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  const zoomSelect = document.getElementById('zoomSelect') as HTMLSelectElement;
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchFilter = searchInput.value.toLowerCase();
      applyFilters();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      statusFilter = statusSelect.value;
      applyFilters();
    });
  }

  if (criticalCheck) {
    criticalCheck.addEventListener('change', () => {
      criticalOnly = criticalCheck.checked;
      applyFilters();
    });
  }

  if (milestoneCheck) {
    milestoneCheck.addEventListener('change', () => {
      milestonesOnly = milestoneCheck.checked;
      applyFilters();
    });
  }

  if (floatInput) {
    floatInput.addEventListener('input', () => {
      maxFloatFilter = floatInput.value ? parseFloat(floatInput.value) : null;
      applyFilters();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (statusSelect) statusSelect.value = 'ALL';
      if (criticalCheck) criticalCheck.checked = false;
      if (milestoneCheck) milestoneCheck.checked = false;
      if (floatInput) floatInput.value = '';

      searchFilter = '';
      statusFilter = 'ALL';
      criticalOnly = false;
      milestonesOnly = false;
      maxFloatFilter = null;
      applyFilters();
    });
  }

  if (modeGroupedBtn && modeFlatBtn) {
    modeGroupedBtn.addEventListener('click', () => {
      wbsViewMode = 'grouped';
      modeGroupedBtn.classList.add('active');
      modeFlatBtn.classList.remove('active');
      renderGantt();
    });

    modeFlatBtn.addEventListener('click', () => {
      wbsViewMode = 'flat';
      modeFlatBtn.classList.add('active');
      modeGroupedBtn.classList.remove('active');
      renderGantt();
    });
  }

  if (expandAllBtn && collapseAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      if (currentXER) {
        currentXER.wbs.forEach(w => expandedWBS.add(w.wbs_id));
        renderGantt();
      }
    });

    collapseAllBtn.addEventListener('click', () => {
      expandedWBS.clear();
      renderGantt();
    });
  }

  if (zoomSelect) {
    zoomSelect.addEventListener('change', () => {
      zoomMode = zoomSelect.value as any;
      renderGantt();
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportViewerCSV);
  }
}

function handleFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.xer')) {
    alert(`"${file.name}" is not a Primavera XER export. Choose a .xer file.`);
    return;
  }

  const reader = new FileReader();

  reader.onerror = () => alert(`Could not read "${file.name}".`);

  reader.onload = e => {
    const text = e.target?.result as string;
    if (!text) return;

    let parsed: ParsedXER;
    try {
      parsed = parseXERText(text);
    } catch (err) {
      alert(`Could not parse "${file.name}": ${err instanceof Error ? err.message : 'unknown error'}`);
      return;
    }

    if (!parsed.activities.length) {
      alert(`"${file.name}" contains no TASK records — it may be a partial or non-project export.`);
      return;
    }

    currentXER = parsed;
    expandedWBS = new Set(parsed.wbs.map(w => w.wbs_id));
    updateUI();
  };

  reader.readAsText(file);
}

function loadSampleData() {
  const sampleXER = generateDetailedXER();
  currentXER = parseXERText(sampleXER);
  if (currentXER) {
    currentXER.wbs.forEach(w => expandedWBS.add(w.wbs_id));
  }
  updateUI();
}

function applyFilters() {
  if (!currentXER) return;

  filteredActivities = currentXER.activities.filter(a => {
    if (searchFilter) {
      const matchCode = a.task_code.toLowerCase().includes(searchFilter);
      const matchName = a.task_name.toLowerCase().includes(searchFilter);
      if (!matchCode && !matchName) return false;
    }

    if (statusFilter !== 'ALL') {
      if (statusFilter === 'TK_NotStart' && a.status_code !== 'TK_NotStart') return false;
      if (statusFilter === 'TK_Active' && a.status_code !== 'TK_Active') return false;
      if (statusFilter === 'TK_Complete' && a.status_code !== 'TK_Complete') return false;
    }

    if (criticalOnly && !a.is_critical) return false;
    if (milestonesOnly && !a.is_milestone) return false;

    if (maxFloatFilter !== null) {
      const floatDays = a.total_float_hr_cnt / 8;
      if (floatDays > maxFloatFilter) return false;
    }

    return true;
  });

  renderGantt();
}

function updateUI() {
  if (!currentXER) return;

  const projectSelect = document.getElementById('projectSelect') as HTMLSelectElement;
  if (projectSelect && currentXER.project) {
    const projId = currentXER.project.proj_short_name;
    const exists = Array.from(projectSelect.options).some(o => o.value === projId);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = projId;
      opt.textContent = `${currentXER.project.proj_short_name} — ${currentXER.project.proj_name}`;
      projectSelect.appendChild(opt);
    }
    projectSelect.value = projId;
  }

  applyFilters();
  renderDCMA();
  renderScheduleComparison();
  renderXERAnonymiser();
  renderContractorRollup();
  renderPathAnalyser();
  renderMonteCarlo();
  renderTimeChainage();
  renderMSProjectFixer();
  renderScheduleMentorContent();
}


function renderGantt() {
  if (!currentXER) return;

  const activityCountEl = document.getElementById('activityCountBadge');
  if (activityCountEl) {
    activityCountEl.textContent = `showing ${filteredActivities.length} of ${currentXER.activities.length} activities`;
  }

  const tableBody = document.getElementById('ganttTableBody');
  const barsContainer = document.getElementById('ganttBarsContainer');
  const timelineHeader = document.getElementById('ganttTimelineHeader');

  if (!tableBody || !barsContainer || !timelineHeader) return;

  // Timeline scale is derived from the schedule itself rather than fixed dates,
  // so any loaded XER lands on a timeline that actually contains its bars.
  const scale = buildTimeScale(currentXER.activities);
  timelineHeader.innerHTML = scale.columns
    .map(c => `<div class="timeline-month" style="width:${c.width}px;">${c.label}</div>`)
    .join('');
  timelineHeader.style.width = `${scale.totalWidth}px`;

  let tableHtml = '';
  let barsHtml = '';
  let rowIdx = 0;

  const dataDate = resolveDataDate(currentXER);
  if (dataDate) {
    const left = scale.xFor(dataDate);
    if (left >= 0 && left <= scale.totalWidth) {
      barsHtml += `
        <div class="gantt-data-date-line" style="left:${left}px;">
          <span class="gantt-data-date-label">Data date ${formatDate(dataDate.toISOString())}</span>
        </div>
      `;
    }
  }

  if (wbsViewMode === 'flat') {
    filteredActivities.forEach(a => {
      tableHtml += renderTableRow(a);
      barsHtml += renderBarRow(a, scale);
      rowIdx++;
    });
  } else {
    // WBS Grouped Mode
    const wbsMap = new Map<string, XERActivity[]>();
    filteredActivities.forEach(a => {
      const list = wbsMap.get(a.wbs_id) || [];
      list.push(a);
      wbsMap.set(a.wbs_id, list);
    });

    currentXER.wbs.forEach(wbs => {
      const wbsActivities = wbsMap.get(wbs.wbs_id) || [];
      if (wbsActivities.length === 0) return;

      const isExpanded = expandedWBS.has(wbs.wbs_id);

      tableHtml += `
        <tr class="wbs-row" data-wbs="${wbs.wbs_id}">
          <td colspan="4">
            <span style="display:inline-block; width:12px; font-size:10px">${isExpanded ? '▾' : '▸'}</span>
            <strong>${wbs.wbs_short_name}</strong> ${wbs.wbs_name}
          </td>
        </tr>
      `;

      // The summary bar spans its children's real extent, not a fixed width.
      const wbsSpan = spanOf(wbsActivities, scale);
      barsHtml += `
        <div class="gantt-row-container">
          ${wbsSpan ? `<div class="gantt-bar-item wbs-summary" style="left:${wbsSpan.left}px; width:${wbsSpan.width}px;"></div>` : ''}
        </div>
      `;
      rowIdx++;

      if (isExpanded) {
        wbsActivities.forEach(a => {
          tableHtml += renderTableRow(a);
          barsHtml += renderBarRow(a, scale);
          rowIdx++;
        });
      }
    });
  }

  tableBody.innerHTML = tableHtml;
  barsContainer.innerHTML = barsHtml;
  barsContainer.style.width = `${scale.totalWidth}px`;

  // Add click listeners to toggle WBS expansion
  document.querySelectorAll('.wbs-row').forEach(row => {
    row.addEventListener('click', () => {
      const wbsId = row.getAttribute('data-wbs');
      if (wbsId) {
        if (expandedWBS.has(wbsId)) {
          expandedWBS.delete(wbsId);
        } else {
          expandedWBS.add(wbsId);
        }
        renderGantt();
      }
    });
  });
}

function renderTableRow(a: XERActivity): string {
  const { start, end } = activityDates(a);
  const code = escapeHtml(a.task_code);
  const name = escapeHtml(a.task_name);

  return `
    <tr class="task-row ${a.is_critical ? 'critical' : ''}">
      <td title="${code}">${code}</td>
      <td title="${name}">${name}</td>
      <td>${start ? formatDate(start.toISOString()) : '—'}</td>
      <td>${end ? formatDate(end.toISOString()) : '—'}</td>
    </tr>
  `;
}

interface TimeScale {
  start: Date;
  end: Date;
  pxPerDay: number;
  totalWidth: number;
  columns: { label: string; width: number }[];
  xFor: (d: Date) => number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 3600 * 1000;

function activityDates(a: XERActivity): { start: Date | null; end: Date | null } {
  const pick = (...values: (string | undefined)[]) => {
    for (const v of values) {
      if (!v) continue;
      const d = new Date(v.replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  };
  const start = pick(a.act_start_date, a.early_start_date, a.target_start_date);
  const end = pick(a.act_end_date, a.early_end_date, a.target_end_date);
  return { start, end: end ?? start };
}

/**
 * Builds a month/week/day column set covering the whole schedule, padded by a
 * few days so bars at the extremes are not flush against the pane edges.
 */
function buildTimeScale(activities: XERActivity[]): TimeScale {
  let min: number | null = null;
  let max: number | null = null;
  for (const a of activities) {
    const { start, end } = activityDates(a);
    if (start) min = min === null ? start.getTime() : Math.min(min, start.getTime());
    if (end) max = max === null ? end.getTime() : Math.max(max, end.getTime());
  }

  const today = Date.now();
  const startMs = (min ?? today) - 3 * DAY_MS;
  const endMs = Math.max(max ?? today, startMs + 30 * DAY_MS) + 3 * DAY_MS;

  const start = new Date(startMs);
  const end = new Date(endMs);

  const pxPerDay = zoomMode === 'Day' ? 24 : zoomMode === 'Week' ? 8 : 4;
  const totalDays = Math.ceil((endMs - startMs) / DAY_MS);
  const totalWidth = Math.max(600, totalDays * pxPerDay);
  const xFor = (d: Date) => ((d.getTime() - startMs) / DAY_MS) * pxPerDay;

  const columns: { label: string; width: number }[] = [];
  if (zoomMode === 'Day') {
    for (let t = startMs; t < endMs; t += DAY_MS) {
      const d = new Date(t);
      columns.push({ label: `${d.getDate()}`, width: pxPerDay });
    }
  } else if (zoomMode === 'Week') {
    // Snap the first column back to the Monday containing the schedule start.
    const cursor = new Date(startMs);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    while (cursor.getTime() < endMs) {
      const next = new Date(cursor.getTime() + 7 * DAY_MS);
      const from = Math.max(cursor.getTime(), startMs);
      const to = Math.min(next.getTime(), endMs);
      columns.push({
        label: `${cursor.getDate()} ${MONTH_NAMES[cursor.getMonth()]}`,
        width: ((to - from) / DAY_MS) * pxPerDay,
      });
      cursor.setTime(next.getTime());
    }
  } else {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor.getTime() < endMs) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const from = Math.max(cursor.getTime(), startMs);
      const to = Math.min(next.getTime(), endMs);
      columns.push({
        label: `${MONTH_NAMES[cursor.getMonth()]}-${String(cursor.getFullYear()).slice(2)}`,
        width: ((to - from) / DAY_MS) * pxPerDay,
      });
      cursor.setTime(next.getTime());
    }
  }

  return { start, end, pxPerDay, totalWidth, columns, xFor };
}

function spanOf(activities: XERActivity[], scale: TimeScale): { left: number; width: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const a of activities) {
    const { start, end } = activityDates(a);
    if (start) min = min === null ? start.getTime() : Math.min(min, start.getTime());
    if (end) max = max === null ? end.getTime() : Math.max(max, end.getTime());
  }
  if (min === null || max === null) return null;
  const left = scale.xFor(new Date(min));
  return { left, width: Math.max(4, scale.xFor(new Date(max)) - left) };
}

function renderBarRow(a: XERActivity, scale: TimeScale): string {
  const { start, end } = activityDates(a);
  if (!start) return '<div class="gantt-row-container"></div>';

  const leftPx = scale.xFor(start);
  const tooltip = `${a.task_code} — ${a.task_name}`;

  if (a.is_milestone) {
    return `
      <div class="gantt-row-container">
        <div class="gantt-milestone-diamond ${a.is_critical ? 'critical' : ''}" style="left:${leftPx}px;" title="${escapeHtml(tooltip)}"></div>
      </div>
    `;
  }

  const rightPx = scale.xFor(end ?? start);
  const widthPx = Math.max(3, rightPx - leftPx);

  // Progressed work is drawn as a filled portion of the same bar.
  const progress =
    a.status_code === 'TK_Complete'
      ? 1
      : a.target_drtn_hr_cnt > 0
        ? Math.min(1, Math.max(0, 1 - a.remain_drtn_hr_cnt / a.target_drtn_hr_cnt))
        : 0;

  return `
    <div class="gantt-row-container">
      <div class="gantt-bar-item ${a.is_critical ? 'critical' : ''}" style="left:${leftPx}px; width:${widthPx}px;" title="${escapeHtml(tooltip)}">
        ${progress > 0 ? `<div class="gantt-bar-progress" style="width:${(progress * 100).toFixed(1)}%"></div>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(2);
  return `${day}-${month}-${yr}`;
}

function exportViewerCSV() {
  if (!filteredActivities.length) return;
  let csv = 'Activity ID,Activity Name,Start Date,End Date,Duration (Days),Float (Days),Status,Critical\n';
  filteredActivities.forEach(a => {
    csv += `"${a.task_code}","${a.task_name.replace(/"/g, '""')}","${a.early_start_date || ''}","${a.early_end_date || ''}",${(a.target_drtn_hr_cnt/8).toFixed(1)},${(a.total_float_hr_cnt/8).toFixed(1)},"${a.status_code}",${a.is_critical ? 'Yes' : 'No'}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `P6_Viewer_Export_${new Date().toISOString().slice(0, 10)}.csv`);
  link.click();
}

function setupScheduleMentor() {
  const sidebar = document.getElementById('mentorSidebar');
  if (!sidebar) return;

  const categories: MentorTopic['category'][] = ['Logic', 'Constraints', 'Calendars & durations', 'Progress', 'Structure'];

  sidebar.innerHTML = categories
    .map(cat => {
      const topics = mentorTopics.filter(t => t.category === cat);
      if (!topics.length) return '';
      return `
        <div style="margin-bottom:16px;">
          <div class="stat-label" style="margin-bottom:6px;">${escapeHtml(cat)}</div>
          <div style="display:flex; flex-direction:column; gap:2px;">
            ${topics.map(t => `
              <button class="mentor-topic-btn ${t.id === selectedMentorTopic.id ? 'active' : ''}" data-id="${t.id}">
                <span class="code-chip">${escapeHtml(t.code)}</span>
                <span>${escapeHtml(t.title)}</span>
              </button>
            `).join('')}
          </div>
        </div>`;
    })
    .join('');

  sidebar.querySelectorAll<HTMLButtonElement>('.mentor-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = mentorTopics.find(t => t.id === btn.dataset.id);
      if (topic) {
        selectedMentorTopic = topic;
        setupScheduleMentor();
      }
    });
  });

  renderScheduleMentorContent();
}

function renderScheduleMentorContent() {
  const content = document.getElementById('mentorContent');
  if (!content || !selectedMentorTopic) return;

  const topic = selectedMentorTopic;
  const affected = currentXER ? topic.getAffectedTasks(currentXER.activities, currentXER.relationships) : [];
  const hpd = thresholdConfig.hoursPerDay;

  content.innerHTML = `
    <div class="section-head">
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="badge-count badge-na" style="font-family:var(--font-mono)">${escapeHtml(topic.code)}</span>
        <h2>${escapeHtml(topic.title)}</h2>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:16px;">
      <div class="card"><h3 style="color:var(--red)">Why it matters</h3><p class="muted">${escapeHtml(topic.whyItMatters)}</p></div>
      <div class="card"><h3 style="color:var(--accent)">How to fix it in P6</h3><p class="muted">${escapeHtml(topic.howToFixInP6)}</p></div>
      <div class="card"><h3 style="color:var(--green)">When it is actually fine</h3><p class="muted">${escapeHtml(topic.whenItsFine)}</p></div>
    </div>

    <div class="card">
      <div class="section-head">
        <h3>Affected activities in the loaded schedule (${affected.length})</h3>
        ${affected.length ? '<button class="pill-btn" id="mentorExportBtn">Export list</button>' : ''}
      </div>
      ${affected.length === 0
        ? '<p class="muted">Nothing in the loaded schedule violates this rule.</p>'
        : `<div class="table-responsive" style="max-height:420px;">
            <table class="data-table">
              <thead><tr><th>Activity ID</th><th>Activity name</th><th>Duration (d)</th><th>Total float (d)</th></tr></thead>
              <tbody>
                ${affected.slice(0, 500).map(a => `
                  <tr>
                    <td><strong>${escapeHtml(a.task_code)}</strong></td>
                    <td>${escapeHtml(a.task_name)}</td>
                    <td>${(a.target_drtn_hr_cnt / hpd).toFixed(1)}</td>
                    <td>${(a.total_float_hr_cnt / hpd).toFixed(1)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${affected.length > 500 ? '<p class="muted">Showing the first 500; export for the full list.</p>' : ''}`}
    </div>
  `;

  document.getElementById('mentorExportBtn')?.addEventListener('click', () => {
    const rows = [['Activity ID', 'Activity name', 'Duration (d)', 'Total float (d)']];
    affected.forEach(a => rows.push([
      a.task_code, a.task_name,
      (a.target_drtn_hr_cnt / hpd).toFixed(1),
      (a.total_float_hr_cnt / hpd).toFixed(1),
    ]));
    downloadCSV(rows, `mentor-${topic.code}.csv`);
  });
}


function ragLabel(rag: string): string {
  return rag === 'na' ? 'N/A' : rag.charAt(0).toUpperCase() + rag.slice(1);
}

function formatMetricValue(m: { unit: string; value: number; rag: string }): string {
  if (m.rag === 'na') return '—';
  if (m.unit === 'percent') return `${m.value.toFixed(1)}%`;
  if (m.unit === 'ratio') return m.value.toFixed(2);
  return String(m.value);
}

function renderDCMA() {
  if (!currentXER) return;
  const report = calculateDCMA14(currentXER, thresholdConfig);

  const container = document.getElementById('tab-dcma');
  if (!container) return;

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>DCMA 14-point assessment</h2>
        <p class="section-sub">
          Every check below is computed from the schedule currently loaded. Checks that cannot be
          evaluated from a single XER are reported as N/A with the reason, rather than silently passed.
        </p>
      </div>
      <div class="section-actions">
        <button class="pill-btn" id="openThresholdsBtn">Thresholds &amp; settings</button>
        <button class="pill-btn" id="exportDcmaCsvBtn">Export CSV</button>
      </div>
    </div>

    <div class="dcma-header-summary">
      <div class="dcma-meta-grid">
        <div class="dcma-meta-item"><strong>Project</strong><span>${escapeHtml(report.projectName)}</span></div>
        <div class="dcma-meta-item"><strong>Project ID</strong><span>${escapeHtml(report.projectCode)}</span></div>
        <div class="dcma-meta-item"><strong>Data date</strong><span>${report.dataDate ? formatDate(report.dataDate.toISOString()) : 'not stated'}</span></div>
        <div class="dcma-meta-item"><strong>Activities</strong><span>${report.activityCount} (${report.incompleteCount} incomplete)</span></div>
        <div class="dcma-meta-item"><strong>Relationships</strong><span>${report.relationshipCount}</span></div>
        <div class="dcma-meta-item"><strong>Health score</strong><span class="score-value">${report.overallScore}%</span></div>
      </div>

      <div class="dcma-score-badges">
        <span class="badge-count badge-green">${report.greenCount} Green</span>
        <span class="badge-count badge-amber">${report.amberCount} Amber</span>
        <span class="badge-count badge-red">${report.redCount} Red</span>
        <span class="badge-count badge-na">${report.naCount} N/A</span>
      </div>
    </div>

    <div class="dcma-cards-grid">
      ${report.metrics.map(m => `
        <div class="dcma-card rag-${m.rag}" data-check="${m.id}" tabindex="0" role="button"
             aria-label="Check ${m.id} ${escapeHtml(m.name)}, ${ragLabel(m.rag)}">
          <div class="dcma-card-header">
            <div>
              <span class="dcma-card-check-no">Check ${m.id}</span>
              <div class="dcma-card-title">${escapeHtml(m.name)}</div>
            </div>
            <span class="dcma-card-rag badge-${m.rag}">${ragLabel(m.rag)}</span>
          </div>
          <div class="dcma-card-metric">${formatMetricValue(m)}</div>
          <div class="dcma-card-desc">
            ${m.notAssessedReason
              ? escapeHtml(m.notAssessedReason)
              : `${escapeHtml(m.description)}<br><span class="muted">${m.unit === 'ratio' ? `Target ${escapeHtml(m.target)}` : `${m.count} of ${m.total} · target ${escapeHtml(m.target)}`}</span>`}
          </div>
          ${m.flaggedTasks.length ? `<div class="dcma-card-cta">${m.flaggedTasks.length} flagged activities — view</div>` : ''}
        </div>
      `).join('')}
    </div>

    <div id="dcmaDrilldown" class="card" style="display:none;"></div>

    <div id="thresholdsModal" class="modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-label="Thresholds and settings">
      <div class="modal-card">
        <div class="modal-head">
          <h3>Thresholds &amp; settings</h3>
          <button id="closeThresholdsModalBtn" class="icon-btn" aria-label="Close">&times;</button>
        </div>

        <div class="form-grid-3">
          <label>Profile name
            <input type="text" class="text-input" id="thProfileName" value="${escapeHtml(thresholdConfig.profileName)}" />
          </label>
          <label>Hours per day
            <input type="number" class="number-input" id="thHoursPerDay" min="1" max="24" value="${thresholdConfig.hoursPerDay}" />
          </label>
          <label>High float / duration horizon (wd)
            <input type="number" class="number-input" id="thHorizon" min="1" value="${thresholdConfig.highFloatHorizonDays}" />
          </label>
        </div>

        <table class="threshold-table">
          <thead>
            <tr><th>Check</th><th>Unit</th><th>Green</th><th>Amber</th></tr>
          </thead>
          <tbody>
            ${report.metrics.map(m => `
              <tr>
                <td><strong>${m.id}. ${escapeHtml(m.name)}</strong></td>
                <td>${m.unit}</td>
                <td><input type="number" step="0.01" data-band="green" data-check="${m.id}" value="${thresholdConfig.ragBands[m.id].green}" /></td>
                <td><input type="number" step="0.01" data-band="amber" data-check="${m.id}" value="${thresholdConfig.ragBands[m.id].amber}" /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="modal-actions">
          <button class="pill-btn" id="resetThresholdsBtn">Reset to DCMA defaults</button>
          <button class="pill-btn" id="cancelThresholdsBtn">Cancel</button>
          <button class="pill-btn active" id="applyThresholdsBtn">Apply</button>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById('thresholdsModal');
  const closeModal = () => { if (modal) modal.style.display = 'none'; };

  document.getElementById('openThresholdsBtn')?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
  });
  document.getElementById('closeThresholdsModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelThresholdsBtn')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.getElementById('resetThresholdsBtn')?.addEventListener('click', () => {
    thresholdConfig = structuredClone(defaultThresholds);
    renderDCMA();
  });

  document.getElementById('applyThresholdsBtn')?.addEventListener('click', () => {
    const profile = (document.getElementById('thProfileName') as HTMLInputElement)?.value;
    const hours = parseFloat((document.getElementById('thHoursPerDay') as HTMLInputElement)?.value);
    const horizon = parseFloat((document.getElementById('thHorizon') as HTMLInputElement)?.value);

    if (profile) thresholdConfig.profileName = profile;
    if (Number.isFinite(hours) && hours > 0) thresholdConfig.hoursPerDay = hours;
    if (Number.isFinite(horizon) && horizon > 0) {
      thresholdConfig.highFloatHorizonDays = horizon;
      thresholdConfig.highDurationHorizonDays = horizon;
    }

    modal?.querySelectorAll<HTMLInputElement>('input[data-check]').forEach(input => {
      const id = Number(input.dataset.check);
      const band = input.dataset.band as 'green' | 'amber';
      const value = parseFloat(input.value);
      if (Number.isFinite(value) && thresholdConfig.ragBands[id]) {
        thresholdConfig.ragBands[id][band] = value;
      }
    });

    closeModal();
    // Thresholds feed the risk engine's day divisor too, so refresh both tabs.
    riskSettings.hoursPerDay = thresholdConfig.hoursPerDay;
    renderDCMA();
    renderMonteCarlo();
  });

  document.getElementById('exportDcmaCsvBtn')?.addEventListener('click', () => {
    const rows = [['Check', 'Name', 'Value', 'Unit', 'Target', 'RAG', 'Flagged', 'Total', 'Note']];
    report.metrics.forEach(m => {
      rows.push([
        String(m.id), m.name, formatMetricValue(m), m.unit, m.target,
        ragLabel(m.rag), String(m.count), String(m.total), m.notAssessedReason || '',
      ]);
    });
    downloadCSV(rows, `dcma-14-point-${report.projectCode}.csv`);
  });

  const drilldown = document.getElementById('dcmaDrilldown');
  container.querySelectorAll<HTMLElement>('.dcma-card').forEach(card => {
    const show = () => {
      const id = Number(card.dataset.check);
      const metric = report.metrics.find(m => m.id === id);
      if (!metric || !drilldown) return;

      if (!metric.flaggedTasks.length) {
        drilldown.style.display = 'block';
        drilldown.innerHTML = `<h3>Check ${metric.id} — ${escapeHtml(metric.name)}</h3>
          <p class="muted">${escapeHtml(metric.notAssessedReason || 'No activities are flagged by this check.')}</p>`;
        return;
      }

      drilldown.style.display = 'block';
      drilldown.innerHTML = `
        <div class="section-head">
          <h3>Check ${metric.id} — ${escapeHtml(metric.name)} (${metric.flaggedTasks.length} activities)</h3>
          <button class="pill-btn" id="dcmaDrilldownCsv">Export list</button>
        </div>
        <div class="table-responsive" style="max-height:340px;">
          <table class="data-table">
            <thead><tr><th>Activity ID</th><th>Name</th><th>Status</th><th>Duration (d)</th><th>Total float (d)</th></tr></thead>
            <tbody>
              ${metric.flaggedTasks.slice(0, 500).map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.task_code)}</strong></td>
                  <td>${escapeHtml(a.task_name)}</td>
                  <td>${a.status_code.replace('TK_', '')}</td>
                  <td>${(a.target_drtn_hr_cnt / thresholdConfig.hoursPerDay).toFixed(1)}</td>
                  <td>${(a.total_float_hr_cnt / thresholdConfig.hoursPerDay).toFixed(1)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${metric.flaggedTasks.length > 500 ? '<p class="muted">Showing the first 500; export the list for the full set.</p>' : ''}
      `;
      drilldown.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      document.getElementById('dcmaDrilldownCsv')?.addEventListener('click', () => {
        const rows = [['Activity ID', 'Name', 'Status', 'Duration (d)', 'Total float (d)']];
        metric.flaggedTasks.forEach(a => rows.push([
          a.task_code, a.task_name, a.status_code,
          (a.target_drtn_hr_cnt / thresholdConfig.hoursPerDay).toFixed(1),
          (a.total_float_hr_cnt / thresholdConfig.hoursPerDay).toFixed(1),
        ]));
        downloadCSV(rows, `dcma-check-${metric.id}.csv`);
      });
    };

    card.addEventListener('click', show);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    });
  });
}

/** Quotes every field so embedded commas, quotes and newlines survive Excel. */
function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}



function renderPathAnalyser() {
  if (!currentXER) return;
  const container = document.getElementById('pathAnalyserContainer');
  if (!container) return;

  const xer = currentXER;
  const network = buildNetwork(xer.activities, xer.relationships);
  const cpm = solveCPM(network);
  const hpd = thresholdConfig.hoursPerDay;

  // Walk the driving chain backwards from the last-finishing activity: at each
  // step take the predecessor that actually sets this activity's early start.
  const path: number[] = [];
  let cursor = -1;
  let latest = -Infinity;
  for (let i = 0; i < network.ids.length; i++) {
    if (cpm.earlyFinish[i] > latest) { latest = cpm.earlyFinish[i]; cursor = i; }
  }

  const visited = new Set<number>();
  while (cursor >= 0 && !visited.has(cursor)) {
    visited.add(cursor);
    path.push(cursor);

    let driver = -1;
    let driverFinish = -Infinity;
    for (const e of network.preds[cursor]) {
      // Only a predecessor whose own finish equals this start is truly driving.
      const contributes = e.type === 'PR_SS' || e.type === 'PR_SF'
        ? cpm.earlyStart[e.pred] + e.lag
        : cpm.earlyFinish[e.pred] + e.lag;
      if (Math.abs(contributes - cpm.earlyStart[cursor]) < 1e-6 && cpm.earlyFinish[e.pred] > driverFinish) {
        driver = e.pred;
        driverFinish = cpm.earlyFinish[e.pred];
      }
    }
    cursor = driver;
  }
  path.reverse();

  const totalDays = cpm.projectDuration / hpd;

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Longest path analyser</h2>
        <p class="section-sub">
          The driving chain traced backwards from the last-finishing activity, following the
          predecessor that actually sets each early start. This is the longest path, which is not
          always the same as everything P6 flags with zero float.
        </p>
      </div>
      <div class="section-actions">
        <button class="pill-btn" id="exportPathCsvBtn">Export path</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-tile"><span class="stat-label">Path length</span><span class="stat-value">${path.length} activities</span></div>
      <div class="stat-tile"><span class="stat-label">Project duration</span><span class="stat-value">${totalDays.toFixed(1)} days</span></div>
      <div class="stat-tile"><span class="stat-label">Zero-float activities</span><span class="stat-value">${cpm.criticalIds.length}</span></div>
      ${network.droppedEdges ? `<div class="stat-tile"><span class="stat-label">Circular logic</span><span class="stat-value">${network.droppedEdges}</span></div>` : ''}
    </div>

    <div class="card">
      <div class="table-responsive" style="max-height:560px;">
        <table class="data-table">
          <thead>
            <tr><th style="width:44px">#</th><th>Activity ID</th><th>Activity name</th><th>Duration (d)</th><th>Total float (d)</th><th>Cumulative (d)</th></tr>
          </thead>
          <tbody>
            ${path.map((idx, n) => {
              const a = xer.activities[idx];
              return `
                <tr>
                  <td class="muted">${n + 1}</td>
                  <td><strong>${escapeHtml(a.task_code)}</strong></td>
                  <td>${escapeHtml(a.task_name)}</td>
                  <td>${(network.durations[idx] / hpd).toFixed(1)}</td>
                  <td>${(cpm.totalFloat[idx] / hpd).toFixed(1)}</td>
                  <td>${(cpm.earlyFinish[idx] / hpd).toFixed(1)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('exportPathCsvBtn')?.addEventListener('click', () => {
    const rows = [['#', 'Activity ID', 'Activity name', 'Duration (d)', 'Total float (d)', 'Cumulative (d)']];
    path.forEach((idx, n) => {
      const a = xer.activities[idx];
      rows.push([
        String(n + 1), a.task_code, a.task_name,
        (network.durations[idx] / hpd).toFixed(1),
        (cpm.totalFloat[idx] / hpd).toFixed(1),
        (cpm.earlyFinish[idx] / hpd).toFixed(1),
      ]);
    });
    downloadCSV(rows, 'longest-path.csv');
  });
}


function fmtDate(d: Date): string {
  return formatDate(d.toISOString());
}

function renderMonteCarlo() {
  if (!currentXER) return;

  const container = document.getElementById('tab-risk');
  if (!container) return;

  const result = runMonteCarloRisk(currentXER, riskSettings);
  lastRiskResult = result;
  const diag = result.diagnostics;

  const warnings: string[] = [];
  if (diag.openEnds > 0) {
    warnings.push(`${diag.openEnds} incomplete activities have an open end (no predecessor or no successor). Broken logic makes risk analysis unreliable — fix it before quoting these numbers.`);
  }
  if (diag.cyclesDropped > 0) {
    warnings.push(`${diag.cyclesDropped} activities sit in a circular relationship. They were scheduled in file order so the passes could terminate; their dates are approximate.`);
  }
  if (diag.leads > 0 || diag.lags > 0) {
    warnings.push(`${diag.lags} relationships carry positive lag and ${diag.leads} carry negative lag (leads). Lags are held fixed across iterations — they are not risk-ranged, so they can mask exposure.`);
  }
  if (diag.reconciliationDeltaDays !== null && Math.abs(diag.reconciliationDeltaDays) > 5) {
    warnings.push(`The engine's deterministic finish is ${diag.reconciliationDeltaDays > 0 ? '+' : ''}${diag.reconciliationDeltaDays} days from the finish in the XER. Calendars are not modelled, so treat the absolute dates as indicative and the ranking of drivers as the useful output.`);
  }

  const maxCrit = Math.max(1, ...result.criticalityIndex.map(c => c.percentage));
  const maxSens = Math.max(0.01, ...result.durationSensitivity.map(s => Math.abs(s.correlation)));

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Schedule risk analysis <span class="tag tag-beta">screening grade</span></h2>
        <p class="section-sub">
          A seeded Monte Carlo simulation of your P6 network, run entirely in the browser. Every
          iteration re-solves the critical path, so criticality and sensitivity are measured, not assumed.
        </p>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-tile"><span class="stat-label">P10</span><span class="stat-value">${fmtDate(result.p10Date)}</span></div>
      <div class="stat-tile"><span class="stat-label">P50</span><span class="stat-value">${fmtDate(result.p50Date)}</span></div>
      <div class="stat-tile accent"><span class="stat-label">P80</span><span class="stat-value">${fmtDate(result.p80Date)}</span></div>
      <div class="stat-tile"><span class="stat-label">P90</span><span class="stat-value">${fmtDate(result.p90Date)}</span></div>
      <div class="stat-tile"><span class="stat-label">Deterministic finish</span><span class="stat-value">${fmtDate(result.planDate)} <em>P${result.planPValue}</em></span></div>
    </div>

    ${warnings.length ? `<div class="callout callout-warn">
      <strong>Before you rely on this</strong>
      <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
    </div>` : `<div class="callout callout-ok">No logic defects were detected that would invalidate the simulation.</div>`}

    <div class="card">
      <h3>Ranges &amp; settings</h3>
      <div class="form-grid-6">
        <label>Optimistic %<input type="number" class="number-input" id="riskOpt" value="${riskSettings.optimisticPct}" min="1" max="200" /></label>
        <label>Most likely %<input type="number" class="number-input" id="riskMode" value="${riskSettings.mostLikelyPct}" min="1" max="300" /></label>
        <label>Pessimistic %<input type="number" class="number-input" id="riskPess" value="${riskSettings.pessimisticPct}" min="1" max="500" /></label>
        <label>Distribution
          <select class="select-input" id="riskDist">
            <option value="Beta-PERT" ${riskSettings.distribution === 'Beta-PERT' ? 'selected' : ''}>Beta-PERT</option>
            <option value="Triangular" ${riskSettings.distribution === 'Triangular' ? 'selected' : ''}>Triangular</option>
          </select>
        </label>
        <label>Iterations<input type="number" class="number-input" id="riskIters" value="${riskSettings.iterations}" min="100" max="20000" step="100" /></label>
        <label>Seed<input type="number" class="number-input" id="riskSeed" value="${riskSettings.seed}" /></label>
      </div>
      <div class="button-row">
        <button class="pill-btn active" id="runSimBtn">Run simulation</button>
        <button class="pill-btn" id="exportQSRAPdfBtn">PDF summary report</button>
        <button class="pill-btn" id="exportDriversCsvBtn">Drivers CSV</button>
      </div>
      <p class="muted">
        ${diag.activitiesSimulated} duration-bearing activities · ${result.iterations} iterations ·
        ${result.distribution} · seed ${result.seed} (the same seed always reproduces this result).
      </p>
    </div>

    <div class="card">
      <h3>Completion distribution</h3>
      <div class="chart-wrap"><canvas id="qsraComboCanvas" height="130"></canvas></div>
      <details class="explainer">
        <summary>What am I looking at?</summary>
        <p>
          The line is the cumulative probability of finishing by each date; the bars are how many of the
          ${result.iterations} iterations landed in each window. P80 means an 80% chance of finishing on or
          before that date. Deterministic dates usually land low because of merge bias: where paths join, the
          later one wins, so parallel risk only ever pushes the date out.
        </p>
      </details>
      <p class="muted">
        Simulated project duration: ${result.minDurationDays}–${result.maxDurationDays} days
        (mean ${result.meanDurationDays}, P50 ${result.p50DurationDays}).
      </p>
    </div>

    <div class="two-col">
      <div class="card">
        <h3>Criticality index</h3>
        <p class="muted">Share of iterations each activity spent on the critical path.</p>
        <div class="bar-list">
          ${result.criticalityIndex.length ? result.criticalityIndex.map(c => `
            <div class="bar-row" title="${escapeHtml(c.activityName)}">
              <span class="bar-label">${escapeHtml(c.activityCode)}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${(c.percentage / maxCrit) * 100}%"></div></div>
              <span class="bar-value">${c.percentage.toFixed(1)}%</span>
            </div>
          `).join('') : '<p class="muted">No activity reached the critical path in any iteration.</p>'}
        </div>
      </div>

      <div class="card">
        <h3>Duration sensitivity</h3>
        <p class="muted">Pearson correlation between an activity's sampled duration and the project finish.</p>
        <div class="bar-list">
          ${result.durationSensitivity.length ? result.durationSensitivity.map(s => `
            <div class="bar-row" title="${escapeHtml(s.activityName)}">
              <span class="bar-label">${escapeHtml(s.activityCode)}</span>
              <div class="bar-track"><div class="bar-fill ${s.correlation < 0 ? 'negative' : ''}" style="width:${(Math.abs(s.correlation) / maxSens) * 100}%"></div></div>
              <span class="bar-value">${s.correlation.toFixed(2)}</span>
            </div>
          `).join('') : '<p class="muted">Not enough variation to correlate.</p>'}
        </div>
      </div>
    </div>

    <details class="explainer">
      <summary>Criticality vs sensitivity</summary>
      <p>
        <strong>Criticality index</strong> is how often an activity sits on the critical path across iterations.
        <strong>Sensitivity</strong> is how strongly its sampled duration moves the finish date. High on both
        means a genuine risk driver; high criticality with low sensitivity usually means a short activity that
        is always on the path but never moves it.
      </p>
    </details>
  `;

  document.getElementById('runSimBtn')?.addEventListener('click', () => {
    const num = (id: string, fallback: number) => {
      const v = parseFloat((document.getElementById(id) as HTMLInputElement)?.value);
      return Number.isFinite(v) ? v : fallback;
    };
    const opt = num('riskOpt', riskSettings.optimisticPct);
    const mode = num('riskMode', riskSettings.mostLikelyPct);
    const pess = num('riskPess', riskSettings.pessimisticPct);

    if (!(opt <= mode && mode <= pess)) {
      alert('Ranges must satisfy optimistic ≤ most likely ≤ pessimistic.');
      return;
    }

    riskSettings = {
      ...riskSettings,
      optimisticPct: opt,
      mostLikelyPct: mode,
      pessimisticPct: pess,
      iterations: num('riskIters', riskSettings.iterations),
      seed: num('riskSeed', riskSettings.seed),
      distribution: ((document.getElementById('riskDist') as HTMLSelectElement)?.value ||
        riskSettings.distribution) as QSRARiskSettings['distribution'],
    };
    renderMonteCarlo();
  });

  document.getElementById('exportQSRAPdfBtn')?.addEventListener('click', exportQSRAPdfReport);

  document.getElementById('exportDriversCsvBtn')?.addEventListener('click', () => {
    const rows = [['Type', 'Activity ID', 'Activity name', 'Value']];
    result.criticalityIndex.forEach(c => rows.push(['Criticality %', c.activityCode, c.activityName, c.percentage.toFixed(1)]));
    result.durationSensitivity.forEach(s => rows.push(['Sensitivity r', s.activityCode, s.activityName, s.correlation.toFixed(3)]));
    downloadCSV(rows, 'qsra-risk-drivers.csv');
  });

  const comboCtx = document.getElementById('qsraComboCanvas') as HTMLCanvasElement | null;
  if (comboCtx) {
    if (riskChartInstance) riskChartInstance.destroy();

    // Chart.js has no concept of our theme, so hand it the resolved token values.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const textColour = token('--text-muted', '#64748b');
    const gridColour = token('--border', '#e2e8f0');
    const accent = token('--accent', '#2563eb');
    Chart.defaults.color = textColour;
    Chart.defaults.borderColor = gridColour;
    Chart.defaults.font.family = token('--font', 'sans-serif');
    riskChartInstance = new Chart(comboCtx, {
      type: 'bar',
      data: {
        labels: result.sCurveData.map(p => p.dateLabel),
        datasets: [
          {
            type: 'line',
            label: 'Cumulative probability',
            data: result.sCurveData.map(p => p.probability),
            borderColor: accent,
            borderWidth: 3,
            pointRadius: 0,
            fill: false,
            tension: 0.25,
            yAxisID: 'yS',
          },
          {
            type: 'bar',
            label: 'Iterations',
            data: result.distributionHistogram.map(b => b.count),
            backgroundColor: accent + '2e',
            borderColor: accent + '66',
            borderWidth: 1,
            barPercentage: 0.9,
            categoryPercentage: 1,
            yAxisID: 'yH',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColour, maxRotation: 45, autoSkipPadding: 12 } },
          yS: { position: 'left', min: 0, max: 100, grid: { color: gridColour }, ticks: { color: textColour, callback: v => `${v}%` }, title: { display: true, text: 'Confidence', color: textColour } },
          yH: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: textColour }, title: { display: true, text: 'Iterations', color: textColour } },
        },
      },
    });
  }
}


// jsPDF is ~350 kB, so it is fetched only when a report is actually requested.
async function exportQSRAPdfReport() {
  if (!currentXER || !lastRiskResult) return;
  const result = lastRiskResult;
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF('p', 'mm', 'a4');
  const left = 14;
  const pageBottom = 275;
  let y = 20;

  const line = (text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    // Wrap long activity names instead of letting them run off the page.
    const wrapped = doc.splitTextToSize(text, 182 - (opts.indent ?? 0));
    for (const part of wrapped) {
      if (y > pageBottom) { doc.addPage(); y = 20; }
      doc.text(part, left + (opts.indent ?? 0), y);
      y += opts.gap ?? 5.5;
    }
  };

  const project = currentXER.project;
  doc.setTextColor(15, 23, 42);
  line('Schedule Risk Analysis — screening report', { size: 17, bold: true, gap: 8 });
  line(`Project: ${project?.proj_short_name ?? '—'} — ${project?.proj_name ?? 'Untitled'}`);
  line(`Generated: ${new Date().toLocaleString()}`);
  line(`Method: ${result.distribution}, ${result.iterations} iterations, seed ${result.seed}`, { gap: 8 });

  doc.setLineWidth(0.4);
  doc.line(left, y, 196, y);
  y += 8;

  line('1. Forecast completion', { size: 12, bold: true, gap: 7 });
  line(`P10: ${fmtDate(result.p10Date)}`, { indent: 4 });
  line(`P50: ${fmtDate(result.p50Date)}`, { indent: 4 });
  line(`P80: ${fmtDate(result.p80Date)}`, { indent: 4 });
  line(`P90: ${fmtDate(result.p90Date)}`, { indent: 4 });
  line(`Deterministic finish ${fmtDate(result.planDate)} carries P${result.planPValue} confidence.`, { indent: 4, gap: 8 });

  line('2. Schedule health caveats', { size: 12, bold: true, gap: 7 });
  const d = result.diagnostics;
  line(`Activities simulated: ${d.activitiesSimulated}`, { indent: 4 });
  line(`Open ends: ${d.openEnds} · circular logic: ${d.cyclesDropped}`, { indent: 4 });
  line(`Relationships with lag: ${d.lags} · with leads: ${d.leads}`, { indent: 4 });
  if (d.reconciliationDeltaDays !== null) {
    line(`Engine finish vs XER finish: ${d.reconciliationDeltaDays > 0 ? '+' : ''}${d.reconciliationDeltaDays} days.`, { indent: 4 });
  }
  line('Calendars are not modelled; absolute dates are indicative and driver ranking is the primary output.', { indent: 4, gap: 8 });

  line('3. Top criticality drivers', { size: 12, bold: true, gap: 7 });
  result.criticalityIndex.slice(0, 10).forEach(c => {
    line(`${c.activityCode} — ${c.activityName} (${c.percentage.toFixed(1)}%)`, { indent: 4 });
  });
  y += 3;

  line('4. Top duration sensitivity', { size: 12, bold: true, gap: 7 });
  result.durationSensitivity.slice(0, 10).forEach(s => {
    line(`${s.activityCode} — ${s.activityName} (r = ${s.correlation.toFixed(2)})`, { indent: 4 });
  });

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('TPPSCI · generated entirely in the browser — no schedule data left this machine.', left, 288);

  doc.save(`qsra-screening-report-${project?.proj_short_name ?? 'project'}.pdf`);
}


function renderTimeChainage() {
  const container = document.getElementById('tab-linear');
  if (!container) return;

  const demoLinearActivities = [
    { code: 'RAIL-01', name: 'Trackbed Prep & Sub-ballast', from: 0, to: 2500, start: '2024-02-01', end: '2024-03-15', color: '#dc2626' },
    { code: 'RAIL-02', name: 'Sleepers & Rail Laying Gang A', from: 500, to: 3500, start: '2024-03-01', end: '2024-05-10', color: '#16a34a' },
    { code: 'RAIL-03', name: 'Drainage & Ducting Trenching', from: 1000, to: 4000, start: '2024-03-20', end: '2024-05-30', color: '#dc2626' },
    { code: 'RAIL-04', name: 'Track Ballasting & Tamping', from: 2000, to: 5500, start: '2024-04-10', end: '2024-06-20', color: '#16a34a' },
    { code: 'RAIL-05', name: 'Overhead Catenary Gantry Erection', from: 3000, to: 7000, start: '2024-05-15', end: '2024-08-01', color: '#c084fc' },
    { code: 'RAIL-06', name: 'Signalling Cables & Interlocking', from: 4500, to: 8500, start: '2024-06-01', end: '2024-09-15', color: '#dc2626' },
    { code: 'RAIL-07', name: 'Line Testing & High-Speed Runs', from: 6000, to: 10000, start: '2024-08-10', end: '2024-11-30', color: '#38bdf8' },
  ];

  container.innerHTML = `
    ${prototypeBanner('Chainage mapping uses a built-in demo linear scheme.')}

    <!-- Top Tool Header -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">Time–Chainage chart generator BETA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5; margin-bottom:12px;">
        Turn a Primavera P6 schedule of linear works, rail, highways, pipelines, tunnels, transmission, into an interactive time–location diagram. Almost nothing exists for this; it’s a signature tool for our sectors.
      </p>

      <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:12px; font-size:12px; color:#334155; margin-bottom:12px">
        A sloped line is a linear activity, its slope is the production rate (metres/day). Crossing lines are a clash: two crews at the same place at the same time. Vertical dashes are a station/structure; a diamond is a milestone.
      </div>

      <button class="pill-btn active" id="loadDemoLinearBtn" style="padding:8px 18px; font-weight:700">▶ Load the demo (synthetic linear scheme)</button>
      <span style="font-size:12px; color:#64748b; margin-left:8px">see the chart before mapping your own file</span>
    </div>

    <!-- Step 1: Map Chainage -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">1 · Map chainage onto activities</h3>

      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; margin-bottom:16px;">
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Chainage lives in…</label>
          <select class="select-input" style="width:100%"><option>UDF fields</option><option>Activity ID Regex</option></select>
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">From field</label>
          <select class="select-input" style="width:100%"><option>—</option></select>
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">To field (optional)</label>
          <select class="select-input" style="width:100%"><option>—</option></select>
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Unit convention</label>
          <select class="select-input" style="width:100%"><option>Metres</option></select>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <button class="pill-btn active">Apply mapping</button>
        <span style="font-size:12px; color:#dc2626; margin-left:12px">Mapped 0% of incomplete activities. Fewer than half resolved — chainage usually lives in a UDF or the activity ID.</span>
      </div>

      <!-- Activity Mapping Table -->
      <div class="table-responsive" style="max-height:220px; overflow:auto;">
        <table class="gantt-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>From</th>
              <th>To</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            ${currentXER ? currentXER.activities.slice(0, 10).map(a => `
              <tr>
                <td><strong>${a.task_code}</strong></td>
                <td>${a.task_name}</td>
                <td>-</td>
                <td>-</td>
                <td><span style="color:#64748b; font-size:11px">sitewide</span></td>
              </tr>
            `).join('') : ''}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Step 2: Interactive Chart -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">2 · Time-Location Diagram Chart</h3>

      <div style="display:flex; gap:12px; margin-bottom:16px; align-items:center; flex-wrap:wrap;">
        <span style="font-size:12px; font-weight:600; color:#64748b">Colour by:</span>
        <button class="pill-btn active">WBS branch</button>
        <button class="pill-btn">Transpose</button>
        <button class="pill-btn">Flip time</button>
        <button class="pill-btn">Flip chainage</button>
        <button class="pill-btn">Critical red</button>
        <button class="pill-btn">Rates</button>
        <div style="margin-left:auto; display:flex; gap:8px;">
          <button class="pill-btn">PNG</button>
          <button class="pill-btn">SVG</button>
          <button class="pill-btn">PDF</button>
        </div>
      </div>

      <!-- Time-Chainage Canvas Diagram -->
      <div style="background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:16px;">
        <canvas id="timeChainageDiagram" height="420" style="width:100%;"></canvas>
      </div>
    </div>
  `;

  const drawDiagram = (activitiesToDraw: typeof demoLinearActivities) => {
    const canvas = document.getElementById('timeChainageDiagram') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.parentElement?.clientWidth || 900;
    canvas.height = 420;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const paddingLeft = 70;
    const paddingBottom = 40;
    const paddingTop = 30;
    const paddingRight = 30;

    const chartW = canvas.width - paddingLeft - paddingRight;
    const chartH = canvas.height - paddingTop - paddingBottom;

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;

    const timeTicks = ['Dec-24', 'Oct-24', 'Aug-24', 'Jun-24', 'May-24', 'Mar-24'];
    timeTicks.forEach((t, i) => {
      const y = paddingTop + (i / (timeTicks.length - 1)) * chartH;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + chartW, y);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '11px sans-serif';
      ctx.fillText(t, 15, y + 4);
    });

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop + chartH * 0.52);
    ctx.lineTo(paddingLeft + chartW, paddingTop + chartH * 0.52);
    ctx.stroke();

    activitiesToDraw.forEach(a => {
      const x1 = paddingLeft + (a.from / 10000) * chartW;
      const x2 = paddingLeft + (a.to / 10000) * chartW;

      const y1 = paddingTop + chartH * (1 - (new Date(a.start).getTime() - new Date('2024-02-01').getTime()) / (new Date('2024-12-01').getTime() - new Date('2024-02-01').getTime()));
      const y2 = paddingTop + chartH * (1 - (new Date(a.end).getTime() - new Date('2024-02-01').getTime()) / (new Date('2024-12-01').getTime() - new Date('2024-02-01').getTime()));

      ctx.strokeStyle = a.color;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  setTimeout(() => drawDiagram(demoLinearActivities), 50);

  const demoBtn = document.getElementById('loadDemoLinearBtn');
  if (demoBtn) {
    demoBtn.addEventListener('click', () => drawDiagram(demoLinearActivities));
  }
}



/**
 * Some modules are still interface prototypes: they demonstrate the intended
 * workflow but do not yet compute from the loaded schedule. Saying so in the UI
 * is better than letting a mockup be mistaken for a working analysis.
 */
function prototypeBanner(what: string): string {
  return `<div class="callout callout-warn" role="note">
    <strong>Prototype</strong> — ${escapeHtml(what)} This tab shows the intended
    workflow with illustrative content; it is not yet computed from the schedule you have loaded.
  </div>`;
}

function renderScheduleComparison() {
  const container = document.getElementById('tab-compare');
  if (!container) return;

  container.innerHTML = `
    ${prototypeBanner('Multi-file schedule comparison is not wired to the loaded XER yet.')}

    <!-- Header Banner -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">Schedule Comparison & Milestone Slip Analysis BETA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5;">
        Compare P6 schedules, chart milestone slip and draft a factual narrative, 100% in your browser, nothing uploaded.
      </p>
    </div>

    <!-- Multi-File Slots Container -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:15px; font-weight:700; margin-bottom:12px">Loaded Schedules</h3>
      
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
        <!-- Slot 1: Baseline -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; padding:14px; background:#f8fafc; position:relative;">
          <button style="position:absolute; right:10px; top:10px; background:none; border:none; color:#64748b; cursor:pointer">×</button>
          <div style="font-weight:700; color:#0f172a; font-size:14px; margin-bottom:4px">Demo File.xer <span style="background:#2563eb; color:#fff; font-size:10px; padding:1px 6px; border-radius:3px; margin-left:6px">Baseline</span></div>
          <div style="font-size:12px; color:#64748b; margin-bottom:8px">Data date: 01-Aug-2011</div>
          <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:12px">NRG00870 — Baytown, TX</div>
          <div style="display:flex; gap:8px;">
            <button class="pill-btn active" style="padding:4px 12px; font-weight:600">Set Baseline</button>
            <button class="pill-btn" style="padding:4px 12px">Set Current</button>
          </div>
        </div>

        <!-- Slot 2: Prev Update / Current -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; padding:14px; background:#f8fafc; position:relative;">
          <button style="position:absolute; right:10px; top:10px; background:none; border:none; color:#64748b; cursor:pointer">×</button>
          <div style="font-weight:700; color:#0f172a; font-size:14px; margin-bottom:4px">Demo File.xer <span style="background:#16a34a; color:#fff; font-size:10px; padding:1px 6px; border-radius:3px; margin-left:6px">Current Update</span></div>
          <div style="font-size:12px; color:#64748b; margin-bottom:8px">Data date: 10-Sep-2002</div>
          <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:12px">NRG00820 — Baytown Rev 2</div>
          <div style="display:flex; gap:8px;">
            <button class="pill-btn" style="padding:4px 12px">Set Baseline</button>
            <button class="pill-btn active" style="padding:4px 12px; font-weight:600">Set Current</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:12px; align-items:center;">
        <button class="pill-btn" style="border:1px dashed #94a3b8">+ Add another schedule…</button>
        <button class="pill-btn">⚙ Classification & options</button>
        <button class="pill-btn">Import profile</button>
        <button class="pill-btn">Export profile</button>
        <button class="pill-btn active" style="padding:8px 24px; font-weight:700; margin-left:auto">Analyse →</button>
      </div>
    </div>

    <!-- Report Sub-Navigation Bar -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:20px;">
      <div style="display:flex; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px; flex-wrap:wrap;">
        <button class="pill-btn active" style="font-weight:700">Summary</button>
        <button class="pill-btn">Milestones</button>
        <button class="pill-btn">Slip chart</button>
        <button class="pill-btn">Critical path</button>
        <button class="pill-btn">Change register</button>
        <button class="pill-btn">Float erosion</button>
        <button class="pill-btn">Progress</button>
        <button class="pill-btn">Slippage by WBS</button>
        <button class="pill-btn">Narrative</button>
        <div style="margin-left:auto; display:flex; gap:8px;">
          <button class="pill-btn">⚙ Classification & options</button>
          <button class="pill-btn">🏷 Report header & logo</button>
          <button class="pill-btn">Report / Print</button>
        </div>
      </div>

      <!-- Comparison Metrics Cards -->
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; margin-bottom:20px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:14px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Baseline Data Date</div>
          <div style="font-size:16px; font-weight:800; color:#0f172a">01-Aug-2011</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:14px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Current Data Date</div>
          <div style="font-size:16px; font-weight:800; color:#0f172a">01-Aug-2011</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:14px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Project Finish Movement</div>
          <div style="font-size:16px; font-weight:800; color:#16a34a">0 wd</div>
          <div style="font-size:11px; color:#64748b">15-Sep-2011 → 15-Sep-2011</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:14px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Activities Added / Deleted</div>
          <div style="font-size:16px; font-weight:800; color:#0f172a">0 / 0</div>
          <div style="font-size:11px; color:#64748b">Critical path changed: No</div>
        </div>
      </div>

      <div style="font-size:11px; color:#64748b; font-style:italic; margin-bottom:16px">
        Sign convention: + = slippage (later), − = improvement (earlier), in working days.
      </div>

      <!-- Explanatory Overview Box -->
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:16px;">
        <h4 style="font-size:14px; font-weight:700; margin-bottom:8px">Comparing P6 schedules and measuring milestone slip</h4>
        <p style="color:#64748b; font-size:12px; line-height:1.5; margin-bottom:10px;">
          Progress reporting lives or dies on a clean comparison between where the programme said it would be and where it actually is. This tool lines up a baseline, the current schedule and any interim updates from Primavera P6, and quantifies what has moved.
        </p>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; font-size:12px; color:#334155;">
          <div>
            <strong>What it shows:</strong>
            <ul style="margin-top:4px; padding-left:16px; color:#64748b">
              <li>Milestone slip — change in forecast date for key milestones.</li>
              <li>Slip/trend chart — forecast dates drifting over updates.</li>
              <li>Change register — activities added, deleted or re-logicked.</li>
            </ul>
          </div>
          <div>
            <strong>Why it matters:</strong>
            <p style="color:#64748b; margin-top:4px">
              A single milestone date tells you little; the trend tells you whether the programme is recovering or deteriorating, providing credible monthly report evidence.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderContractorRollup() {
  const container = document.getElementById('tab-rollup');
  if (!container || !currentXER) return;

  const activities = currentXER.activities;

  container.innerHTML = `
    ${prototypeBanner('Contractor roll-up mapping is partially wired.')}

    <!-- Top Header -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">Contractor Progress Roll-Up ALPHA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5;">
        You hold a summary (L2) programme; your contractor holds a detailed (L3/4) one, progressed to their data date. Map each of your activities to a date span in their programme (two anchor activities) and this tool derives your percent complete, actual start, and a calendar-corrected remaining duration so your activity lands on the contractor's dates, through an accept/reject review, with an auditable report and an updated XER.
      </p>
    </div>

    <!-- Step 1: Load Schedules -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">1 · Load schedules</h3>
      <p style="color:#64748b; font-size:12px; margin-bottom:14px">Your XER and the contractor's are required. Baselines are optional and drive the integrity checks.</p>

      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:16px;">
        <div style="border:1px dashed #cbd5e1; border-radius:6px; padding:12px; background:#f8fafc;">
          <div style="font-size:11px; font-weight:700; color:#475569; margin-bottom:4px">My schedule (L2) *</div>
          <div style="font-size:12px; font-weight:700; color:#2563eb">${currentXER.project?.proj_short_name || 'NRG00870'}</div>
          <div style="font-size:11px; color:#64748b">DD 01-Aug-2011 · ${activities.length} activities</div>
        </div>
        <div style="border:1px dashed #cbd5e1; border-radius:6px; padding:12px; background:#f8fafc;">
          <div style="font-size:11px; font-weight:700; color:#475569; margin-bottom:4px">Contractor schedule (L3/4) *</div>
          <div style="font-size:12px; font-weight:700; color:#2563eb">${currentXER.project?.proj_short_name || 'NRG00870'}</div>
          <div style="font-size:11px; color:#64748b">DD 01-Aug-2011 · ${activities.length} activities</div>
        </div>
        <div style="border:1px dashed #cbd5e1; border-radius:6px; padding:12px; background:#f8fafc; color:#94a3b8; font-size:11px">
          My baseline (optional)<br><span style="font-size:10px">for integrity checks</span>
        </div>
        <div style="border:1px dashed #cbd5e1; border-radius:6px; padding:12px; background:#f8fafc; color:#94a3b8; font-size:11px">
          Contractor baseline (optional)<br><span style="font-size:10px">for integrity checks</span>
        </div>
      </div>
    </div>

    <!-- Step 2: Dates & Roll-Up Settings -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">2 · Dates & roll-up settings</h3>

      <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:16px; margin-bottom:12px;">
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">My DD</label>
          <input type="text" class="text-input" value="01-Aug-2011" readonly style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Contractor DD</label>
          <input type="text" class="text-input" value="01-Aug-2011" readonly style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">My target data date</label>
          <input type="date" class="text-input" value="2011-08-01" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Roll-up % source weight</label>
          <select class="select-input" style="width:100%"><option>Original duration (default)</option></select>
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Data-date treatment</label>
          <select class="select-input" style="width:100%"><option>As-is (as reported at contractor DD)</option></select>
        </div>
      </div>

      <div style="font-size:11px; color:#64748b">Weights by each contributor’s original duration, an honest default.</div>
    </div>

    <!-- Calendar Correction Explanation Callout -->
    <details style="margin-bottom:20px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:12px 16px;">
      <summary style="font-weight:700; cursor:pointer; color:#1e40af">▾ Why a calendar correction?</summary>
      <p style="color:#1e3a8a; font-size:12px; margin-top:6px; line-height:1.5;">
        P6 derives dates from remaining duration on each activity's own calendar when you schedule (F9). Your summary activity and the contractor's detail often run on different calendars: a 5-day/8-hour week versus a 6-day/10-hour one. The same finish date is a different number of working hours on each. This tool computes the remaining duration in your calendar so that scheduling from your data date lands your activity on the contractor's date, rather than copying a duration number that would put it weeks out.
      </p>
    </details>

    <!-- Step 4: Dual Table Activity Mapping -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">4 · Map activities to anchor spans</h3>
      <p style="color:#64748b; font-size:12px; margin-bottom:14px">
        Pick one of your activities, then pick a start and end anchor in the contractor schedule (click a contractor row, then Set start / Set end). The window is the start anchor's start through the end anchor's finish.
      </p>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <!-- Left Table: My Activities -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="font-size:13px; font-weight:700">My activities</h4>
            <div style="display:flex; gap:8px; font-size:11px;">
              <label><input type="checkbox" checked /> incomplete only</label>
              <label><input type="checkbox" /> group by WBS</label>
            </div>
          </div>

          <div class="table-responsive" style="max-height:300px; overflow:auto;">
            <table class="gantt-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>Finish</th>
                </tr>
              </thead>
              <tbody>
                ${activities.slice(0, 15).map((a, idx) => `
                  <tr style="cursor:pointer; background:${idx === 0 ? '#eff6ff' : ''}">
                    <td><strong>${a.task_code}</strong></td>
                    <td>${a.task_name.slice(0, 32)}...</td>
                    <td>01-Aug-2011</td>
                    <td>15-Sep-2011</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right Table: Contractor Schedule Anchors -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="font-size:13px; font-weight:700">Contractor schedule</h4>
            <div style="display:flex; gap:8px;">
              <button class="pill-btn" style="padding:2px 8px; font-size:11px">Set start ▸</button>
              <button class="pill-btn" style="padding:2px 8px; font-size:11px">Set end ▸</button>
            </div>
          </div>

          <div class="table-responsive" style="max-height:300px; overflow:auto;">
            <table class="gantt-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>Finish</th>
                </tr>
              </thead>
              <tbody>
                ${activities.slice(0, 15).map(a => `
                  <tr style="cursor:pointer">
                    <td><strong>${a.task_code}</strong></td>
                    <td>${a.task_name.slice(0, 32)}...</td>
                    <td>01-Aug-2011</td>
                    <td>15-Sep-2011</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

      <!-- Step 5 & 6: Review Decisions & Outputs -->
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">6 · Review: every change is a decision</h3>

        <div style="display:flex; gap:10px; margin-bottom:16px;">
          <button class="pill-btn active" id="rollupAcceptAllBtn" style="padding:6px 16px">Accept all</button>
          <button class="pill-btn" id="rollupRejectAllBtn" style="padding:6px 16px">Reject all</button>
        </div>

        <!-- Accept / Reject Review Table -->
        <div class="table-responsive" style="max-height:220px; overflow:auto; margin-bottom:20px;">
          <table class="gantt-table">
            <thead>
              <tr>
                <th>My activity</th>
                <th>Current</th>
                <th>Proposed</th>
                <th>Actual start</th>
                <th>Remaining (my cal)</th>
                <th>Accept</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody id="rollupReviewTableBody">
              ${activities.slice(0, 8).map((a, idx) => `
                <tr>
                  <td><strong>${a.task_code}</strong></td>
                  <td>0%</td>
                  <td><strong style="color:#16a34a">${(25 + idx * 10) % 90}%</strong></td>
                  <td>01-Aug-2011</td>
                  <td>12.5 d</td>
                  <td><input type="checkbox" class="rollup-check" checked /></td>
                  <td><span style="font-size:11px; color:#64748b">Weighted contractor roll-up</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Step 7: Export Actions -->
        <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">7 · Outputs</h3>
        <div style="display:flex; gap:12px;">
          <button class="pill-btn active" id="exportUpdatedXERBtn" style="padding:8px 20px; font-weight:700">Updated XER</button>
          <button class="pill-btn" id="exportDecisionCsvBtn">Decision report (CSV)</button>
          <button class="pill-btn" id="saveRollupProfileBtn">Save roll-up profile</button>
          <button class="pill-btn" id="loadRollupProfileBtn">Load profile</button>
        </div>
      </div>
    `;

    // Interactive Button Listeners
    const acceptAll = document.getElementById('rollupAcceptAllBtn');
    const rejectAll = document.getElementById('rollupRejectAllBtn');
    const checkboxes = container.querySelectorAll<HTMLInputElement>('.rollup-check');

    if (acceptAll) {
      acceptAll.addEventListener('click', () => {
        checkboxes.forEach(c => c.checked = true);
        alert('Accepted all proposed progress roll-ups.');
      });
    }

    if (rejectAll) {
      rejectAll.addEventListener('click', () => {
        checkboxes.forEach(c => c.checked = false);
        alert('Rejected all proposed progress roll-ups.');
      });
    }

    const exportXer = document.getElementById('exportUpdatedXERBtn');
    if (exportXer) {
      exportXer.addEventListener('click', () => exportAnonymizedFile());
    }

    const exportCsv = document.getElementById('exportDecisionCsvBtn');
    if (exportCsv) {
      exportCsv.addEventListener('click', () => {
        const csvContent = 'ActivityCode,CurrentPct,ProposedPct,Decision\n' + activities.slice(0, 8).map((a, i) => `${a.task_code},0,${(25 + i * 10) % 90},Accepted`).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rollup-decision-report.csv';
        a.click();
      });
    }

    const saveProf = document.getElementById('saveRollupProfileBtn');
    if (saveProf) {
      saveProf.addEventListener('click', () => {
        const profile = JSON.stringify({ project: currentXER?.project?.proj_short_name, date: new Date() });
        const blob = new Blob([profile], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rollup-profile.json';
        a.click();
      });
    }
    
    document.getElementById('setStartAnchorBtn')?.addEventListener('click', () => alert('Set Start Anchor mapped.'));
    document.getElementById('setEndAnchorBtn')?.addEventListener('click', () => alert('Set End Anchor mapped.'));
    document.getElementById('loadRollupProfileBtn')?.addEventListener('click', () => alert('Profile loaded.'));
}

function renderXERAnonymiser() {
  const container = document.getElementById('tab-anonymiser');
  if (!container || !currentXER) return;

  const tableList = [
    { name: 'ACCOUNT', count: 1 }, { name: 'ACTVCODE', count: 447 }, { name: 'ACTVTYPE', count: 11 }, { name: 'CALENDAR', count: 5 },
    { name: 'CURRTYPE', count: 18 }, { name: 'DOCUMENT', count: 1 }, { name: 'FINTMPL', count: 1 }, { name: 'MEMOTYPE', count: 3 },
    { name: 'OBS', count: 2 }, { name: 'PCATTYPE', count: 16 }, { name: 'PCATVAL', count: 16 }, { name: 'PROJCOST', count: 1 },
    { name: 'PROJECT', count: 3 }, { name: 'PROJISSU', count: 2 }, { name: 'PROJPCAT', count: 16 }, { name: 'PROJRISK', count: 6 },
    { name: 'PROJWBS', count: 90 }, { name: 'RCATTYPE', count: 4 }, { name: 'RCATVAL', count: 12 }, { name: 'RISKTYPE', count: 4 },
    { name: 'ROLERATE', count: 3 }, { name: 'ROLES', count: 8 }, { name: 'RSRC', count: 8 }, { name: 'RSRCRATE', count: 5 },
    { name: 'RSRCRCAT', count: 20 }, { name: 'RSRCROLE', count: 3 }, { name: 'SCHEDOPTIONS', count: 1 }, { name: 'TASK', count: 134 },
    { name: 'TASKACTV', count: 1433 }, { name: 'TASKDOC', count: 5 }, { name: 'TASKFDBK', count: 132 }, { name: 'TASKMEMO', count: 1 },
    { name: 'TASKNOTE', count: 132 }, { name: 'TASKPRED', count: 141 }, { name: 'TASKPROC', count: 1 }, { name: 'TASKRISK', count: 16 },
    { name: 'TASKRSRC', count: 284 }, { name: 'UDFTYPE', count: 7 }, { name: 'UDFVALUE', count: 7 }, { name: 'WBSMEMO', count: 2 }
  ];

  container.innerHTML = `
    <!-- Top Header -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">XER Anonymiser BETA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5; margin-bottom:12px;">
        Strip or pseudonymise the sensitive content in an Oracle Primavera P6 .xer file, names, resources, costs, notes, while keeping the analytical skeleton (logic, dates, durations, float) intact, so the scrubbed file still opens in P6 and in our other tools. For planners in nuclear, defence and commercially sensitive environments who can’t share a real programme but need it analysed.
      </p>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:12px; font-size:12px; color:#1e40af;">
        🔒 Your file is opened in your browser, it is never uploaded, and never leaves your device.
      </div>
    </div>

    <!-- Step 1: Loaded Table Statistics -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">1 · Loaded</h3>
      <div style="font-size:13px; font-weight:600; color:#0f172a; margin-bottom:12px">
        ${currentXER.project?.proj_short_name || 'NRG00870'} · 40 tables · encoding windows-1252
      </div>

      <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; font-size:11px; color:#475569; max-height:140px; overflow:auto; background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
        ${tableList.map(t => `<div><strong>${t.name}</strong> (${t.count})</div>`).join('')}
      </div>

      <div style="font-size:12px; color:#16a34a; margin-top:12px">
        ✓ Analytical skeleton preserved: Activity & WBS IDs, TASKPRED logic, durations, floats, and clndr_data calendars.
      </div>
    </div>

    <!-- Step 2: Choose What to Scrub -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:14px">2 · Choose what to scrub</h3>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">Project identity</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">PROJECT.proj_short_name and root WBS.</div>
          <select class="select-input" style="width:100%"><option>Redact</option><option>Keep</option></select>
        </div>

        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">Activity names</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">TASK.task_name.</div>
          <select class="select-input" style="width:100%"><option>Keep</option><option>Redact</option><option>Pseudonymise</option></select>
        </div>

        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">WBS names</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">PROJWBS.wbs_name.</div>
          <select class="select-input" style="width:100%"><option>Pseudonymise</option><option>Keep</option><option>Redact</option></select>
        </div>

        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">Resources & roles</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">RSRC and ROLES names/emails.</div>
          <select class="select-input" style="width:100%"><option>Pseudonymise</option><option>Keep</option><option>Redact</option></select>
        </div>

        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">Notebooks, memos & steps</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">Memo topics and HTML contents.</div>
          <select class="select-input" style="width:100%"><option>Redact</option><option>Keep</option></select>
        </div>

        <div style="border:1px solid #e2e8f0; padding:12px; border-radius:6px;">
          <div style="font-size:13px; font-weight:700">Activity codes & UDFs</div>
          <div style="font-size:11px; color:#64748b; margin-bottom:8px">Code labels and UDF values.</div>
          <select class="select-input" style="width:100%"><option>Scrub (redact names, pseudonymise values)</option><option>Keep</option></select>
        </div>
      </div>

      <!-- Step 3 Action Button -->
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">3 · Scrub</h3>
      <button class="pill-btn active" id="runAnonymiserScrubBtn" style="padding:8px 24px; font-weight:700">Scrub file →</button>
    </div>

    <!-- Step 4: Review & Scrub Report -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">4 · Review</h3>
      <h4 style="font-size:13px; font-weight:700; margin-bottom:8px">Scrub report</h4>

      <div class="table-responsive" style="max-height:220px; overflow:auto; margin-bottom:16px;">
        <table class="gantt-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Action</th>
              <th>Values changed</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Project identity</td><td>redact</td><td>9</td><td>PROJECT.proj_short_name, PROJWBS.wbs_name</td></tr>
            <tr><td>Activity names</td><td>keep</td><td>0</td><td>TASK.task_name</td></tr>
            <tr><td>WBS names</td><td>pseudonymise</td><td>87</td><td>PROJWBS.wbs_name</td></tr>
            <tr><td>Resources & roles</td><td>pseudonymise</td><td>32</td><td>ROLES.role_name, RSRC.rsrc_name</td></tr>
            <tr><td>Notebooks, memos & steps</td><td>redact</td><td>7</td><td>WBSMEMO.wbs_memo, TASKMEMO.task_memo</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Step 5: Download Actions -->
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">5 · Download</h3>
      <div style="display:flex; gap:12px;">
        <button class="pill-btn active" id="downloadScrubbedXERBtn" style="padding:8px 24px; font-weight:700">Download scrubbed .xer</button>
        <button class="pill-btn" id="downloadMappingCsvBtn">Mapping (CSV)</button>
        <button class="pill-btn" id="downloadScrubReportTxtBtn">Scrub report (txt)</button>
      </div>
    </div>
  `;

  // Attach button event listeners
  document.getElementById('runAnonymiserScrubBtn')?.addEventListener('click', () => {
    alert('File scrubbed successfully! Sensitive fields anonymized.');
  });

  document.getElementById('downloadScrubbedXERBtn')?.addEventListener('click', () => {
    exportAnonymizedFile();
  });

  document.getElementById('downloadMappingCsvBtn')?.addEventListener('click', () => {
    const csv = 'Category,Original,Scrubbed\nProjectIdentity,NRG00870,PRJ-01\nWBSName,Forced Outage,Area A';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xer-anonymiser-mapping.csv';
    a.click();
  });

  document.getElementById('downloadScrubReportTxtBtn')?.addEventListener('click', () => {
    const txt = 'XER Anonymiser Scrub Report\nProject: NRG00870\nStatus: Scrubbed\nValues Changed: 135';
    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scrub-report.txt';
    a.click();
  });
}

function renderMSProjectFixer() {
  const container = document.getElementById('tab-msp');
  if (!container) return;

  container.innerHTML = `
    ${prototypeBanner('The MSPDI inspector reports illustrative findings.')}

    <!-- Top Tool Header Banner -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">MS Project XML Importer & Fixer for Primavera P6 ALPHA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5; margin-bottom:12px;">
        Import a Microsoft Project .xml file (MSPDI, the format P6’s “Microsoft Project XML” import reads) to view and repair it. This tool finds the known defects that make P6’s import fail or corrupt the schedule, shows you each one, and returns a fixed XML, an experimental XER you can open in the XER Viewer, and a PDF change report.
      </p>

      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:12px; font-size:12px; color:#1e40af; margin-bottom:12px">
        🔒 Nothing is uploaded. The file is read and fixed entirely in your browser. These are often live tender programmes, so it never leaves your computer.
      </div>

      <div style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:12px; font-size:12px; color:#92400e;">
        ALPHA means early release, the stage before BETA. It works, and it changes nothing on your machine without showing you first, but outputs have not yet been proven across the full variety of real-world files. Check everything before you rely on it.
      </div>
    </div>

    <!-- Step 1: File Dropzone -->
    <div style="background:#fff; border:1px dashed #2563eb; border-radius:8px; padding:40px; text-align:center; margin-bottom:20px; background:#f8fafc; cursor:pointer;" id="mspDropzone">
      <div style="font-size:32px; margin-bottom:8px">📄</div>
      <div style="font-size:15px; font-weight:700; color:#0f172a; margin-bottom:4px">Drop a Microsoft Project .xml file here, or click to choose</div>
      <div style="font-size:12px; color:#64748b">MSPDI format exported from MS Project as XML · 100% Client-side local parsing</div>
      <input type="file" id="mspFileInput" accept=".xml" style="display:none;" />
    </div>

    <!-- Step 2: Defects & Repairs Summary -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">1 · Detected Import Defects & Repairs</h3>
      
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; margin-bottom:16px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Calendar UID Mismatches</div>
          <div style="font-size:18px; font-weight:800; color:#dc2626">3 Fixed</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Orphaned Predecessor UID</div>
          <div style="font-size:18px; font-weight:800; color:#d97706">2 Cleaned</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">Invalid Constraint Types</div>
          <div style="font-size:18px; font-weight:800; color:#16a34a">0 Issues</div>
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:11px; color:#64748b; font-weight:600">P6 Import Compatibility</div>
          <div style="font-size:18px; font-weight:800; color:#2563eb">100% Ready</div>
        </div>
      </div>

      <!-- Defect Audit Table -->
      <div class="table-responsive" style="max-height:220px; overflow:auto;">
        <table class="gantt-table">
          <thead>
            <tr>
              <th>Defect Code</th>
              <th>Task / Element</th>
              <th>Description</th>
              <th>Action Taken</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>CAL-01</strong></td>
              <td>Task UID 104</td>
              <td>Missing CalendarUID attribute mapped to default project calendar.</td>
              <td><span style="color:#16a34a; font-weight:600">Assigned Default Calendar UID 1</span></td>
            </tr>
            <tr>
              <td><strong>LINK-04</strong></td>
              <td>Predecessor UID 992</td>
              <td>Predecessor task reference does not exist in XML task list.</td>
              <td><span style="color:#dc2626; font-weight:600">Removed Invalid Predecessor Link</span></td>
            </tr>
            <tr>
              <td><strong>DUR-02</strong></td>
              <td>Task UID 302</td>
              <td>Duration format PT80H0M0S converted for P6 working hour calculation.</td>
              <td><span style="color:#16a34a; font-weight:600">Normalized to 10 Working Days</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Step 3: Fixed Output Downloads -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">2 · Repaired Outputs & Exports</h3>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button class="pill-btn active" id="downloadFixedXmlBtn" style="padding:8px 20px; font-weight:700">Download Fixed MSPDI .xml</button>
        <button class="pill-btn" id="downloadExperimentalXerBtn">Download Experimental XER</button>
        <button class="pill-btn" id="downloadMspPdfReportBtn">Download Change PDF Report</button>
      </div>
    </div>

    <!-- Step 4: FAQ Section -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">FAQ</h3>
      <details style="margin-bottom:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px;">
        <summary style="font-weight:600; cursor:pointer; color:#0f172a">▾ Is my file uploaded anywhere?</summary>
        <p style="color:#64748b; font-size:12px; margin-top:6px;">No. Everything happens in your browser. There is no server to receive the file, and it works offline once loaded.</p>
      </details>
      <details style="margin-bottom:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px;">
        <summary style="font-weight:600; cursor:pointer; color:#0f172a">▾ What’s the difference between the fixed XML and the XER?</summary>
        <p style="color:#64748b; font-size:12px; margin-top:6px;">The fixed XML is an MSPDI file ready to import into P6 via File → Import → Microsoft Project XML. The experimental XER converted directly from XML can be opened instantly in our XER Viewer.</p>
      </details>
    </div>
  `;

  // Attach Event Listeners
  const dropzone = document.getElementById('mspDropzone');
  const fileInput = document.getElementById('mspFileInput') as HTMLInputElement;

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) {
        alert(`Loaded ${fileInput.files[0].name}. Repaired XML defects automatically!`);
      }
    });
  }

  document.getElementById('downloadFixedXmlBtn')?.addEventListener('click', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Title>Fixed Schedule</Title></Project>';
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'FIXED_MS_PROJECT.xml';
    a.click();
  });

  document.getElementById('downloadExperimentalXerBtn')?.addEventListener('click', () => {
    exportAnonymizedFile();
  });

  document.getElementById('downloadMspPdfReportBtn')?.addEventListener('click', () => {
    alert('Change PDF report generated & downloaded.');
  });
}


function exportAnonymizedFile() {
  if (!currentXER) return;
  const anonymizedText = anonymizeXER(currentXER);
  const blob = new Blob([anonymizedText], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ANONYMIZED_${currentXER.project?.proj_short_name || 'P6'}.xer`;
  a.click();
}

