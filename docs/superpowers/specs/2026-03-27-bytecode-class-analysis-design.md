# Bytecode Class Analysis for Gradle Plugin

## Goal

Add class-level dependency analysis to the Gradle plugin so the browser output supports progressive drill-down: module -> packages -> boundary classes. This replaces the Android Studio plugin's PSI-based analysis with bytecode scanning, eliminating the JCEF dependency entirely.

## Context

The AS plugin used IntelliJ PSI APIs to walk source code and discover class references. That approach is tied to a running IDE and suffers from JCEF instability. The Gradle task already generates a self-contained HTML report with module-level graphs. This spec adds bytecode-based class analysis so the same HTML report supports package and class drill-down inside modules.

All class data is pre-computed at task time and embedded in the output JSON. The JS visualization performs unfolding client-side with no server round-trips.

## Architecture

### New components

#### `BytecodeClassAnalyser` (analysis/)

Scans a module's compiled `.class` files using ASM `ClassReader` + `ClassVisitor`.

Extracts references from:
- Superclass and implemented interfaces
- Field types
- Method parameter and return types
- Annotation types
- Instruction-level references (`INVOKEVIRTUAL`, `NEW`, `CHECKCAST`, `GETSTATIC`, `PUTSTATIC`, `GETFIELD`, `PUTFIELD`)

Filters out generated classes using two strategies:
- **Name-based**: suffix list (`_Factory`, `_HiltModules`, `_GeneratedInjector`, `_MembersInjector`, `_ComponentTreeDeps`, `_HiltComponents`, `_BindingImpl`, `_Provide`), prefix list (`Hilt_`, `Dagger`), exact matches (`BuildConfig`, `BR`, `DataBinderMapperImpl`)
- **Directory-based**: skip classes found under paths containing `/generated/` (covers KAPT, KSP, ViewBinding, DataBinding output)

Input: list of class output directories + module Gradle path.
Output: per-module raw data — discovered class qualified names and their outgoing references (qualified names of classes they depend on). The orchestrator consumes this raw data to compute boundary classes and cross-module edges.

#### `ClassAnalysisOrchestrator` (analysis/)

Coordinates class analysis across all modules.

1. Iterates all project modules.
2. Resolves compiled class output directories for the configured variant (default `"debug"`):
   - Android modules: `build/intermediates/javac/{variant}/classes/` and `build/tmp/kotlin-classes/{variant}/`
   - JVM modules: `build/classes/kotlin/main/` and `build/classes/java/main/`
3. Runs `BytecodeClassAnalyser` per module.
4. Cross-references results to classify each class reference as internal (within module) or external (cross-module).
5. Computes boundary classes per module:
   - **Incoming boundary**: classes whose qualified name appears as `targetClassId` in any other module's external deps where `targetModuleId` matches.
   - **Outgoing boundary**: classes whose qualified name appears as `sourceClassId` in the module's own external deps.
6. Groups boundary classes by package.
7. Produces `Map<ModuleId, ModuleClassData>`.

### Model changes

New data classes in `model/`:

```kotlin
@Serializable
data class ModuleClassData(
    val moduleId: String,
    val packages: List<PackageNode>,
    val classEdges: List<ClassLevelEdge>,
)

@Serializable
data class PackageNode(
    val name: String,
    val classes: List<BoundaryClass>,
    val boundaryType: BoundaryType, // INCOMING, OUTGOING, BOTH
)

@Serializable
enum class BoundaryType {
    INCOMING,  // classes that other modules depend on
    OUTGOING,  // classes that depend on classes in other modules
    BOTH,
}

@Serializable
data class BoundaryClass(
    val id: String,           // qualified name
    val simpleName: String,
)

@Serializable
data class ClassLevelEdge(
    val fromClassId: String,
    val fromModuleId: String,
    val toClassId: String,
    val toModuleId: String,
)
```

`GraphModel` changes:

```kotlin
@Serializable
data class GraphModel(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,  // bumped to 2
    val modules: List<Module>,
    val edges: List<Edge>,
    val classData: Map<String, ModuleClassData>? = null,  // null when --modules-only
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION: Int = 2
    }
}
```

### Extension changes

`DependencyGraphExtension` gains a `variant` property:

```kotlin
open class DependencyGraphExtension {
    var moduleType: String? = null
    var variant: String = "debug"
}
```

### Task changes

`GenerateDependencyGraphTask`:

- New `@Input` property `modulesOnly` (Boolean, default `false`). Wired from `-PmodulesOnly` project property.
- When `modulesOnly` is false:
  - Task `dependsOn` the compile tasks for the configured variant across all modules (e.g. `compileDebugJavaWithJavac`, `compileDebugKotlin` for Android; `compileKotlin`, `compileJava` for JVM).
  - After `ModuleAnalyser.analyse()`, runs `ClassAnalysisOrchestrator` to produce class data.
  - Merges both into a single `GraphModel`.
- When `modulesOnly` is true:
  - No compile task dependencies.
  - Skips class analysis.
  - `classData` is null in the output.

### Dependencies

- `org.ow2.asm:asm:9.7` added to `build.gradle.kts` implementation dependencies (~120KB, no transitive deps).

## JS Visualization

### Progressive drill-down

All class data is available in `window.__GRAPH_DATA__.classData`. The JS handles unfolding entirely client-side.

#### Module level (default)

Standard module graph. Right-click a module node to see a context menu with "Inspect classes" (hidden if `classData` is null or the module has no boundary classes).

#### Package level (after "Inspect classes")

The module node is replaced by a dashed bounding box:
- Title: module label
- Inside: rounded pill nodes, one per boundary package
- Pill label: `package.name (N)` where N is the class count
- Pill colors by boundary type:
  - Cyan (`#4fc3f7`): INCOMING (used by others)
  - Orange (`#f5a623`): OUTGOING (uses others)
  - Purple (`#c084fc`): BOTH
- Right-click the bounding box title -> "Collapse" folds back to module node.

#### Class level (after clicking a package pill)

The package pill expands to show individual boundary class nodes within it:
- Class nodes are smaller rectangles with the simple class name
- A collapse toggle (triangle/caret) on the package header collapses back to pill
- Click a class node to highlight its edges

#### Edge routing

- Module collapsed: edges point to/from the module node (unchanged).
- Module unfolded, package collapsed: edges point to/from the package pill node.
- Package expanded: edges point to/from specific class nodes.
- Class highlighted: its edges turn white/solid, all other class-level edges dim to 8% opacity.
- Edges between two unfolded modules connect class-to-class (or package-to-package if both packages are collapsed).

### Context menu

Implemented as a simple positioned `<div>` overlay (no native context menu). Appears on right-click over a module node. Options:
- "Inspect classes" (only when classData exists for the module)
- "Collapse" (only when module is unfolded)

## `--modules-only` flag

Passed as a Gradle project property: `./gradlew generateDependencyGraph -PmodulesOnly`.

When active:
- No compilation triggered.
- No class analysis.
- Output JSON has `classData: null`.
- JS hides "Inspect classes" in context menus.
- Useful for quick module-level visualization without waiting for a build.

## Variant resolution

The orchestrator resolves compile tasks and output directories per module:

**Android modules** (detected by `com.android.application` or `com.android.library` plugin):
- Compile tasks: `compile{Variant}JavaWithJavac`, `compile{Variant}Kotlin`
- Class dirs: `build/intermediates/javac/{variant}/classes/`, `build/tmp/kotlin-classes/{variant}/`

**JVM modules** (detected by `org.jetbrains.kotlin.jvm` or `java-library` plugin):
- Compile tasks: `compileKotlin`, `compileJava`
- Class dirs: `build/classes/kotlin/main/`, `build/classes/java/main/`

The variant name is taken from the root project's `dependencyGraph.variant` extension property (default: `"debug"`). For JVM modules, the variant is ignored.

## Testing

### Unit tests

- `BytecodeClassAnalyserTest`: feed it pre-compiled `.class` files (checked into test resources or compiled from fixture sources), verify it extracts correct class references, filters generated classes, handles edge cases (anonymous classes, lambdas, type annotations).
- `ClassAnalysisOrchestratorTest`: mock module structure, verify boundary class computation and package grouping.
- `GeneratedClassFilterTest`: verify name-based and directory-based filters individually.

### Integration test

- Extend the existing `GenerateDependencyGraphTaskTest` fixture project with a few classes that reference each other across modules.
- Run `generateDependencyGraph` and verify:
  - `classData` is present and non-null in output JSON.
  - Boundary classes are correctly identified.
  - `--modules-only` produces `classData: null`.
- Run with `-PmodulesOnly` and verify no compilation happens and classData is null.

### JS tests

- Manual verification of unfolding/collapsing behavior in browser.
- The JS is self-contained; automated testing is not in scope for this iteration.
