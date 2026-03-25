# Android Studio Plugin — Design Spec

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

An Android Studio (IntelliJ Platform) plugin that provides an interactive dependency graph tool window directly inside the IDE. It supports two views: a module-level graph (identical in features to the existing Gradle HTML report) and a class-level drill-down showing which classes inside a module cause inter-module dependencies.

The plugin targets Android Studio specifically. Non-Android IntelliJ IDEs are out of scope.

---

## Architecture

The plugin is a standard IntelliJ Platform Gradle project targeting Android Studio. It has four layers:

### 1. Plugin entry points (`plugin.xml`)
Declares a tool window ("Dependency Graph") and registers a startup activity that wires the analysis and rendering layers together.

### 2. Analysis layer (Kotlin)

**`ModuleGraphAnalyser`**
- Uses `ModuleManager`, `ModuleRootManager`, and `OrderEntry` IntelliJ APIs to build the module dependency graph.
- Detects module type via `FacetManager` (presence of `AndroidFacet`) and the same naming heuristics as the existing Gradle plugin's `ModuleTypeInferrer` (`feature-`, `:data:`, etc.).
- Maps dependency scopes to `implementation`/`api`/`compileOnly` equivalents.
- Module IDs use the Gradle path convention (`:module:path`), derived from the module's path relative to the project root, to remain compatible with the existing `GraphModel` contract. The `buildSrc` module is excluded. Composite builds are out of scope for v1.
- Produces the same `GraphModel(modules, edges)` shape the existing `graph-template.js` already understands — no JS changes needed for the module view.
- Runs via `ReadAction.nonBlocking().submit(AppExecutorUtil.getAppExecutorService())` so it never blocks the UI thread. The tool window shows a loading indicator while analysis is in progress.
- Re-runs on `ModuleRootManager.PROJECT_ROOTS_CHANGED` events (module added/removed, dependency added/removed). The graph is refreshed in place; any open class-view tabs are marked stale with a banner offering to re-analyse.

**`ClassDependencyAnalyser`**
- Given a module, uses PSI (`JavaPsiFacade`, `KtClassOrObject`, `PsiReference`, `ModuleUtilCore`) to collect all classes and detect cross-module references.
- **Resolution strategy:**
  - Inner classes: resolved to their outermost containing class for graph purposes (edge recorded to the top-level class).
  - Generic type parameters: resolved individually — `List<ExternalClass>` records an edge to `ExternalClass`.
  - Unresolvable references (null `PsiElement`, third-party library classes with no project module): silently skipped per individual reference, not per class.
- For each resolved cross-module reference, records the source class ID, the target module ID, and the target class ID.
- Produces `ClassGraphData`:
  ```
  ClassGraphData(
      inspectedModuleId: String,
      classes: List<ClassNode>,           // id, name, qualifiedName
      internalEdges: List<ClassEdge>,     // from classId → to classId, within same module
      externalDeps: List<ExternalDep>,    // sourceClassId, targetModuleId, targetClassId
  )
  ```
  This ensures that after expansion of an external module, edges can re-route to the specific target class and that the correct target classes are highlighted.
- Runs via `ReadAction.nonBlocking().submit(...)`. Only one analysis runs per tab at a time; a new request cancels the previous one for that tab.
- Shows a loading indicator in the class-view tab while running.

**Expand request/response protocol (JS ↔ Kotlin bridge):**
- **Request** (JS → Kotlin): `{ "action": "expandModule", "moduleId": ":some:module", "inspectedModuleId": ":other:module" }`
- Kotlin runs `ClassDependencyAnalyser` on the target module, scoped to only the classes referenced by the inspected module's classes.
- **Response** (Kotlin → JS): `{ "action": "expandedModule", "moduleId": ":some:module", "classes": [...], "internalEdges": [...], "highlightedClassIds": ["com.example.Foo"] }`
- The JS merges this into the existing graph, animates the expansion, and highlights `highlightedClassIds`.

### 3. Rendering layer (JCEF + HTML/JS)

Two self-contained HTML templates:

- **`module-view.html`**: uses the existing `graph-template.js` verbatim. The IntelliJ-analysed `GraphModel` JSON is injected as `window.__GRAPH_DATA__`, identical to what the Gradle task does. All existing features are supported: depth slider, transitive toggle, flat/deep layout modes, explorer panel, subgraph animation, edge detail pane, auto-select first app module.
- **`class-view.html`**: new template using the same D3/dagre stack. Renders the class graph with module boundary boxes.

One `JBCefBrowser` instance per tab. A `JBCefJSQuery` bridge per browser handles messages from JS → Kotlin (context menu actions, expand/collapse requests, navigation). JBCefJSQuery message handlers are unit-tested independently of JCEF (see Testing section).

**JCEF unavailable fallback:** The plugin generates HTML on-the-fly using the existing `HtmlReportGenerator` from the Gradle plugin module (shared as a common library dependency), then opens it in the system browser. No prior Gradle task run is needed.

### 4. Tool window UI (Swing)

A `JBTabbedPane` hosts:
- One permanent **Module Graph** tab (always present, never closeable).
- Zero or more closeable **`Classes: :full:module:path`** tabs, opened on demand via "View Classes". Tab titles use the full Gradle path for clarity when multiple tabs are open.

All tabs coexist in the same tab control. Switching tabs does not trigger re-analysis.

---

## Data Flow

```
Project opened
  → ModuleGraphAnalyser (ReadAction.nonBlocking, background)
  → loading indicator shown in Module Graph tab
  → GraphModel JSON injected into module-view.html
  → JCEF renders module graph

User right-clicks module node → "View Classes"
  → JS posts { action: "viewClasses", moduleId: ":some:module" } via JBCefJSQuery
  → New "Classes: :some:module" tab created with loading indicator
  → ClassDependencyAnalyser runs (ReadAction.nonBlocking, background)
  → ClassGraphData JSON injected into class-view.html
  → JCEF renders class graph

User clicks external module node (collapsed)
  → JS posts { action: "expandModule", moduleId: "...", inspectedModuleId: "..." }
  → ClassDependencyAnalyser scoped to referenced classes in target module
  → Response { action: "expandedModule", ... } posted back to JS
  → Graph animates expansion, target classes highlighted

User right-clicks class node → "Go to class"
  → JS posts { action: "goToClass", qualifiedName: "com.example.Foo" }
  → Kotlin uses JavaPsiFacade to find PsiClass, then navigates editor
```

---

## Class View UI

### Visual structure
- The inspected module's classes are rendered inside a labelled rounded-rect boundary box.
- Collapsed external module nodes appear outside the boundary as pill-shaped nodes (same style as module nodes in the module view) with a `+` indicator. The context menu is available on these pill-shaped nodes.
- When an external module is expanded, its boundary box appears alongside the inspected module's boundary. Classes inside it are rendered within it; the target classes (referenced by the inspected module) are highlighted (brighter fill + ring).
- Edges from inspected classes to collapsed external modules point to the pill node. After expansion, edges re-route to the specific target class.
- If multiple classes in the inspected module depend on the same external module, expanding shows all classes in the external module with all relevant ones highlighted.

### Interactions

| Trigger | Action |
|---|---|
| Left-click external module node (collapsed) | Expand in-place (animated) |
| Left-click external module node (expanded) | Collapse in-place |
| Right-click class node | Context menu: "Go to class", "View dependencies" |
| Right-click external module node (collapsed or expanded) | Context menu: "Expand / Collapse", "View Classes" (new tab), "View module graph" (focus module view tab) |
| Right-click inspected module node | Context menu: "View module graph" |

### Toolbar
Fit, Reset, arrow style toggle (Straight/Bent). Depth slider and transitive toggle are not present in the class view.

---

## Module View Context Menu (on module nodes)

Right-clicking a module node in the module view adds:
- **Reveal in Project** — reveals the module's root directory in the Project panel.
- **View Classes** — opens (or focuses) the class view tab for that module.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No source roots / empty module | Class-view tab shows empty state: "No classes found in `:module-name`" |
| Unresolvable PSI references | Silently skipped per reference; class is still shown with its resolvable edges |
| Analysis exception / timeout | Affected tab shows error state with message and "Retry" button; retry re-runs the analyser for that tab only |
| JCEF unavailable | Generate HTML via `HtmlReportGenerator` and open in system browser |
| Module roots change while class-view tab is open | Tab shows stale-data banner: "Module structure changed — click to re-analyse" |

---

## Testing

| Component | Approach |
|---|---|
| `ModuleGraphAnalyser` | Unit tests with `MockProject` + mock `ModuleManager`; verify nodes, edges, type inference |
| `ClassDependencyAnalyser` (Java) | `LightJavaCodeInsightFixtureTestCase` with fixture source files; verify cross-module edges, inner class resolution, generic type resolution |
| `ClassDependencyAnalyser` (Kotlin) | `KotlinLightCodeInsightFixtureTestCase` with fixture `.kt` source files; same scenarios |
| `ModuleTypeInferrer` (reused) | Already covered by existing `ModuleTypeInferrerTest` |
| `JBCefJSQuery` message handlers | Unit-tested via plain Kotlin tests: given a message string, verify the correct analyser method is called and the correct response JSON is produced — no JCEF instance needed |
| JCEF rendering end-to-end | Manual testing in Android Studio |

---

## Out of Scope

- Call graph analysis (method-level dependencies).
- Kotlin Multiplatform source set distinction (treated as a single module).
- Live incremental updates during typing (only updates on module root changes).
- Composite builds (v1).
- Non-Android IntelliJ IDEs.
