# Dependency Graph — Gradle Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a Gradle plugin that analyses a multi-module Android/Kotlin project and outputs `graph.json` (structured module dependency data) and `index.html` (a self-contained interactive visualisation).

**Architecture:** A single Gradle plugin applies to the root project, registers a `generateDependencyGraph` task, walks `project.subprojects` to collect module types and dependency edges, serialises the result to `build/dep-graph/graph.json`, and writes a standalone `index.html` with all visualisation logic and data bundled inline. The analysis, serialisation, and report generation are separate classes with no knowledge of each other.

**Tech Stack:** Kotlin, Gradle Plugin API, `kotlinx.serialization` for JSON, D3.js v7 + `@dagrejs/dagre` v1 for the HTML visualisation, JUnit 5 + Gradle TestKit for tests, `com.gradle.plugin-publish` for publication.

> **Known v1 deviation:** The standalone `index.html` loads D3.js and dagre from CDN `<script>` tags rather than bundling them inline. This means the file requires internet access to render, which is acceptable for v1. Bundling (e.g. via a Webpack or esbuild step in the Gradle build) can be added in a follow-up.

---

## File Structure

```
gradle-plugin/
├── build.gradle.kts                          # Plugin build: kotlin-jvm, serialization, plugin-publish
├── settings.gradle.kts                       # Project name: dependency-graph-gradle
├── src/
│   ├── main/
│   │   └── kotlin/io/github/rcosteira79/depgraph/
│   │       ├── DependencyGraphPlugin.kt      # Plugin entry point — registers task and DSL extension
│   │       ├── DependencyGraphExtension.kt   # DSL: dependencyGraph { moduleType = "..." }
│   │       ├── GenerateDependencyGraphTask.kt# Gradle task — wires analyser, serialiser, report gen
│   │       ├── model/
│   │       │   ├── Module.kt                 # @Serializable data class: id, type, path
│   │       │   ├── ModuleType.kt             # Enum: APP, FEATURE, CORE, DATA, UNKNOWN
│   │       │   ├── Edge.kt                   # @Serializable data class: from, to, configuration
│   │       │   └── GraphModel.kt             # @Serializable data class: schemaVersion, modules, edges
│   │       ├── analysis/
│   │       │   ├── ModuleTypeInferrer.kt     # Pure function: (pluginIds, path, name) -> ModuleType
│   │       │   └── ModuleAnalyser.kt         # Walks project.subprojects -> GraphModel
│   │       ├── serialisation/
│   │       │   └── GraphSerializer.kt        # Writes GraphModel to graph.json
│   │       └── report/
│   │           ├── HtmlReportGenerator.kt    # Writes index.html
│   │           └── graph-template.js         # D3 + dagre visualisation (resource file, inlined by generator)
│   └── test/
│       └── kotlin/io/github/rcosteira79/depgraph/
│           ├── analysis/
│           │   ├── ModuleTypeInferrerTest.kt
│           │   └── ModuleAnalyserTest.kt
│           ├── serialisation/
│           │   └── GraphSerializerTest.kt
│           ├── report/
│           │   └── HtmlReportGeneratorTest.kt
│           └── integration/
│               └── GenerateDependencyGraphTaskTest.kt  # Gradle TestKit
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `gradle-plugin/settings.gradle.kts`
- Create: `gradle-plugin/build.gradle.kts`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt`

- [ ] **Step 1: Create `gradle-plugin/settings.gradle.kts`**

```kotlin
rootProject.name = "dependency-graph-gradle"
```

- [ ] **Step 2: Create `gradle-plugin/build.gradle.kts`**

```kotlin
plugins {
    `kotlin-dsl`
    `java-gradle-plugin`
    kotlin("plugin.serialization") version "2.0.0"
    id("com.gradle.plugin-publish") version "1.2.1"
}

group = "io.github.rcosteira79"
version = "1.0.0"

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    testImplementation(gradleTestKit())
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.10.2")
}

gradlePlugin {
    website = "https://github.com/rcosteira79/dependency-graph"
    vcsUrl = "https://github.com/rcosteira79/dependency-graph"
    plugins {
        create("dependencyGraph") {
            id = "io.github.rcosteira79.dependency-graph"
            implementationClass = "io.github.rcosteira79.depgraph.DependencyGraphPlugin"
            displayName = "Dependency Graph"
            description = "Visualises your Gradle multi-module dependency architecture"
            tags = listOf("android", "dependency-graph", "architecture", "visualization")
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
```

- [ ] **Step 3: Create the plugin entry point with a no-op apply**

```kotlin
// DependencyGraphPlugin.kt
package io.github.rcosteira79.depgraph

import org.gradle.api.Plugin
import org.gradle.api.Project

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        // Tasks registered in later tasks
    }
}
```

- [ ] **Step 4: Verify the project builds**

Run from `gradle-plugin/`:
```bash
./gradlew build
```
Expected: BUILD SUCCESSFUL (no source to compile yet is fine; it should at least resolve dependencies)

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/
git commit -m "feat: scaffold gradle plugin project"
```

---

## Task 2: Data model

**Files:**
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/ModuleType.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/Module.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/Edge.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/GraphModel.kt`

These are pure data classes — no tests needed beyond what compilation provides. The `@Serializable` annotations are verified by the serialisation task's tests.

- [ ] **Step 1: Create `ModuleType.kt`**

```kotlin
package io.github.rcosteira79.depgraph.model

enum class ModuleType {
    APP, FEATURE, CORE, DATA, UNKNOWN
}
```

- [ ] **Step 2: Create `Module.kt`**

```kotlin
package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class Module(
    val id: String,
    val type: String,   // lowercase enum name, e.g. "app", "feature"
    val path: String
)
```

- [ ] **Step 3: Create `Edge.kt`**

```kotlin
package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class Edge(
    val from: String,
    val to: String,
    val configuration: String
)
```

- [ ] **Step 4: Create `GraphModel.kt`**

```kotlin
package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class GraphModel(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val modules: List<Module>,
    val edges: List<Edge>
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION: Int = 1
    }
}
```

- [ ] **Step 5: Verify compilation**

```bash
./gradlew compileKotlin
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/
git commit -m "feat: add graph data model"
```

---

## Task 3: Module type inferrer

**Files:**
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleTypeInferrer.kt`
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleTypeInferrerTest.kt`

- [ ] **Step 1: Write the failing tests**

```kotlin
// ModuleTypeInferrerTest.kt
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.ModuleType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.util.stream.Stream

class ModuleTypeInferrerTest {

    @ParameterizedTest(name = "{0}")
    @MethodSource("inferenceTestCases")
    fun `infers module type from plugin ids and path`(
        description: String,
        inputPluginIds: Set<String>,
        inputModulePath: String,
        inputModuleName: String,
        expectedType: ModuleType
    ) {
        val actualType = ModuleTypeInferrer.infer(
            pluginIds = inputPluginIds,
            modulePath = inputModulePath,
            moduleName = inputModuleName
        )
        assertEquals(expectedType, actualType)
    }

    companion object {
        @JvmStatic
        fun inferenceTestCases(): Stream<Arguments> = Stream.of(
            Arguments.of(
                "com.android.application -> APP",
                setOf("com.android.application"), ":app", "app",
                ModuleType.APP
            ),
            Arguments.of(
                "com.android.dynamic-feature -> FEATURE",
                setOf("com.android.dynamic-feature"), ":feature-login", "feature-login",
                ModuleType.FEATURE
            ),
            Arguments.of(
                "path containing /feature/ -> FEATURE",
                setOf("com.android.library"), ":feature:profile", "profile",
                ModuleType.FEATURE
            ),
            Arguments.of(
                "name starting with feature- -> FEATURE",
                setOf("com.android.library"), ":feature-home", "feature-home",
                ModuleType.FEATURE
            ),
            Arguments.of(
                "android library with data in path -> DATA",
                setOf("com.android.library"), ":data:user", "user",
                ModuleType.DATA
            ),
            Arguments.of(
                "android library with -data in name -> DATA",
                setOf("com.android.library"), ":data-user", "data-user",
                ModuleType.DATA
            ),
            Arguments.of(
                "android library (no data/feature indicator) -> CORE",
                setOf("com.android.library"), ":core-ui", "core-ui",
                ModuleType.CORE
            ),
            Arguments.of(
                "java-library -> CORE",
                setOf("java-library"), ":core-utils", "core-utils",
                ModuleType.CORE
            ),
            Arguments.of(
                "org.jetbrains.kotlin.jvm -> CORE",
                setOf("org.jetbrains.kotlin.jvm"), ":core-utils", "core-utils",
                ModuleType.CORE
            ),
            Arguments.of(
                "no recognised plugin -> UNKNOWN",
                emptySet<String>(), ":some-module", "some-module",
                ModuleType.UNKNOWN
            ),
            Arguments.of(
                "com.android.application beats feature path",
                setOf("com.android.application"), ":feature:app", "app",
                ModuleType.APP
            )
        )
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
./gradlew test --tests "*.ModuleTypeInferrerTest"
```
Expected: FAIL — `ModuleTypeInferrer` does not exist yet

- [ ] **Step 3: Implement `ModuleTypeInferrer.kt`**

```kotlin
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.ModuleType

object ModuleTypeInferrer {

    fun infer(
        pluginIds: Set<String>,
        modulePath: String,
        moduleName: String
    ): ModuleType = when {
        pluginIds.contains("com.android.application")      -> ModuleType.APP
        pluginIds.contains("com.android.dynamic-feature")  -> ModuleType.FEATURE
        isFeatureByPath(modulePath, moduleName)            -> ModuleType.FEATURE
        pluginIds.contains("com.android.library") && isDataByPath(modulePath, moduleName) -> ModuleType.DATA
        pluginIds.contains("com.android.library")          -> ModuleType.CORE
        pluginIds.contains("java-library")                 -> ModuleType.CORE
        pluginIds.contains("org.jetbrains.kotlin.jvm")     -> ModuleType.CORE
        else                                               -> ModuleType.UNKNOWN
    }

    private fun isFeatureByPath(path: String, name: String): Boolean =
        path.contains("/feature/") ||
        path.contains(":feature:") ||
        name.startsWith("feature-") ||
        name.startsWith("feature:")

    private fun isDataByPath(path: String, name: String): Boolean =
        path.contains("/data/") ||
        path.contains(":data:") ||
        name.startsWith("data-") ||
        name.startsWith("data:") ||
        name.endsWith("-data")
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
./gradlew test --tests "*.ModuleTypeInferrerTest"
```
Expected: 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/
git commit -m "feat: implement module type inferrer"
```

---

## Task 4: Module analyser

**Files:**
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleAnalyser.kt`
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleAnalyserTest.kt`

The analyser uses Gradle's `ProjectBuilder` API in tests — no mocking needed.

- [ ] **Step 1: Write the failing test**

```kotlin
// ModuleAnalyserTest.kt
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.ModuleType
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModuleAnalyserTest {

    @Test
    fun `analyses single-module project with no edges`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        rootProject.pluginManager.apply("com.android.application")

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        assertEquals(1, actualGraph.modules.size)
        // Root project path in ProjectBuilder is always ":"
        assertEquals(":", actualGraph.modules.first().id)
        assertTrue(actualGraph.edges.isEmpty())
    }

    @Test
    fun `collects implementation edge between two subprojects`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        val appProject = ProjectBuilder.builder()
            .withName("app")
            .withParent(rootProject)
            .build()
        val coreProject = ProjectBuilder.builder()
            .withName("core-ui")
            .withParent(rootProject)
            .build()

        appProject.pluginManager.apply("java-library")
        coreProject.pluginManager.apply("java-library")
        appProject.configurations.create("implementation")
        appProject.dependencies.add("implementation", coreProject)

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        val actualEdge = actualGraph.edges.single()
        assertEquals(":app", actualEdge.from)
        assertEquals(":core-ui", actualEdge.to)
        assertEquals("implementation", actualEdge.configuration)
    }

    @Test
    fun `skips buildSrc project`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        ProjectBuilder.builder().withName("buildSrc").withParent(rootProject).build()

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        assertTrue(actualGraph.modules.none { it.id == ":buildSrc" })
    }

    @Test
    fun `respects moduleType override from extension`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        val module = ProjectBuilder.builder()
            .withName("weird-module")
            .withParent(rootProject)
            .build()
        module.pluginManager.apply("java-library")
        // Simulate DSL override
        module.extensions.create("dependencyGraph", DependencyGraphExtension::class.java)
        module.extensions.getByType(DependencyGraphExtension::class.java).moduleType = "feature"

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        val actualModule = actualGraph.modules.find { it.id == ":weird-module" }!!
        assertEquals("feature", actualModule.type)
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
./gradlew test --tests "*.ModuleAnalyserTest"
```
Expected: FAIL — `ModuleAnalyser` does not exist yet

- [ ] **Step 3: Create `DependencyGraphExtension.kt`** (needed by the analyser and DSL task)

```kotlin
// DependencyGraphExtension.kt
package io.github.rcosteira79.depgraph

import org.gradle.api.provider.Property

open class DependencyGraphExtension {
    /** Override the inferred module type. Valid values: app, feature, core, data, unknown */
    var moduleType: String? = null
}
```

- [ ] **Step 4: Implement `ModuleAnalyser.kt`**

```kotlin
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import org.gradle.api.Project

private val DEPENDENCY_CONFIGURATIONS = setOf("implementation", "api", "compileOnly")
private val EXCLUDED_PROJECTS = setOf("buildSrc")

object ModuleAnalyser {

    fun analyse(rootProject: Project): GraphModel {
        val allProjects = rootProject.allprojects
            .filter { it.name !in EXCLUDED_PROJECTS }

        val modules = allProjects.map { project -> project.toModule() }
        val edges = allProjects.flatMap { project -> project.collectEdges(allProjects) }

        return GraphModel(modules = modules, edges = edges)
    }

    private fun Project.toModule(): Module {
        val extension = extensions.findByType(DependencyGraphExtension::class.java)
        val overriddenType = extension?.moduleType

        val inferredType = ModuleTypeInferrer.infer(
            pluginIds = plugins.map { it::class.java.name }.toSet(),
            modulePath = path,
            moduleName = name
        )

        return Module(
            id = path,
            type = overriddenType ?: inferredType.name.lowercase(),
            path = projectDir.relativeTo(rootProject.projectDir).path
        )
    }

    private fun Project.collectEdges(allProjects: List<Project>): List<Edge> {
        val projectPaths = allProjects.map { it.path }.toSet()
        return DEPENDENCY_CONFIGURATIONS.flatMap { configName ->
            val config = configurations.findByName(configName) ?: return@flatMap emptyList()
            config.dependencies
                .filterIsInstance<org.gradle.api.artifacts.ProjectDependency>()
                .filter { it.dependencyProject.path in projectPaths }
                .map { dep ->
                    Edge(from = path, to = dep.dependencyProject.path, configuration = configName)
                }
        }
    }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
./gradlew test --tests "*.ModuleAnalyserTest"
```
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add gradle-plugin/src/
git commit -m "feat: implement module analyser"
```

---

## Task 5: Graph serialiser

**Files:**
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializer.kt`
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializerTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// GraphSerializerTest.kt
package io.github.rcosteira79.depgraph.serialisation

import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class GraphSerializerTest {

    @Test
    fun `writes valid json to output file`(@TempDir tempDir: File) {
        val inputGraph = GraphModel(
            modules = listOf(Module(id = ":app", type = "app", path = "app")),
            edges = emptyList()
        )
        val outputFile = File(tempDir, "graph.json")

        GraphSerializer.serialize(inputGraph, outputFile)

        val parsedGraph = Json.decodeFromString<GraphModel>(outputFile.readText())
        assertEquals(inputGraph, parsedGraph)
    }

    @Test
    fun `output contains schemaVersion field`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "graph.json")
        GraphSerializer.serialize(GraphModel(modules = emptyList(), edges = emptyList()), outputFile)

        val json = outputFile.readText()
        assert(json.contains("\"schemaVersion\"")) { "Expected schemaVersion in output" }
    }

    @Test
    fun `creates parent directories if missing`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "sub/dir/graph.json")
        GraphSerializer.serialize(GraphModel(modules = emptyList(), edges = emptyList()), outputFile)

        assert(outputFile.exists())
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
./gradlew test --tests "*.GraphSerializerTest"
```
Expected: FAIL

- [ ] **Step 3: Implement `GraphSerializer.kt`**

```kotlin
package io.github.rcosteira79.depgraph.serialisation

import io.github.rcosteira79.depgraph.model.GraphModel
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

private val json = Json { prettyPrint = true }

object GraphSerializer {
    fun serialize(graph: GraphModel, outputFile: File) {
        outputFile.parentFile.mkdirs()
        outputFile.writeText(json.encodeToString(graph))
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
./gradlew test --tests "*.GraphSerializerTest"
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/
git commit -m "feat: implement graph serialiser"
```

---

## Task 6: HTML report generator

**Files:**
- Create: `gradle-plugin/src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/report/HtmlReportGenerator.kt`
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/report/HtmlReportGeneratorTest.kt`

The JS visualisation lives in `graph-template.js` (a resource file). `HtmlReportGenerator` loads it at runtime and inlines it into the HTML alongside the graph data.

- [ ] **Step 1: Write the failing tests**

```kotlin
// HtmlReportGeneratorTest.kt
package io.github.rcosteira79.depgraph.report

import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class HtmlReportGeneratorTest {

    private val inputGraph = GraphModel(
        modules = listOf(
            Module(id = ":app", type = "app", path = "app"),
            Module(id = ":core-ui", type = "core", path = "core/ui")
        ),
        edges = listOf(Edge(from = ":app", to = ":core-ui", configuration = "implementation"))
    )

    @Test
    fun `produces a valid html file`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val html = outputFile.readText()
        assertTrue(html.trimStart().startsWith("<!DOCTYPE html>"), "Expected HTML doctype")
        assertTrue(html.contains("<html"), "Expected html tag")
    }

    @Test
    fun `embeds graph data as window __GRAPH_DATA__`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val html = outputFile.readText()
        assertTrue(html.contains("window.__GRAPH_DATA__"), "Expected graph data variable")
        assertTrue(html.contains(":app"), "Expected module id in embedded data")
        assertTrue(html.contains(":core-ui"), "Expected module id in embedded data")
    }

    @Test
    fun `includes d3 and dagre script references`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val html = outputFile.readText()
        assertTrue(html.contains("d3"), "Expected D3.js reference")
        assertTrue(html.contains("dagre"), "Expected dagre reference")
    }

    @Test
    fun `creates parent directories if missing`(@TempDir tempDir: File) {
        val outputFile = File(tempDir, "sub/dir/index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        assertTrue(outputFile.exists())
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
./gradlew test --tests "*.HtmlReportGeneratorTest"
```
Expected: FAIL

- [ ] **Step 3: Create `graph-template.js`**

This file is the complete D3.js + dagre visualisation. It reads `window.__GRAPH_DATA__` and renders the interactive graph. Create `gradle-plugin/src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js` with the following content:

```javascript
(function () {
  const data = window.__GRAPH_DATA__;
  if (!data) { document.body.innerHTML = '<p style="color:red">No graph data found.</p>'; return; }

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 140, NODE_H = 32, GAP = 8, FOCUS_GAP = 10;
  const LAYER_ORDER = ['app', 'feature', 'core', 'data', 'unknown'];
  const NODE_COLORS = { app:'#7b1212', feature:'#0d3461', core:'#2d0d5e', data:'#0d3318', unknown:'#2a2a2a' };
  const NODE_BORDERS = { app:'#c62828', feature:'#1565c0', core:'#6a1fc2', data:'#2e7d32', unknown:'#555' };

  let focusedId = null;
  let depthValue = 2;

  // ── Layout (dagre) ─────────────────────────────────────────────────────────
  function computeLayout(modules, edges) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    modules.forEach(m => g.setNode(m.id, { width: NODE_W, height: NODE_H, label: m.id }));
    edges.forEach(e => g.setEdge(e.from, e.to));
    dagre.layout(g);
    return g;
  }

  // ── Visibility (focus + depth) ─────────────────────────────────────────────
  function getVisibleIds(focusId, depth, modules, edges) {
    if (!focusId) return new Set(modules.map(m => m.id));
    const visible = new Set([focusId]);
    let frontier = new Set([focusId]);
    for (let d = 0; d < depth; d++) {
      const next = new Set();
      frontier.forEach(id => {
        edges.forEach(e => {
          if (e.from === id && !visible.has(e.to)) { visible.add(e.to); next.add(e.to); }
          if (e.to === id && !visible.has(e.from)) { visible.add(e.from); next.add(e.from); }
        });
      });
      frontier = next;
    }
    return visible;
  }

  // ── Edge endpoint (border intersection, pulled back by gap) ───────────────
  function edgeEndpoint(cx1, cy1, cx2, cy2, hw, hh, gap) {
    const dx = cx2 - cx1, dy = cy2 - cy1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [cx1, cy1];
    const ratio = Math.abs(dy / dx);
    const threshold = hh / hw;
    let bx, by;
    if (ratio <= threshold) {
      // exits through left/right
      const sx = dx > 0 ? hw : -hw;
      bx = cx1 + sx;
      by = cy1 + dy * Math.abs(sx) / Math.abs(dx);
    } else {
      // exits through top/bottom
      const sy = dy > 0 ? hh : -hh;
      by = cy1 + sy;
      bx = cx1 + dx * Math.abs(sy) / Math.abs(dy);
    }
    // pull back by gap
    const ux = dx / len, uy = dy / len;
    return [bx + ux * gap, by + uy * gap];
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    const { modules, edges } = data;
    const g = computeLayout(modules, edges);
    const visibleIds = getVisibleIds(focusedId, depthValue, modules, edges);

    const graphEl = document.getElementById('graph-svg');
    const graphNode = g.graph();
    const svgW = Math.max(graphEl.parentElement.clientWidth, graphNode.width + 80);
    const svgH = Math.max(graphEl.parentElement.clientHeight, graphNode.height + 80);
    graphEl.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    graphEl.setAttribute('width', svgW);
    graphEl.setAttribute('height', svgH);

    const hw = NODE_W / 2, hh = NODE_H / 2;

    // edges
    const edgeGroup = document.getElementById('edges');
    edgeGroup.innerHTML = '';
    edges.forEach(e => {
      const sn = g.node(e.from), tn = g.node(e.to);
      if (!sn || !tn) return;
      const isFocusedEdge = focusedId && (e.from === focusedId || e.to === focusedId);
      const isVisible = !focusedId || (visibleIds.has(e.from) && visibleIds.has(e.to));

      const srcGap = e.from === focusedId ? FOCUS_GAP : GAP;
      const tgtGap = e.to === focusedId ? FOCUS_GAP : GAP;
      const [x1, y1] = edgeEndpoint(sn.x, sn.y, tn.x, tn.y, hw, hh, srcGap);
      const [x2, y2] = edgeEndpoint(tn.x, tn.y, sn.x, sn.y, hw, hh, tgtGap);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', isFocusedEdge ? '#f5a623' : 'rgba(255,255,255,0.3)');
      line.setAttribute('stroke-width', isFocusedEdge ? '2' : '1.2');
      line.setAttribute('opacity', isVisible ? '1' : '0.08');
      line.setAttribute('marker-end', isFocusedEdge ? 'url(#arrow-lit)' : 'url(#arrow-rel)');
      line.dataset.from = e.from; line.dataset.to = e.to;
      line.style.cursor = 'pointer';
      line.addEventListener('click', () => onEdgeClick(e.from, e.to));
      edgeGroup.appendChild(line);
    });

    // nodes
    const nodeGroup = document.getElementById('nodes');
    nodeGroup.innerHTML = '';
    modules.forEach(m => {
      const n = g.node(m.id);
      if (!n) return;
      const isFocused = m.id === focusedId;
      const isDim = focusedId && !visibleIds.has(m.id);
      const color = NODE_COLORS[m.type] || NODE_COLORS.unknown;
      const border = NODE_BORDERS[m.type] || NODE_BORDERS.unknown;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', n.x - hw); rect.setAttribute('y', n.y - hh);
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', '5'); rect.setAttribute('fill', color);
      rect.setAttribute('stroke', isFocused ? '#f5a623' : border);
      rect.setAttribute('stroke-width', isFocused ? '2.5' : '1');
      rect.setAttribute('opacity', isDim ? '0.15' : '1');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => onNodeClick(m.id));

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', n.x); text.setAttribute('y', n.y + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', 'white');
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('opacity', isDim ? '0.15' : '1');
      text.textContent = m.id;

      nodeGroup.appendChild(rect);
      nodeGroup.appendChild(text);
    });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function onNodeClick(id) {
    focusedId = focusedId === id ? null : id;
    updateExplorer();
    render();
  }

  function onEdgeClick(from, to) {
    const detail = document.getElementById('edge-detail');
    detail.innerHTML = `<strong>Edge: ${from} → ${to}</strong><br/><em>Class-level inspection available in the IDE plugin.</em>`;
  }

  // ── Explorer panel ─────────────────────────────────────────────────────────
  let explorerMode = 'type'; // 'type' | 'path'

  function updateExplorer() {
    const list = document.getElementById('explorer-list');
    const filterVal = document.getElementById('explorer-filter').value.toLowerCase();
    const { modules } = data;
    const filtered = modules.filter(m => m.id.toLowerCase().includes(filterVal));
    list.innerHTML = '';

    if (explorerMode === 'type') {
      const grouped = LAYER_ORDER.reduce((acc, type) => {
        const group = filtered.filter(m => m.type === type);
        if (group.length) acc[type] = group;
        return acc;
      }, {});
      Object.entries(grouped).forEach(([type, mods]) => {
        const header = document.createElement('div');
        header.className = 'ex-section';
        header.textContent = `${type.toUpperCase()} (${mods.length})`;
        list.appendChild(header);
        mods.forEach(m => list.appendChild(makeExplorerItem(m)));
      });
    } else {
      // path hierarchy — group by first path segment
      const grouped = {};
      filtered.forEach(m => {
        const parts = m.id.split(':').filter(Boolean);
        const key = parts.length > 1 ? parts[0] : '_root';
        (grouped[key] = grouped[key] || []).push(m);
      });
      Object.entries(grouped).forEach(([group, mods]) => {
        if (group !== '_root') {
          const header = document.createElement('div');
          header.className = 'ex-section';
          header.textContent = `:${group}`;
          list.appendChild(header);
        }
        mods.forEach(m => list.appendChild(makeExplorerItem(m)));
      });
    }
  }

  function makeExplorerItem(m) {
    const item = document.createElement('div');
    item.className = 'ex-item' + (m.id === focusedId ? ' selected' : '');
    item.textContent = m.id;
    item.addEventListener('click', () => onNodeClick(m.id));
    return item;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tab-type').addEventListener('click', () => {
      explorerMode = 'type';
      document.getElementById('tab-type').classList.add('active');
      document.getElementById('tab-path').classList.remove('active');
      updateExplorer();
    });
    document.getElementById('tab-path').addEventListener('click', () => {
      explorerMode = 'path';
      document.getElementById('tab-path').classList.add('active');
      document.getElementById('tab-type').classList.remove('active');
      updateExplorer();
    });
    document.getElementById('explorer-filter').addEventListener('input', updateExplorer);
    document.getElementById('depth-slider').addEventListener('input', e => {
      depthValue = parseInt(e.target.value);
      document.getElementById('depth-value').textContent = depthValue;
      render();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      focusedId = null;
      updateExplorer();
      render();
    });
    updateExplorer();
    render();
  });
})();
```

- [ ] **Step 4: Implement `HtmlReportGenerator.kt`**

```kotlin
package io.github.rcosteira79.depgraph.report

import io.github.rcosteira79.depgraph.model.GraphModel
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

private val json = Json { prettyPrint = false }

object HtmlReportGenerator {

    fun generate(graph: GraphModel, outputFile: File) {
        outputFile.parentFile.mkdirs()
        val graphDataJson = json.encodeToString(graph)
        val visualisationJs = loadResource("graph-template.js")
        outputFile.writeText(buildHtml(graphDataJson, visualisationJs))
    }

    private fun loadResource(name: String): String =
        HtmlReportGenerator::class.java
            .getResourceAsStream("/io/github/rcosteira79/depgraph/report/$name")
            ?.bufferedReader()?.readText()
            ?: error("Resource not found: $name")

    private fun buildHtml(graphDataJson: String, visualisationJs: String): String = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Dependency Graph</title>
          <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1/dist/dagre.min.js"></script>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #121220; color: #ccc; font-family: -apple-system, sans-serif; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
            #toolbar { background: #2b2b2b; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
            .tb-btn { background: #4c5052; border: none; border-radius: 3px; color: #ccc; padding: 4px 12px; font-size: 11px; cursor: pointer; }
            #depth-control { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11px; }
            #main { display: flex; flex: 1; overflow: hidden; }
            #explorer { width: 200px; flex-shrink: 0; border-right: 1px solid #3c3c3c; display: flex; flex-direction: column; background: #1e1e1e; }
            #explorer-tabs { display: flex; border-bottom: 1px solid #3c3c3c; }
            .ex-tab { flex: 1; text-align: center; padding: 6px; font-size: 11px; color: #888; cursor: pointer; border-bottom: 2px solid transparent; }
            .ex-tab.active { color: #4fc3f7; border-bottom-color: #4fc3f7; }
            #explorer-filter { margin: 6px; background: #2a2a2a; border: none; border-radius: 3px; color: #ccc; padding: 5px 8px; font-size: 11px; width: calc(100% - 12px); outline: none; }
            #explorer-list { flex: 1; overflow-y: auto; }
            .ex-section { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 1px; padding: 8px 8px 2px; }
            .ex-item { padding: 4px 10px; cursor: pointer; border-left: 2px solid transparent; font-family: monospace; font-size: 10px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ex-item:hover { background: #272727; }
            .ex-item.selected { background: #0d3a5e; border-left-color: #4fc3f7; color: #4fc3f7; }
            #graph-container { flex: 1; overflow: auto; position: relative; }
            #detail { width: 200px; flex-shrink: 0; border-left: 1px solid #3c3c3c; background: #1e1e1e; padding: 10px; font-size: 11px; overflow-y: auto; }
            #edge-detail { color: #aaa; font-size: 10px; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div id="toolbar">
            <span style="font-weight:bold;color:#4fc3f7">◈ Dependency Graph</span>
            <button class="tb-btn" id="btn-reset">↺ Reset</button>
            <div id="depth-control">
              Depth <input id="depth-slider" type="range" min="1" max="5" value="2" style="width:80px">
              <span id="depth-value" style="color:#4fc3f7;font-weight:bold">2</span>
            </div>
          </div>
          <div id="main">
            <div id="explorer">
              <div id="explorer-tabs">
                <div class="ex-tab active" id="tab-type">By Type</div>
                <div class="ex-tab" id="tab-path">By Path</div>
              </div>
              <input id="explorer-filter" placeholder="🔍 Filter…">
              <div id="explorer-list"></div>
            </div>
            <div id="graph-container">
              <svg id="graph-svg">
                <defs>
                  <marker id="arrow-rel" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="rgba(255,255,255,0.35)"/>
                  </marker>
                  <marker id="arrow-lit" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#f5a623"/>
                  </marker>
                </defs>
                <g id="edges"></g>
                <g id="nodes"></g>
              </svg>
            </div>
            <div id="detail">
              <div id="edge-detail" style="color:#555;font-size:10px">Click an edge to inspect it.</div>
            </div>
          </div>
          <script>window.__GRAPH_DATA__ = $graphDataJson;</script>
          <script>$visualisationJs</script>
        </body>
        </html>
    """.trimIndent()
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
./gradlew test --tests "*.HtmlReportGeneratorTest"
```
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add gradle-plugin/src/
git commit -m "feat: implement html report generator"
```

---

## Task 7: Gradle task and plugin wiring

**Files:**
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/GenerateDependencyGraphTask.kt`
- Modify: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt`

- [ ] **Step 1: Implement `GenerateDependencyGraphTask.kt`**

```kotlin
package io.github.rcosteira79.depgraph

import io.github.rcosteira79.depgraph.analysis.ModuleAnalyser
import io.github.rcosteira79.depgraph.report.HtmlReportGenerator
import io.github.rcosteira79.depgraph.serialisation.GraphSerializer
import org.gradle.api.DefaultTask
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import java.io.File

abstract class GenerateDependencyGraphTask : DefaultTask() {

    @get:OutputDirectory
    val outputDir: File
        get() = project.layout.buildDirectory.dir("dep-graph").get().asFile

    @TaskAction
    fun generate() {
        val graph = ModuleAnalyser.analyse(project.rootProject)
        GraphSerializer.serialize(graph, File(outputDir, "graph.json"))
        HtmlReportGenerator.generate(graph, File(outputDir, "index.html"))
        logger.lifecycle("Dependency graph written to ${outputDir.absolutePath}")
    }
}
```

- [ ] **Step 2: Update `DependencyGraphPlugin.kt` to register the task and extension**

```kotlin
package io.github.rcosteira79.depgraph

import org.gradle.api.Plugin
import org.gradle.api.Project

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        // Register the DSL extension on every (sub)project so modules can override their type
        target.allprojects { project ->
            project.extensions.create("dependencyGraph", DependencyGraphExtension::class.java)
        }
        // Register the task only on the root project
        if (target == target.rootProject) {
            target.tasks.register("generateDependencyGraph", GenerateDependencyGraphTask::class.java) { task ->
                task.group = "reporting"
                task.description = "Generates the module dependency graph report"
            }
        }
    }
}
```

- [ ] **Step 3: Verify the project builds cleanly**

```bash
./gradlew build
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add gradle-plugin/src/
git commit -m "feat: wire gradle task and plugin entry point"
```

---

## Task 8: Integration test

**Files:**
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/integration/GenerateDependencyGraphTaskTest.kt`
- Create: `gradle-plugin/src/test/resources/fixture-project/settings.gradle.kts`
- Create: `gradle-plugin/src/test/resources/fixture-project/build.gradle.kts`
- Create: `gradle-plugin/src/test/resources/fixture-project/app/build.gradle.kts`
- Create: `gradle-plugin/src/test/resources/fixture-project/core-ui/build.gradle.kts`

- [ ] **Step 1: Create the fixture project**

`fixture-project/settings.gradle.kts`:
```kotlin
rootProject.name = "fixture"
include(":app", ":core-ui")
```

`fixture-project/build.gradle.kts`:
```kotlin
plugins {
    id("io.github.rcosteira79.dependency-graph")
}
```

`fixture-project/app/build.gradle.kts`:
```kotlin
plugins { id("java-library") }
dependencies { implementation(project(":core-ui")) }
```

`fixture-project/core-ui/build.gradle.kts`:
```kotlin
plugins { id("java-library") }
```

- [ ] **Step 2: Write the integration test**

```kotlin
// GenerateDependencyGraphTaskTest.kt
package io.github.rcosteira79.depgraph.integration

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

class GenerateDependencyGraphTaskTest {

    @Test
    fun `task runs successfully and produces graph json`(@TempDir tempDir: Path) {
        copyFixture("fixture-project", tempDir.toFile())

        val result = GradleRunner.create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph", "--stacktrace")
            .build()

        assertEquals(TaskOutcome.SUCCESS, result.task(":generateDependencyGraph")?.outcome)

        val graphJson = File(tempDir.toFile(), "build/dep-graph/graph.json")
        assertTrue(graphJson.exists(), "graph.json should exist")

        val parsed = Json.parseToJsonElement(graphJson.readText()).jsonObject
        assertEquals(1, parsed["schemaVersion"]?.jsonPrimitive?.content?.toInt())

        val moduleIds = parsed["modules"]!!.jsonArray.map {
            it.jsonObject["id"]!!.jsonPrimitive.content
        }
        assertTrue(moduleIds.contains(":app"))
        assertTrue(moduleIds.contains(":core-ui"))

        val edges = parsed["edges"]!!.jsonArray
        assertEquals(1, edges.size)
        assertEquals(":app", edges[0].jsonObject["from"]!!.jsonPrimitive.content)
        assertEquals(":core-ui", edges[0].jsonObject["to"]!!.jsonPrimitive.content)
    }

    @Test
    fun `task also produces index html`(@TempDir tempDir: Path) {
        copyFixture("fixture-project", tempDir.toFile())
        GradleRunner.create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph")
            .build()

        val htmlFile = File(tempDir.toFile(), "build/dep-graph/index.html")
        assertTrue(htmlFile.exists(), "index.html should exist")
        assertTrue(htmlFile.readText().contains("window.__GRAPH_DATA__"))
    }

    private fun copyFixture(fixtureName: String, dest: File) {
        val fixtureDir = File(javaClass.classLoader.getResource(fixtureName)!!.toURI())
        fixtureDir.copyRecursively(dest, overwrite = true)
    }
}
```

- [ ] **Step 3: Run the integration test**

```bash
./gradlew test --tests "*.GenerateDependencyGraphTaskTest"
```
Expected: 2 tests PASS

- [ ] **Step 4: Commit**

```bash
git add gradle-plugin/src/test/
git commit -m "test: add integration test for generateDependencyGraph task"
```

---

## Task 9: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```bash
./gradlew test
```
Expected: ALL PASS — ModuleTypeInferrerTest (11), ModuleAnalyserTest (4), GraphSerializerTest (3), HtmlReportGeneratorTest (4), GenerateDependencyGraphTaskTest (2)

- [ ] **Step 2: Manually verify the standalone HTML**

Apply the plugin to any local multi-module Android project, run `./gradlew generateDependencyGraph`, and open `build/dep-graph/index.html` in a browser. Verify:
- Modules appear as rectangular nodes in a layered layout
- Edges point in the right direction and do not touch node borders
- Clicking a node focuses it; unrelated nodes are dimmed
- Depth slider changes visible depth
- Both explorer views (By Type / By Path) work
- Filter input filters the list

- [ ] **Step 3: Commit any fixes found during manual verification**

```bash
git add gradle-plugin/src/
git commit -m "fix: address issues found during manual html verification"
```

---

## Task 10: Publishing configuration

**Files:**
- Modify: `gradle-plugin/build.gradle.kts`

- [ ] **Step 1: Add publishing metadata to `build.gradle.kts`**

The `gradlePlugin` block already has the plugin metadata from Task 1. Add the `publishing` block to configure the Gradle Plugin Portal credentials:

```kotlin
// Add to build.gradle.kts
publishing {
    repositories {
        // Local repository for testing publication before pushing to the portal
        maven {
            name = "local"
            url = uri(layout.buildDirectory.dir("local-repo"))
        }
    }
}
```

The actual `gradle.publish.key` and `gradle.publish.secret` credentials are provided at publish time via `~/.gradle/gradle.properties` — never committed to the repo.

- [ ] **Step 2: Verify local publication works**

```bash
./gradlew publishToMavenLocal
```
Expected: BUILD SUCCESSFUL, plugin JAR published to `~/.m2/repository`

- [ ] **Step 3: Confirm credentials are kept outside the repo**

Publish credentials (`gradle.publish.key` and `gradle.publish.secret`) must live in `~/.gradle/gradle.properties` — a global user file that is never inside the project directory and therefore never committed. No `.gitignore` entry is needed. Do **not** add them anywhere inside the `gradle-plugin/` directory.

- [ ] **Step 4: Commit**

```bash
git add gradle-plugin/build.gradle.kts .gitignore
git commit -m "chore: configure plugin publication"
```

---

## Done

Plan 2 (IDE Plugin + Visualisation) covers the Android Studio tool window, JCEF integration, PSI-based class/package analysis, and the cross-module edge inspector.
