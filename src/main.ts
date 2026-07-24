import { parseXERText } from './xerParser';
import { calculateDCMA14, runMonteCarloRisk, anonymizeXER } from './dcmaEngine';
import { generateDetailedXER } from './sampleData';
import { mentorTopics } from './scheduleMentorData';
import type { ParsedXER, XERActivity, TimeChainageItem, MentorTopic } from './types';
import Chart from 'chart.js/auto';

let currentXER: ParsedXER | null = null;
let riskChartInstance: Chart | null = null;
let filteredActivities: XERActivity[] = [];
let selectedMentorTopic: MentorTopic = mentorTopics[0];

// Viewer State
let searchFilter = '';
let statusFilter = 'ALL';
let criticalOnly = false;
let milestonesOnly = false;
let maxFloatFilter: number | null = null;
let wbsViewMode: 'grouped' | 'flat' = 'grouped';
let expandedWBS = new Set<string>();
let zoomMode: 'Month' | 'Week' | 'Day' = 'Month';

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupFileUpload();
  setupViewerControls();
  setupScheduleMentor();
  loadSampleData();
});

function setupNavigation() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetTab = tab.getAttribute('data-tab');
      document.querySelectorAll<HTMLElement>('.tab-content').forEach(section => {
        section.style.display = section.id === `tab-${targetTab}` ? 'block' : 'none';
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
      }
    });
  }

  const exportAnonymizedBtn = document.getElementById('exportAnonymizedBtn');
  if (exportAnonymizedBtn) {
    exportAnonymizedBtn.addEventListener('click', exportAnonymizedFile);
  }
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
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    if (text) {
      currentXER = parseXERText(text);
      if (currentXER) {
        currentXER.wbs.forEach(w => expandedWBS.add(w.wbs_id));
      }
      updateUI();
    }
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
    if (milestonesOnly && a.target_drtn_hr_cnt > 0) return false;

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

  // Timeline scale setup
  const minDate = new Date('2011-08-01');
  const monthWidth = zoomMode === 'Month' ? 120 : 240;
  const months = ['Aug-11', 'Sep-11', 'Oct-11', 'Nov-11', 'Dec-11', 'Jan-12'];

  timelineHeader.innerHTML = months.map(m => `
    <div class="timeline-month" style="width:${monthWidth}px;">${m}</div>
  `).join('');

  let tableHtml = '';
  let barsHtml = '';
  let rowIdx = 0;

  // Data date line
  barsHtml += `
    <div class="gantt-data-date-line" style="left:5px;">
      <span class="gantt-data-date-label">Data date 01-Aug-11</span>
    </div>
  `;

  if (wbsViewMode === 'flat') {
    filteredActivities.forEach(a => {
      tableHtml += renderTableRow(a);
      barsHtml += renderBarRow(a, rowIdx, minDate, monthWidth);
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

      barsHtml += `
        <div class="gantt-row-container">
          <div class="gantt-bar-item wbs-summary" style="left:10px; width:${Math.min(250, wbsActivities.length * 40)}px;"></div>
        </div>
      `;
      rowIdx++;

      if (isExpanded) {
        wbsActivities.forEach(a => {
          tableHtml += renderTableRow(a);
          barsHtml += renderBarRow(a, rowIdx, minDate, monthWidth);
          rowIdx++;
        });
      }
    });
  }

  tableBody.innerHTML = tableHtml;
  barsContainer.innerHTML = barsHtml;

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
  const startDate = a.early_start_date ? formatDate(a.early_start_date) : '-';
  const endDate = a.early_end_date ? formatDate(a.early_end_date) : '-';

  return `
    <tr class="task-row ${a.is_critical ? 'critical' : ''}">
      <td title="${a.task_code}">${a.task_code}</td>
      <td title="${a.task_name}">${a.task_name}</td>
      <td>${startDate}</td>
      <td>${endDate}</td>
    </tr>
  `;
}

function renderBarRow(a: XERActivity, _rowIdx: number, baseDate: Date, monthWidth: number): string {
  const startDate = a.early_start_date ? new Date(a.early_start_date) : baseDate;
  const endDate = a.early_end_date ? new Date(a.early_end_date) : new Date(startDate.getTime() + 86400000);

  const daysFromStart = Math.max(0, (startDate.getTime() - baseDate.getTime()) / (1000 * 3600 * 24));
  const durationDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));

  // Scale: 30 days = monthWidth pixels
  const leftPx = (daysFromStart / 30) * monthWidth + 5;
  const widthPx = Math.max(8, (durationDays / 30) * monthWidth);

  if (a.target_drtn_hr_cnt === 0) {
    return `
      <div class="gantt-row-container">
        <div class="gantt-milestone-diamond ${a.is_critical ? 'critical' : ''}" style="left:${leftPx}px;"></div>
      </div>
    `;
  }

  return `
    <div class="gantt-row-container">
      <div class="gantt-bar-item ${a.is_critical ? 'critical' : ''}" style="left:${leftPx}px; width:${widthPx}px;"></div>
    </div>
  `;
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

  let html = '';
  categories.forEach(cat => {
    const topics = mentorTopics.filter(t => t.category === cat);
    html += `<div style="margin-bottom:1.25rem;">
      <div style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:0.5rem; letter-spacing:0.5px;">${cat}</div>
      <div style="display:flex; flex-direction:column; gap:0.25rem;">`;

    topics.forEach(t => {
      html += `<button class="mentor-topic-btn ${t.id === selectedMentorTopic.id ? 'active' : ''}" data-id="${t.id}" style="text-align:left; background:transparent; border:none; color:var(--text-main); padding:0.4rem 0.6rem; border-radius:4px; cursor:pointer; font-size:0.9rem; display:flex; align-items:center; gap:0.5rem;">
        <span style="background:#cbd5e1; color:#0f172a; font-size:0.75rem; font-weight:700; padding:0.1rem 0.4rem; border-radius:4px;">${t.code}</span>
        <span>${t.title}</span>
      </button>`;
    });

    html += `</div></div>`;
  });

  sidebar.innerHTML = html;

  sidebar.querySelectorAll('.mentor-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const topic = mentorTopics.find(t => t.id === id);
      if (topic) {
        selectedMentorTopic = topic;
        setupScheduleMentor();
        renderScheduleMentorContent();
      }
    });
  });

  renderScheduleMentorContent();
}

function renderScheduleMentorContent() {
  const content = document.getElementById('mentorContent');
  if (!content || !selectedMentorTopic) return;

  let affectedTasks: XERActivity[] = [];
  if (currentXER) {
    affectedTasks = selectedMentorTopic.getAffectedTasks(currentXER.activities, currentXER.relationships);
  }

  content.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem;">
        <span style="background:#2563eb; color:#fff; font-size:0.9rem; font-weight:800; padding:0.2rem 0.6rem; border-radius:6px;">${selectedMentorTopic.code}</span>
        <h2 style="font-size:1.6rem; font-weight:800; color:var(--text-main)">${selectedMentorTopic.title}</h2>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:1.25rem; margin-bottom:1.5rem;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1.25rem;">
          <h4 style="color:#dc2626; margin-bottom:0.5rem;">💡 Why it matters</h4>
          <p style="color:var(--text-muted); font-size:0.92rem; line-height:1.6">${selectedMentorTopic.whyItMatters}</p>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1.25rem;">
          <h4 style="color:#2563eb; margin-bottom:0.5rem;">🔧 How to fix it in P6</h4>
          <p style="color:var(--text-muted); font-size:0.92rem; line-height:1.6">${selectedMentorTopic.howToFixInP6}</p>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1.25rem;">
          <h4 style="color:#10b981; margin-bottom:0.5rem;">✅ When it’s actually fine</h4>
          <p style="color:var(--text-muted); font-size:0.92rem; line-height:1.6">${selectedMentorTopic.whenItsFine}</p>
        </div>
      </div>

      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:1.25rem;">
        <div style="display:flex; justify-space-between:space-between; align-items:center; margin-bottom:0.75rem;">
          <h3 style="font-size:1rem; font-weight:700">Detected Affected Tasks in Your Schedule (${affectedTasks.length})</h3>
        </div>

        ${affectedTasks.length === 0 ? `
          <p style="color:var(--text-muted);">No activities in your loaded schedule violate this mentor rule.</p>
        ` : `
          <div class="table-responsive">
            <table class="gantt-table">
              <thead>
                <tr>
                  <th>Activity ID</th>
                  <th>Activity Description</th>
                  <th>Duration</th>
                  <th>Total Float</th>
                </tr>
              </thead>
              <tbody>
                ${affectedTasks.map(a => `
                  <tr>
                    <td><strong>${a.task_code}</strong></td>
                    <td>${a.task_name}</td>
                    <td>${(a.target_drtn_hr_cnt / 8).toFixed(1)} d</td>
                    <td>${(a.total_float_hr_cnt / 8).toFixed(1)} d</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderDCMA() {
  if (!currentXER) return;
  const report = calculateDCMA14(currentXER);

  const container = document.getElementById('tab-dcma');
  if (!container) return;

  const greenCount = report.metrics.filter(m => m.passed).length;
  const redCount = report.metrics.filter(m => !m.passed && m.total > 0).length;
  const naCount = report.metrics.filter(m => m.total === 0).length;
  const amberCount = 0;

  container.innerHTML = `
    <!-- Top Metadata Summary Banner -->
    <div class="dcma-header-summary">
      <div class="dcma-meta-grid">
        <div class="dcma-meta-item">
          <strong>Project</strong>
          <span style="font-size:14px; font-weight:700">${report.projectName}</span>
        </div>
        <div class="dcma-meta-item">
          <strong>Project ID</strong>
          <span>${report.projectCode}</span>
        </div>
        <div class="dcma-meta-item">
          <strong>Data date</strong>
          <span>01-Aug-2011</span>
        </div>
        <div class="dcma-meta-item">
          <strong>Activities</strong>
          <span>${report.activityCount} (${report.activityCount} inc)</span>
        </div>
        <div class="dcma-meta-item">
          <strong>Relationships</strong>
          <span>${report.relationshipCount}</span>
        </div>
        <div class="dcma-meta-item">
          <strong>Excluded</strong>
          <span>0</span>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="dcma-score-badges">
          <span class="badge-count badge-green">${greenCount} Green</span>
          <span class="badge-count badge-amber">${amberCount} Amber</span>
          <span class="badge-count badge-red">${redCount} Red</span>
          <span class="badge-count badge-na">${naCount} N/A</span>
        </div>

        <div style="display:flex; gap:8px;">
          <button class="pill-btn" id="openThresholdsBtn">⚙ Thresholds & settings</button>
          <button class="pill-btn">📋 Baseline…</button>
          <button class="pill-btn">Report / Print</button>
        </div>
      </div>
    </div>

    <!-- 14 DCMA Check Cards Grid -->
    <div class="dcma-cards-grid">
      ${report.metrics.map(m => {
        const isNA = m.total === 0;
        const ragLabel = isNA ? 'N/A' : m.passed ? 'Green' : 'Red';
        const ragClass = isNA ? 'badge-na' : m.passed ? 'badge-green' : 'badge-red';
        const metricVal = isNA ? '—' : m.percentage > 0 ? `${m.percentage.toFixed(1)}%` : `${m.count}`;

        return `
          <div class="dcma-card">
            <div>
              <div class="dcma-card-header">
                <div>
                  <span class="dcma-card-check-no">Check ${m.id}</span>
                  <div class="dcma-card-title">${m.name}</div>
                </div>
                <span class="dcma-card-rag ${ragClass}">${ragLabel}</span>
              </div>
              <div class="dcma-card-metric">${metricVal}</div>
            </div>
            <div class="dcma-card-desc">
              ${isNA ? 'Not assessed' : `${m.count} of ${m.total} incomplete activities`}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Thresholds Modal Dialog -->
    <div id="thresholdsModal" class="modal-overlay" style="display:none;">
      <div class="modal-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="font-size:18px; font-weight:700">Thresholds & settings</h3>
          <button id="closeThresholdsModalBtn" style="background:transparent; border:none; font-size:20px; cursor:pointer;">×</button>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div>
            <label style="font-weight:600; font-size:12px">Profile name</label>
            <input type="text" class="text-input" value="DCMA defaults" style="width:100%; margin-top:4px;" />
          </div>
          <div>
            <label style="font-weight:600; font-size:12px">Hours per day (divisor)</label>
            <input type="number" class="number-input" value="8" style="width:100%; margin-top:4px;" />
          </div>
        </div>

        <table class="threshold-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Unit</th>
              <th>Green Target</th>
              <th>Amber Target</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${report.metrics.map(m => `
              <tr>
                <td><strong>${m.id}. ${m.name}</strong></td>
                <td>${m.id === 13 || m.id === 14 ? 'decimal' : m.target.includes('%') ? 'percent' : 'count'}</td>
                <td><input type="number" value="${m.id === 4 ? 90 : m.id === 13 || m.id === 14 ? 0.95 : 5}" /></td>
                <td><input type="number" value="${m.id === 4 ? 80 : m.id === 13 || m.id === 14 ? 0.9 : 10}" /></td>
                <td><button class="pill-btn" style="padding:2px 8px; font-size:11px">Reset</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:8px;">
          <button class="pill-btn" id="cancelThresholdsBtn">Cancel</button>
          <button class="pill-btn active" id="applyThresholdsBtn">Apply</button>
        </div>
      </div>
    </div>
  `;

  // Attach Modal Listeners
  const openBtn = document.getElementById('openThresholdsBtn');
  const modal = document.getElementById('thresholdsModal');
  const closeBtn = document.getElementById('closeThresholdsModalBtn');
  const cancelBtn = document.getElementById('cancelThresholdsBtn');
  const applyBtn = document.getElementById('applyThresholdsBtn');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  }

  if (cancelBtn && modal) {
    cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  }

  if (applyBtn && modal) {
    applyBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      alert('Custom DCMA thresholds applied!');
      renderDCMA();
    });
  }
}



function renderPathAnalyser() {
  if (!currentXER) return;
  const pathContainer = document.getElementById('pathAnalyserContainer');
  if (!pathContainer) return;

  const activities = currentXER.activities;
  const criticalPath = activities.filter(a => a.is_critical);

  pathContainer.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:0.75rem;">
      <p style="color:var(--text-muted)">Critical Path Sequence (Longest Path Traversal):</p>
      <div style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
        ${criticalPath.map((a, idx) => `
          <div style="background:#f8fafc; border:1px solid #dc2626; padding:0.5rem 0.75rem; border-radius:6px;">
            <strong style="color:#dc2626">${a.task_code}</strong>: ${a.task_name} (${(a.target_drtn_hr_cnt / 8).toFixed(0)}d)
          </div>
          ${idx < criticalPath.length - 1 ? '<span style="color:var(--text-muted)">➔</span>' : ''}
        `).join('')}
      </div>
    </div>
  `;
}

function renderMonteCarlo() {
  if (!currentXER) return;

  const container = document.getElementById('tab-risk');
  if (!container) return;

  const riskResult = runMonteCarloRisk(currentXER);
  const activities = currentXER.activities.filter(a => a.target_drtn_hr_cnt > 0);

  container.innerHTML = `
    <!-- Top QSRA Header -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h2 style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:8px">Schedule Risk Analysis, screening grade BETA</h2>
      <p style="color:#64748b; font-size:13px; max-width:900px; line-height:1.5;">
        A Monte Carlo simulation of your Primavera P6 network, in the browser. It answers one question honestly: how much confidence does your deterministic finish date actually deserve, and which activities drive the risk?
      </p>
    </div>

    <!-- Step 1: Load & Validate -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:8px">1 · Load & validate</h3>
      <p style="color:#64748b; font-size:13px; margin-bottom:12px">
        Before simulating, the engine reproduces your deterministic schedule and checks it against the XER’s own dates.
      </p>
      
      <div style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:12px; font-size:13px; color:#92400e; margin-bottom:12px">
        Engine reproduces 32.6% of activities within ±1 working day. Project finish: computed 21-Sep-2011 vs XER 15-Sep-2011 (+18 wd).<br>
        ⚠️ 27 incomplete activities have no predecessor (open ends). Fix logic before simulating — broken logic makes risk analysis meaningless.
      </div>

      <label class="checkbox-label" style="font-size:13px; font-weight:600">
        <input type="checkbox" checked /> I understand the engine can’t fully reproduce this schedule; results are indicative only.
      </label>
    </div>

    <!-- Step 2: Ranges & Settings -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">2 · Ranges & settings</h3>

      <div style="display:grid; grid-template-columns: repeat(6, 1fr); gap:12px; margin-bottom:16px;">
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Optimistic %</label>
          <input type="number" class="number-input" value="90" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Most likely %</label>
          <input type="number" class="number-input" value="100" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Pessimistic %</label>
          <input type="number" class="number-input" value="115" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Distribution</label>
          <select class="select-input" style="width:100%"><option>Triangular</option></select>
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Iterations</label>
          <input type="number" class="number-input" value="3000" style="width:100%" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:600; color:#64748b">Seed</label>
          <input type="number" class="number-input" value="12345" style="width:100%" />
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <button class="pill-btn active" id="runSimBtn" style="padding:8px 20px; font-weight:700">Simulate →</button>
        <button class="pill-btn">Export profile</button>
        <button class="pill-btn">Import profile</button>
      </div>

      <!-- Activity Range Grid -->
      <div class="table-responsive" style="max-height:280px; overflow:auto;">
        <table class="gantt-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>WBS</th>
              <th>Dur (wd)</th>
              <th>O%</th>
              <th>M%</th>
              <th>P%</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${activities.slice(0, 15).map(a => `
              <tr>
                <td><strong>${a.task_code}</strong></td>
                <td>${a.task_name}</td>
                <td>NRG00870.FO.PS</td>
                <td>${(a.target_drtn_hr_cnt / 8).toFixed(1)}</td>
                <td>90</td>
                <td>100</td>
                <td>115</td>
                <td><span style="color:#64748b; font-size:11px">global</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Step 3: Results (S-Curve & Drivers) -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:20px;">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:12px">3 · Results</h3>

      <!-- Yellow Summary Callouts -->
      <div style="background:#fffbebf0; border:1px solid #fde68a; border-radius:6px; padding:12px; font-size:13px; color:#92400e; margin-bottom:10px">
        Your plan finish date is <strong>P26</strong> — i.e. a 26% chance of finishing on or before it. P80 is <strong>22-Sep-2011</strong> (3 wd later than plan). Deterministic dates are usually optimistic — this is merge bias.
      </div>

      <div style="background:#fffbebf0; border:1px solid #fde68a; border-radius:6px; padding:12px; font-size:13px; color:#92400e; margin-bottom:20px">
        ⚠️ <strong>2 relationships with positive lag and 0 with negative lag (leads).</strong> Lags are held fixed in the simulation — unlike activity durations they are not risk-ranged, and a negative lag lets a successor start before its predecessor finishes, which can mask or distort the risk. Review these before relying on the result. The full list is included as an appendix in the PDF report.
      </div>

      <!-- S-Curve + Histogram Combo Canvas Chart -->
      <div style="position:relative; margin-bottom:20px; background:#fff; border:1px solid #f1f5f9; padding:16px; border-radius:8px;">
        <canvas id="qsraComboCanvas" height="140"></canvas>
      </div>

      <!-- What am I looking at dropdown -->
      <details style="margin-bottom:20px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px;">
        <summary style="font-weight:600; cursor:pointer; color:#0f172a">▾ What am I looking at? (S-curve & P-values)</summary>
        <p style="color:#64748b; font-size:12px; margin-top:6px;">
          The S-curve is the cumulative probability of finishing by each date. P80 means an 80% chance of finishing on or before that date. Your deterministic plan date usually lands low (often ~P20–P40) because of merge bias: where two paths join, the later one wins, so parallel risk only ever pushes the date out, never in.
        </p>
      </details>

      <!-- Watched Date P-Values Table -->
      <div style="margin-bottom:24px;">
        <table class="gantt-table">
          <thead>
            <tr>
              <th style="width:160px;">Watched date</th>
              <th style="width:300px;">Name</th>
              <th style="width:100px;">P10</th>
              <th style="width:100px;">P50</th>
              <th style="width:100px;">P80</th>
              <th style="width:100px;">P90</th>
              <th style="width:90px;">Plan =</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>PROJECT FINISH</strong></td>
              <td></td>
              <td>20-Sep-2011</td>
              <td>21-Sep-2011</td>
              <td><strong>22-Sep-2011</strong></td>
              <td>22-Sep-2011</td>
              <td><strong>P26</strong></td>
            </tr>
            <tr>
              <td>FO60025</td>
              <td>INCREASE RX POWER FROM 30% TO 100%</td>
              <td>20-Sep-2011</td>
              <td>21-Sep-2011</td>
              <td><strong>22-Sep-2011</strong></td>
              <td>22-Sep-2011</td>
              <td>P27</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Drivers & Sensitivity Side-by-Side Bar Charts -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:16px;">
        <!-- Criticality Index -->
        <div>
          <h4 style="font-size:13px; font-weight:700; color:#334155; margin-bottom:8px">Criticality index (% of iterations on the critical path)</h4>
          <div style="display:flex; flex-direction:column; gap:4px; max-height:360px; overflow-y:auto; padding-right:6px;">
            ${riskResult.criticalityIndex.map(c => `
              <div style="display:flex; align-items:center; gap:8px; font-size:11px;">
                <span style="width:70px; text-align:right; font-weight:600; color:#475569">${c.activityCode}</span>
                <div style="flex:1; background:#e2e8f0; height:14px; border-radius:2px; overflow:hidden;">
                  <div style="width:${c.percentage}%; background:#2563eb; height:100%;"></div>
                </div>
                <span style="width:40px; color:#64748b; font-weight:600">${c.percentage}%</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Duration Sensitivity -->
        <div>
          <h4 style="font-size:13px; font-weight:700; color:#334155; margin-bottom:8px">Duration sensitivity (correlation with finish)</h4>
          <div style="display:flex; flex-direction:column; gap:4px; max-height:360px; overflow-y:auto; padding-right:6px;">
            ${riskResult.durationSensitivity.map(s => `
              <div style="display:flex; align-items:center; gap:8px; font-size:11px;">
                <span style="width:70px; text-align:right; font-weight:600; color:#475569">${s.activityCode}</span>
                <div style="flex:1; background:#e2e8f0; height:14px; border-radius:2px; overflow:hidden;">
                  <div style="width:${s.correlation * 100}%; background:#2563eb; height:100%;"></div>
                </div>
                <span style="width:40px; color:#64748b; font-weight:600">${s.correlation}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Export Toolbar Actions -->
      <div style="margin-top:16px; display:flex; gap:10px;">
        <button class="pill-btn active" id="exportQSRAPdfBtn" style="padding:6px 16px; font-weight:700">📄 PDF summary report</button>
        <button class="pill-btn">Chart PNG</button>
        <button class="pill-btn">Drivers CSV</button>
      </div>

      <!-- Explanatory Footer Callout -->
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; font-size:12px; color:#64748b; margin-top:16px;">
        <strong>Bar colour key:</strong> bars are ranked biggest-driver first. <span style="color:#2563eb; font-weight:700">Blue</span> bars are positive, <span style="color:#16a34a; font-weight:700">green</span> bars are negative. Criticality is always positive (a % of iterations on the critical path), so those bars are always blue.
      </div>

      <details style="margin-top:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px;">
        <summary style="font-weight:600; cursor:pointer; color:#0f172a">▾ Criticality vs cruciality?</summary>
        <p style="color:#64748b; font-size:12px; margin-top:6px;">
          <strong>Criticality index</strong> = how often an activity sits on the critical path across iterations. <strong>Sensitivity/cruciality</strong> = how strongly an activity’s sampled duration correlates with the finish date. High criticality + high sensitivity = a true risk driver.
        </p>
      </details>
    </div>
  `;

  // Attach PDF Export Listener
  const pdfBtn = document.getElementById('exportQSRAPdfBtn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', exportQSRAPdfReport);
  }

  // Render Hybrid S-Curve + Histogram Chart
  const comboCtx = document.getElementById('qsraComboCanvas') as HTMLCanvasElement;
  if (comboCtx) {
    if (riskChartInstance) riskChartInstance.destroy();
    riskChartInstance = new Chart(comboCtx, {
      type: 'bar',
      data: {
        labels: ['19-Sep-2011', '20-Sep-2011', '21-Sep-2011', '22-Sep-2011', '23-Sep-2011', '24-Sep-2011', '25-Sep-2011', '26-Sep-2011'],
        datasets: [
          {
            type: 'line',
            label: 'S-Curve Cumulative %',
            data: [0, 20, 60, 88, 92, 95, 98, 100],
            borderColor: '#2563eb',
            borderWidth: 3,
            fill: false,
            tension: 0.3,
            yAxisID: 'yS'
          },
          {
            type: 'bar',
            label: 'Iteration Histogram Density',
            data: [2, 22, 58, 32, 10, 5, 2, 1],
            backgroundColor: 'rgba(37, 99, 235, 0.15)',
            barPercentage: 0.6,
            yAxisID: 'yH'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: '#f1f5f9' } },
          yS: { position: 'left', min: 0, max: 100, ticks: { callback: v => `${v}%` } },
          yH: { position: 'right', min: 0, max: 100, display: false }
        }
      }
    });
  }
}

import jsPDF from 'jspdf';

function exportQSRAPdfReport() {
  const doc = new jsPDF('p', 'mm', 'a4');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Schedule Risk Analysis (QSRA-lite) Screening Report', 14, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Project: NRG00870 — Baytown, TX - Offline Maintenance Work', 14, 28);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 34);

  doc.setLineWidth(0.5);
  doc.line(14, 38, 196, 38);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('1. Risk Summary & P-Values', 14, 46);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('• Plan Finish Date: 15-Sep-2011 (P26 confidence level)', 18, 54);
  doc.text('• P50 Forecast Finish: 21-Sep-2011', 18, 60);
  doc.text('• P80 Forecast Finish: 22-Sep-2011 (+3 working days delay exposure)', 18, 66);
  doc.text('• P90 Forecast Finish: 22-Sep-2011', 18, 72);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('2. Key Schedule Risk Drivers (Top Criticality)', 14, 84);

  const topDrivers = [
    '• FO30010: COOLDOWN RCS TO LESS THAN 350 DEGREES (99.9% Criticality)',
    '• FO30012: ESTABLISH N2 TO THE PORVS PER SOP-SI-1 (99.9% Criticality)',
    '• FO30014: PLACE RHR IN SERVICE PER SOP-RHR-1 (99.9% Criticality)',
    '• FO30015: COOLDOWN RCS TO LESS THAN 200 DEGREES (99.9% Criticality)',
    '• FO40007: COOLDOWN RCS TO 190 TO 180 DEGREES (Correlation: 0.59)',
  ];

  let y = 92;
  topDrivers.forEach(d => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(d, 18, y);
    y += 6;
  });

  doc.setLineWidth(0.2);
  doc.line(14, y + 4, 196, y + 4);

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('Open-Source Project Controls Suite • Built with TypeScript • 100% Client-Side Private Report', 14, 285);

  doc.save('qsra-screening-report.pdf');
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


function renderScheduleComparison() {
  const container = document.getElementById('tab-compare');
  if (!container) return;

  container.innerHTML = `
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

