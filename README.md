# TPPSCI — Tahir Project Planning, Scheduling & Control Intelligence 🚀

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Vite](https://img.shields.io/badge/Vite-6.0-646CFF)
![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-green)
![Status](https://img.shields.io/badge/Status-Production--Ready-brightgreen)

> **TPPSCI (Tahir Project Planning, Scheduling & Control Intelligence)** is an advanced, high-performance, 100% client-side web application suite designed for Primavera P6 project planners, delay analysts, and project control professionals.

---

## 🌟 Primary Features & Modules

### 📊 1. Primavera P6 XER Viewer & Gantt Chart
- **Split-pane Gantt Canvas**: Synchronized dual-pane navigation with WBS hierarchy trees.
- **3-Row Control Toolbar**: Filter by status (`Not Started`, `In Progress`, `Completed`), critical path, milestones, max float horizon, and zoom modes (`Week`, `Month`, `Quarter`).
- **Visual Data Date Indicator**: Red dashed vertical data date line with custom baseline overlay support.

### 🛡️ 2. DCMA 14-Point Health Assessment
- Evaluates Primavera schedules against all 14 DCMA industry standards (Open Ends, Leads, Lags, Hard Constraints, High Float, Negative Float, Critical Path Test, etc.).
- **Interactive Thresholds Modal**: Configurable RAG band inputs (`Green`, `Amber`, `Red`) per check.

### 📈 3. Schedule Risk Analysis (QSRA-Lite Monte Carlo)
- **3-Step Workflow**: Load & Validate -> Risk Range Grid -> Monte Carlo Simulation (3,000 runs).
- **Graphical Visualizations**:
  - Continuous **Cumulative Completion S-Curve** merged with iteration density histograms.
  - **Criticality Index Bar Chart**: Shows % of iterations each activity spends on the critical path.
  - **Duration Sensitivity Tornado Chart**: Ranked correlation drivers.
- **`📄 PDF Summary Report`**: Generates and downloads `qsra-screening-report.pdf` 100% locally.

### 🔄 4. Schedule Comparison & Milestone Slip Analysis
- **Multi-File Slot Comparison**: Compare Baselines, Current Updates, and intermediate target dates.
- **9 Specialized Report Sub-Tabs**: `Summary`, `Milestones`, `Slip Chart`, `Critical Path`, `Change Register`, `Float Erosion`, `Progress`, `Slippage by WBS`, `Narrative`.

### 🔏 5. XER Anonymiser
- Pseudonymize sensitive content (`PROJECT.proj_short_name`, activity/WBS names, resources, costs, notebooks) while preserving the analytical skeleton (`TASKPRED` logic, dates, float, calendars).
- Exports scrubbed `.XER`, mapping `.CSV`, and residual scan report `.TXT`.

### 🛤️ 6. Time–Chainage (Time-Location) Diagram Generator
- Designed for linear infrastructure (Rail, Highways, Pipelines, Tunnels).
- **`▶ Load the demo`**: Instantly plots 7-layer synthetic linear schemes.
- Custom UDF and Regex activity ID chainage mapping table with PNG, SVG, and PDF exports.

### 🤝 7. Contractor Progress Roll-Up
- Map summary (L2) activities to contractor detailed (L3/4) anchor spans.
- Calendar-corrected remaining duration calculations across different working calendars (5-day vs 6-day weeks).
- Decision review table with `Accept All`, `Reject All`, and updated `.XER` export.

### 🔧 8. MS Project XML Importer & Fixer
- Inspects and repairs MSPDI XML files for Oracle Primavera P6 import compatibility (`File -> Import -> Microsoft Project XML`).
- Fixes Calendar UID mismatches, orphaned predecessor UIDs, and invalid constraint types.

---

## 🔒 100% Client-Side Privacy Guarantee

All file parsing, calculations, Monte Carlo simulations, anonymizations, and PDF/CSV exports occur **entirely within your web browser**. **No data or files ever leave your machine or upload to any external server.**

---

## 🛠️ Installation & Local Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Tahir-yamin/tppsci-project-controls-suite.git

# Navigate into the project directory
cd tppsci-project-controls-suite

# Install dependencies
npm install

# Run the local development server
npm run dev
```

Open `http://localhost:5173` or `http://localhost:4173` in your browser.

---

## 👤 Author & Contributor

**Tahir Yamin**  
- **Email**: [Tahiryamin2050@gmail.com](mailto:Tahiryamin2050@gmail.com)  
- **Role**: Lead Developer & Project Controls Architect  

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
