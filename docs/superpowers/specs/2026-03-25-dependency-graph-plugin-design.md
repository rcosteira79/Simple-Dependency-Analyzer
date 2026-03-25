# Dependency Graph Plugin — Design Spec

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

An Android Studio plugin that visualises a Gradle multi-module project's dependency architecture. Users can explore the module graph interactively, isolate any module to understand what it depends on and what depends on it, and drill down into a module's internal class/package structure. Intended for publication to the JetBrains Marketplace and the Gradle Plugin Portal.

---

## Architecture

Three distinct artifacts, each with a single responsibility:

```
[Gradle Plugin]  →  graph.json + index.html  →  [IDE Plugin / JCEF]  →  D3.js visualisation
                                                 [IntelliJ PSI]         →  class/package drill-down
```

### Artifact 1 — Gradle Plugin (`dependency-graph-gradle`)

- Registers a `generateDependencyGraph` task
- Walks `project.subprojects`, reading applied plugin IDs to infer module type (see Module Type Inference below) and reading configurations (`implementation`, `api`, `compileOnly`) to collect dependency edges
- Ignores `buildSrc` and composite builds included via `includeBuild()` — these are treated as opaque external dependencies, not visualised modules. This is explicitly documented in the plugin's README.
- Outputs two files to `build/dep-graph/`:
  - `graph.json` — structured module graph consumed by the IDE plugin; versioned with a `schemaVersion` field
  - `index.html` — fully self-contained; module data is embedded as an inline JS variable (`window.__GRAPH_DATA__`), D3.js and `@dagrejs/dagre` bundled inline; openable in any browser without the IDE

### Artifact 2 — IDE Plugin (`dependency-graph-ide`)

- Provides a tool window with three panels: Explorer (left), Graph (centre), Detail (right)
- An **Analyse** toolbar action triggers the Gradle task via IntelliJ's `ExternalSystemUtil.runTask()` using `GradleExecutionSettings` — never via a raw shell call. This ensures correct Gradle wrapper resolution, JVM selection, and IDE-managed project configuration on all platforms including Windows (`gradlew.bat`).
- Reads `graph.json` after the Gradle task completes, validates the `schemaVersion`, and passes data to JCEF via `JBCefBrowser.executeJavaScript()`
- Handles PSI analysis lazily (on demand) for class/package drill-down and edge inspection. PSI results are received back from the webview via a registered `CefMessageRouter` query handler.
- Navigates to source files in the editor when the user clicks a class in the detail panel
- Detects stale graphs via an IDE `VirtualFileListener` on `build.gradle` / `build.gradle.kts` / `settings.gradle` files — any modification sets a dirty flag; the toolbar shows a warning until the next successful Analyse run

### Artifact 3 — Visualisation (`index.html` / D3.js inside JCEF)

- Force-directed graph with `@dagrejs/dagre` (the maintained successor to the deprecated `dagre-d3`) for initial layer ordering (App → Features → Core → Data)
- Rectangular nodes; edges connect at node borders with an ~8 SVG user units gap at default zoom (10 SVG user units from a focused node to clear its selection ring). These values scale naturally with D3's zoom transform.
- All interaction lives in JS: focus, dimming, depth slider, edge clicks
- **IDE plugin → JS:** data is passed via `JBCefBrowser.executeJavaScript()` calls
- **JS → IDE plugin:** events (drill-down requests, edge clicks, source navigation) are sent via `CefMessageRouter` queries registered on the `JBCefClient`

---

## Module Type Inference

The Gradle plugin infers module type from applied plugin IDs in priority order:

| Priority | Applied Plugin ID | Inferred Type |
|---|---|---|
| 1 | `com.android.application` | `app` |
| 2 | `com.android.dynamic-feature` | `feature` |
| 3 | Module path contains `/feature/` or name starts with `feature-` / `feature:` | `feature` |
| 4 | `com.android.library` + path/name contains `/data/`, `-data`, `:data` | `data` |
| 5 | `com.android.library` | `core` |
| 6 | `java-library` or `org.jetbrains.kotlin.jvm` | `core` |
| 7 | None of the above | `unknown` |

`unknown` modules are shown in the graph with a neutral style. Users can override the inferred type via a `dependencyGraph { moduleType = "feature" }` DSL block in the module's `build.gradle`.

---

## Data Model

### `graph.json` (module level — Gradle plugin output)

```json
{
  "schemaVersion": 1,
  "modules": [
    { "id": ":app",             "type": "app",     "path": "app" },
    { "id": ":feature-profile", "type": "feature", "path": "feature/profile" },
    { "id": ":core-ui",         "type": "core",    "path": "core/ui" }
  ],
  "edges": [
    { "from": ":app",             "to": ":feature-profile", "configuration": "implementation" },
    { "from": ":feature-profile", "to": ":core-ui",         "configuration": "implementation" }
  ]
}
```

The IDE plugin validates `schemaVersion` on load. If the version is higher than the IDE plugin supports, it shows an error: "Please update the Dependency Graph IDE plugin to match your Gradle plugin version."

### Class-level payload (PSI — computed lazily by IDE plugin)

```json
{
  "module": ":feature-profile",
  "packages": ["ui", "domain", "data"],
  "classes": [
    { "id": "ProfileScreen",    "package": "ui",     "type": "composable" },
    { "id": "ProfileViewModel", "package": "ui",     "type": "viewmodel" },
    { "id": "GetProfileUseCase","package": "domain", "type": "class" }
  ],
  "edges": [
    { "from": "ProfileViewModel", "to": "GetProfileUseCase", "type": "usage" }
  ]
}
```

---

## Data Flow

1. **User clicks Analyse** → IDE plugin calls `ExternalSystemUtil.runTask()` with `GradleExecutionSettings` targeting `:generateDependencyGraph`
2. **Gradle plugin runs** → walks subprojects, infers types, collects edges → writes `graph.json` (with `schemaVersion`) and `index.html` (data embedded as `window.__GRAPH_DATA__`)
3. **IDE plugin reads results** → validates `schemaVersion`, parses `graph.json` into `GraphModel` → calls `JBCefBrowser.executeJavaScript("window.loadGraph(" + json + ")")`
4. **D3.js renders the module graph** → layered layout with `@dagrejs/dagre`, interactive
5. **User drills into a module** (lazy) → JS sends a `CefMessageRouter` query `{"action":"drillDown","module":":feature-profile"}` → IDE plugin runs PSI analysis on that module's source root → builds `ClassGraphModel` → calls `executeJavaScript("window.loadClassGraph(" + json + ")")` → D3 re-renders with package clusters and class nodes
6. **User clicks an edge between two modules** → JS sends `{"action":"inspectEdge","from":":feature-profile","to":":core-ui"}` → IDE plugin runs targeted PSI query for cross-module class references → calls `executeJavaScript("window.loadEdgeInspector(" + json + ")")` → detail panel shows (sourceClass → targetClass) pairs
7. **User clicks a class pair** → JS sends `{"action":"navigate","file":"...","line":42}` → IDE plugin opens the source file at that line in the editor

PSI analysis is always lazy — only computed when the user drills in or clicks an edge, keeping the initial Analyse action fast.

---

## UI Layout

### Tool Window — three-panel layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ◈ Dependency Graph                              Last analysed: now  │
├──────────────────────────────────────────────────────────────────────┤
│ ▶ Analyse  |  ◎ Module Graph  |  ↺ Reset  ⤢ Fit      Depth [──] 2  │
├──────────────────────────────────────────────────────────────────────┤
│ modules                                                              │
├───────────────┬──────────────────────────────────────┬──────────────┤
│ Explorer      │  Graph (JCEF / D3.js)                │  Detail      │
│               │                                      │              │
│ By Type ByPath│  [layered DAG — App→Feat→Core→Data]  │  Module info │
│ 🔍 Filter     │                                      │  Depends on  │
│               │                                      │  Depended by │
│ App (1)       │                                      │  Fan-in/out  │
│  :app         │                                      │              │
│ Feature (3)   │                                      │  ⬇ Drill in  │
│  :feat-auth   │                                      │              │
│ ▶:feat-profile│                                      │              │
│  :feat-home   │                                      │              │
│ Core (2) ...  │                                      │              │
└───────────────┴──────────────────────────────────────┴──────────────┘
```

### Explorer panel

- Toggle between **By Type** (modules grouped as App / Feature / Core / Data / Unknown) and **By Path** (mirrors Gradle path hierarchy, collapsible tree)
- Filter input searches across both views
- Clicking a module selects and focuses it in the graph

### Graph panel

- **Layered DAG layout** — layers determined by module type (App top, Data bottom); within each layer nodes are distributed horizontally with equal spacing, no collisions
- **Rectangular nodes** colour-coded by type; focused node has a gold outline ring
- **Edges** are directed arrows that start and end ~8 SVG user units clear of node borders (10 SVG user units from the focused node to clear its selection ring); gap scales with zoom. Unrelated nodes and edges are dimmed but remain visible for spatial context.
- **Isolation / depth control** — default depth is 2; slider range 1–5; depth is bidirectional (shows modules that the focused module depends on AND modules that depend on it, up to N hops in either direction). Slider range is not configurable in v1.
- **Breadcrumb** shows current navigation level (e.g. `modules › :feature-profile › packages`)
- **Drill-down view** — packages replace modules as cluster regions, classes are nodes inside them; Explorer panel switches to showing the package tree for the active module

### Detail panel

- Shows metadata for the selected module or class: type, direct dependencies, dependents, fan-in/fan-out
- **Cross-module edge inspector** — clicking an edge between two modules lists the (sourceClass → targetClass) pairs that cause the dependency; each pair is clickable and navigates to the source file. Note: this requires a full PSI traversal of both modules' source trees and is the most complex feature in v1. If performance is a concern during implementation, a "N references" count with lazy expansion is an acceptable fallback.
- **Drill into module** button triggers class/package analysis for the selected module

---

## Standalone HTML

The Gradle plugin generates a self-contained `index.html` alongside `graph.json`. Module data is embedded as `window.__GRAPH_DATA__` (an inline JS variable). It includes the full module-level graph with all interactive features (isolation, depth slider, dimming, explorer panel). It does **not** include class/package drill-down or the cross-module edge inspector, as those require PSI (IDE-only).

| Feature | Standalone HTML | IDE Plugin |
|---|---|---|
| Module graph + physics | ✓ | ✓ |
| Isolation + depth slider | ✓ | ✓ |
| Explorer panel (both views) | ✓ | ✓ |
| Class/package drill-down | — | ✓ |
| Cross-module edge inspector | — | ✓ |
| Navigate to source | — | ✓ |

Single-module projects are fully supported: the graph shows one node with a hint ("No inter-module dependencies — drill into the module to explore its class architecture"), and the drill-down into class/package structure works exactly the same way.

---

## Error Handling

| Situation | Behaviour |
|---|---|
| Gradle task fails | Error output shown inline in the tool window; link to full Gradle run log |
| Non-Gradle / non-multi-module project | Clear banner: "This plugin requires a Gradle project" |
| Stale graph | Toolbar warning: "Graph may be outdated — click Analyse to refresh" (triggered by VFS listener on build/settings files) |
| Schema version mismatch | Error banner prompting user to update the IDE or Gradle plugin to a matching version |
| PSI analysis fails on a file | Node appears in graph with a small indicator; file silently skipped, no crash |
| Single-module project | One node shown with hint; drill-down fully functional |
| `buildSrc` / composite builds | Excluded from visualisation; documented in README |

---

## Testing Strategy

### Gradle plugin
- Unit tests per task class using Gradle's `ProjectBuilder` API
- Integration tests run the full task against a fixture multi-module project and assert on the shape of `graph.json`
- No mocking of Gradle internals — real APIs are cheap enough

### IDE plugin — module graph
- Unit tests on `GraphModel` parsing, schema version validation, and depth/dimming logic (pure Kotlin, no IDE required)
- Integration tests using the IntelliJ Platform test framework with a fixture project for the JCEF ↔ plugin roundtrip (Gradle trigger → JSON load → JS call)

### IDE plugin — PSI analysis
- Unit tests using `BasePlatformTestCase` (the recommended base for modern IntelliJ Platform tests) with synthetic Kotlin source files
- Asserts: "given these two Kotlin files, the edge inspector returns these class pairs"
- Covers Kotlin-specific constructs: extension functions, top-level functions, companion objects

### Visualisation (D3.js)
- Not unit tested; the JS layer is thin orchestration
- Correctness covered by IDE plugin integration tests and manual visual verification

---

## Publishing

### Gradle Plugin Portal
- Apply `com.gradle.plugin-publish` plugin
- Configure `gradlePlugin { plugins { create(...) { id, implementationClass, displayName, description, tags } } }`
- Publish via `./gradlew publishPlugins` with `gradle.publish.key` / `gradle.publish.secret` credentials

### JetBrains Marketplace
- Apply `org.jetbrains.intellij` plugin
- Configure `publishPlugin { token, channels }` task
- Declare `sinceBuild` / `untilBuild` in `plugin.xml` to control IDE version compatibility

Both artifacts version independently. The IDE plugin maintains a static mapping from `schemaVersion` integer (from `graph.json`) to the minimum required Gradle plugin semver (e.g. schema version 1 → Gradle plugin >= 1.0.0). If the loaded `schemaVersion` maps to a Gradle plugin version newer than what the IDE plugin was built against, it shows a version mismatch error.
