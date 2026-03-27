# Future Features Plan

**Goal:** Enhance the Gradle dependency graph plugin with metrics, filtering, and additional visualizations inspired by Aalekh and user feedback.

**Priority order:** 1-3 are next sprint, 4-5 are follow-ups, 6 is its own project.

---

## 1. Test dependency distinction

**Effort:** Low | **Value:** High

Add `testImplementation`, `androidTestImplementation`, `testCompileOnly` to the scanned configurations in `ModuleAnalyser`. The `Edge.configuration` field already stores the config name.

**Backend:**
- `ModuleAnalyser.kt`: add test configs to `DEPENDENCY_CONFIGURATIONS`
- No model changes needed — `Edge.configuration` already carries the info

**JS:**
- Render test edges as dashed grey lines (distinct from implementation edges)
- Add toolbar toggle "Test deps: Off/On" to show/hide test edges
- In the explorer detail panel, label test edges distinctly

---

## 2. Metrics panel (fan-in, fan-out, instability index)

**Effort:** Low (JS only) | **Value:** High

All metrics are computable from the existing `GraphModel` data client-side.

**Metrics:**
- **Fan-in**: count of modules that depend on this module (incoming edges)
- **Fan-out**: count of modules this module depends on (outgoing edges)
- **Instability index**: `fan-out / (fan-in + fan-out)` — 0 = maximally stable, 1 = maximally unstable
- **God module flag**: modules above a threshold (e.g., fan-in > 10 or fan-out > 10)

**JS:**
- New panel tab (or section in the detail pane) showing a sortable table with columns: Module, Type, Fan-in, Fan-out, Instability, God?
- Color-code instability: green (< 0.3), yellow (0.3-0.7), red (> 0.7)
- Clicking a row focuses that module in the graph
- Optionally color-code module node borders by instability

---

## 3. Edge type filtering toolbar

**Effort:** Low | **Value:** Medium

Toggle buttons to show/hide edges by configuration type.

**JS:**
- Toolbar buttons: `impl` | `api` | `compileOnly` | `test` (each toggleable)
- Filter `data.edges` in `drawEdges` based on active filters
- Persist filter state across rerenders

---

## 4. Adjacency matrix view

**Effort:** Medium | **Value:** Medium (useful for large projects)

A compact NxN grid showing all module dependencies at a glance.

**JS:**
- New view mode (tab or panel) alongside the graph
- Rows = source modules, columns = target modules
- Cells colored by edge type (implementation = blue, api = green, test = grey)
- Click a cell to see the dependency details in the detail pane
- Click a row/column header to focus that module in the graph
- Hover to highlight the row and column

---

## 5. CSV/JSON metrics export

**Effort:** Low (if metrics are computed) | **Value:** Medium (CI dashboards)

**Backend:**
- New output file `metrics.csv` alongside `graph.json` and `index.html`
- Columns: module, type, fan-in, fan-out, instability, class-count, boundary-class-count
- Timestamped for trending

**Or JS-only:**
- Export button in the metrics panel that generates and downloads a CSV client-side

---

## 6. Architecture rule enforcement

**Effort:** High | **Value:** High (separate project/spec)

Layer dependency rules, no-feature-to-feature rules, max-transitive-dependencies warnings.

**Backend:**
- DSL extension for defining layers and rules
- Validation logic in a new `ArchitectureValidator` class
- JUnit XML / SARIF output for CI integration
- Violations panel in JS

This warrants its own brainstorming session and spec.
