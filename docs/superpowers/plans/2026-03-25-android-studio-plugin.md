# Android Studio Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Android Studio plugin with a JCEF-embedded dependency graph tool window — a module view (reusing existing HTML/JS) and a class-level drill-down view.

**Architecture:** IntelliJ Platform Gradle project targeting Android Studio. Analysis runs via `ReadAction.nonBlocking()` using `ModuleManager`/PSI APIs. Two JCEF browser tabs communicate with Kotlin via `JBCefJSQuery` bridges. All HTML is loaded as a string via `loadHTML()` with JS inlined (no relative resource paths).

**Tech Stack:** Kotlin, IntelliJ Platform SDK (ModuleManager, FacetManager, JavaPsiFacade, PSI), JCEF (JBCefBrowser, JBCefJSQuery), D3.js v7 (CDN), dagre (CDN), kotlinx-serialization-json

---

## File Map

All new files live under `android-studio-plugin/`. Base package: `io.github.rcosteira79.depgraph.plugin`.

| File | Responsibility |
|---|---|
| `build.gradle.kts` | IntelliJ Platform Gradle plugin 2.x setup |
| `gradle.properties` | Platform version, plugin metadata |
| `settings.gradle.kts` | Project name |
| `src/main/resources/META-INF/plugin.xml` | Tool window declaration |
| `src/main/resources/.../graph-template.js` | Copy of existing visualisation JS (inlined at runtime) |
| `src/main/resources/.../class-view.js` | New class graph visualisation JS (inlined at runtime) |
| `src/main/kotlin/.../model/GraphModel.kt` | GraphModel, Module, Edge, ModuleType (same shape as gradle-plugin, with @Serializable) |
| `src/main/kotlin/.../model/ClassGraphData.kt` | ClassGraphData, ClassNode, ClassEdge, ExternalDep |
| `src/main/kotlin/.../analysis/ModuleTypeInferrer.kt` | Copy of Gradle plugin's ModuleTypeInferrer (package only changed) |
| `src/main/kotlin/.../analysis/ModuleIdConverter.kt` | IntelliJ Module → Gradle `:path` string |
| `src/main/kotlin/.../analysis/ModuleGraphAnalyser.kt` | ModuleManager → GraphModel |
| `src/main/kotlin/.../analysis/ClassDependencyAnalyser.kt` | PSI → ClassGraphData |
| `src/main/kotlin/.../bridge/MessageParser.kt` | JSON field parsing helpers (no JCEF dependency) |
| `src/main/kotlin/.../bridge/ModuleViewBridge.kt` | Handles messages from module-view JS |
| `src/main/kotlin/.../bridge/ClassViewBridge.kt` | Handles messages from class-view JS |
| `src/main/kotlin/.../report/HtmlBuilder.kt` | Builds final HTML strings with inlined JS and data |
| `src/main/kotlin/.../toolwindow/DependencyGraphToolWindowFactory.kt` | Creates tool window |
| `src/main/kotlin/.../toolwindow/DependencyGraphToolWindow.kt` | JBTabbedPane, JCEF lifecycle, analysis orchestration |
| `src/test/kotlin/.../model/ClassGraphDataTest.kt` | Serialization roundtrip tests |
| `src/test/kotlin/.../analysis/ModuleTypeInferrerTest.kt` | Copied from gradle-plugin |
| `src/test/kotlin/.../analysis/ModuleIdConverterTest.kt` | Path conversion tests |
| `src/test/kotlin/.../analysis/ModuleGraphAnalyserTest.kt` | BasePlatformTestCase with mock modules |
| `src/test/kotlin/.../analysis/ClassDependencyAnalyserTest.kt` | LightJavaCodeInsightFixtureTestCase |
| `src/test/kotlin/.../bridge/ModuleViewBridgeTest.kt` | Message handler unit tests |
| `src/test/kotlin/.../bridge/ClassViewBridgeTest.kt` | Message handler unit tests |

---

## Task 1: Project scaffolding

**Files:**
- Create: `android-studio-plugin/settings.gradle.kts`
- Create: `android-studio-plugin/gradle.properties`
- Create: `android-studio-plugin/build.gradle.kts`
- Create: `android-studio-plugin/src/main/resources/META-INF/plugin.xml`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p android-studio-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/plugin/{model,analysis,bridge,report,toolwindow}
mkdir -p android-studio-plugin/src/main/resources/META-INF
mkdir -p android-studio-plugin/src/main/resources/io/github/rcosteira79/depgraph/plugin
mkdir -p android-studio-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/plugin/{model,analysis,bridge}
```

- [ ] **Step 2: Create `android-studio-plugin/settings.gradle.kts`**

```kotlin
rootProject.name = "dependency-graph-android-studio-plugin"
```

- [ ] **Step 3: Create `android-studio-plugin/gradle.properties`**

```properties
pluginGroup=io.github.rcosteira79
pluginVersion=1.0.0
pluginSinceBuild=242
pluginUntilBuild=251.*
platformVersion=2024.2.1.12
```

- [ ] **Step 4: Create `android-studio-plugin/build.gradle.kts`**

```kotlin
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        androidStudio(providers.gradleProperty("platformVersion").get())
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.kotlin")
        testFramework(TestFrameworkType.Platform)
    }
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

intellijPlatform {
    pluginConfiguration {
        name = "Dependency Graph"
        version = providers.gradleProperty("pluginVersion").get()
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild").get()
            untilBuild = providers.gradleProperty("pluginUntilBuild").get()
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
```

- [ ] **Step 5: Create `src/main/resources/META-INF/plugin.xml`**

```xml
<idea-plugin>
  <id>io.github.rcosteira79.dependency-graph</id>
  <name>Dependency Graph</name>
  <vendor>rcosteira79</vendor>
  <description>Visualises your Android multi-module dependency architecture</description>

  <depends>com.intellij.modules.platform</depends>
  <depends>com.intellij.java</depends>
  <depends>org.jetbrains.kotlin</depends>

  <extensions defaultExtensionNs="com.intellij">
    <toolWindow
      id="Dependency Graph"
      anchor="right"
      factoryClass="io.github.rcosteira79.depgraph.plugin.toolwindow.DependencyGraphToolWindowFactory"
    />
  </extensions>
</idea-plugin>
```

- [ ] **Step 6: Verify the project syncs**

```bash
cd android-studio-plugin && ./gradlew dependencies --configuration runtimeClasspath 2>&1 | tail -20
```

Expected: resolves without errors; IntelliJ/Android Studio classes on classpath.

- [ ] **Step 7: Commit**

```bash
cd android-studio-plugin && git add . && git commit -m "chore: scaffold android studio plugin project"
```

---

## Task 2: Data models

**Files:**
- Create: `src/main/kotlin/.../model/GraphModel.kt`
- Create: `src/main/kotlin/.../model/ClassGraphData.kt`
- Create: `src/test/kotlin/.../model/ClassGraphDataTest.kt`

- [ ] **Step 1: Write failing test**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/model/ClassGraphDataTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ClassGraphDataTest {
    private val json = Json { prettyPrint = false }

    @Test
    fun `serialises and deserialises ClassGraphData`() {
        val inputData = ClassGraphData(
            inspectedModuleId = ":feature:login",
            classes = listOf(ClassNode(id = "com.example.LoginFragment", name = "LoginFragment", qualifiedName = "com.example.LoginFragment")),
            internalEdges = listOf(ClassEdge(from = "com.example.LoginFragment", to = "com.example.LoginViewModel")),
            externalDeps = listOf(ExternalDep(sourceClassId = "com.example.LoginFragment", targetModuleId = ":core:ui", targetClassId = "com.example.ui.Button")),
        )

        val actualJson = json.encodeToString(inputData)
        val actualDecoded = json.decodeFromString<ClassGraphData>(actualJson)

        assertEquals(inputData, actualDecoded)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
./gradlew test --tests "*.model.ClassGraphDataTest"
```

Expected: FAIL — `ClassGraphData not found`

- [ ] **Step 3: Create `GraphModel.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.model

import kotlinx.serialization.Serializable

@Serializable
data class GraphModel(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val modules: List<Module>,
    val edges: List<Edge>,
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION: Int = 1
    }
}

@Serializable
data class Module(
    val id: String,
    val type: String,
    val path: String,
)

@Serializable
data class Edge(
    val from: String,
    val to: String,
    val configuration: String,
)

enum class ModuleType {
    APP, FEATURE, CORE, DATA, UNKNOWN
}
```

- [ ] **Step 4: Create `ClassGraphData.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.model

import kotlinx.serialization.Serializable

@Serializable
data class ClassGraphData(
    val inspectedModuleId: String,
    val classes: List<ClassNode>,
    val internalEdges: List<ClassEdge>,
    val externalDeps: List<ExternalDep>,
)

@Serializable
data class ClassNode(
    val id: String,
    val name: String,
    val qualifiedName: String,
)

@Serializable
data class ClassEdge(
    val from: String,
    val to: String,
)

@Serializable
data class ExternalDep(
    val sourceClassId: String,
    val targetModuleId: String,
    val targetClassId: String,
)
```

- [ ] **Step 5: Run tests to verify pass**

```bash
./gradlew test --tests "*.model.ClassGraphDataTest"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add plugin data models"
```

---

## Task 3: ModuleTypeInferrer + ModuleIdConverter

**Files:**
- Create: `src/main/kotlin/.../analysis/ModuleTypeInferrer.kt`
- Create: `src/main/kotlin/.../analysis/ModuleIdConverter.kt`
- Create: `src/test/kotlin/.../analysis/ModuleTypeInferrerTest.kt`
- Create: `src/test/kotlin/.../analysis/ModuleIdConverterTest.kt`

- [ ] **Step 1: Write failing tests for ModuleIdConverter**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/analysis/ModuleIdConverterTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModuleIdConverterTest {
    @Test
    fun `converts top-level module to gradle id`() {
        assertEquals(":app", ModuleIdConverter.toGradlePath("app"))
    }

    @Test
    fun `converts nested module to gradle id`() {
        assertEquals(":feature:login", ModuleIdConverter.toGradlePath("feature/login"))
    }

    @Test
    fun `empty path returns root`() {
        assertEquals(":", ModuleIdConverter.toGradlePath(""))
    }

    @Test
    fun `buildSrc is excluded`() {
        assertTrue(ModuleIdConverter.isExcluded("buildSrc"))
    }

    @Test
    fun `regular module is not excluded`() {
        assertTrue(!ModuleIdConverter.isExcluded("app"))
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
./gradlew test --tests "*.analysis.ModuleIdConverterTest"
```

- [ ] **Step 3: Create `ModuleIdConverter.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

private val EXCLUDED_MODULES: Set<String> = setOf("buildSrc")

object ModuleIdConverter {
    /**
     * Converts a module's path relative to the project root into a Gradle module ID.
     * e.g. "feature/login" → ":feature:login", "app" → ":app"
     */
    fun toGradlePath(relativeModulePath: String): String =
        ":" + relativeModulePath.trimStart('/').replace("/", ":")

    fun isExcluded(moduleName: String): Boolean = moduleName in EXCLUDED_MODULES
}
```

- [ ] **Step 4: Copy `ModuleTypeInferrer` from the Gradle plugin**

Create `src/main/kotlin/io/github/rcosteira79/depgraph/plugin/analysis/ModuleTypeInferrer.kt`.

Copy the file verbatim from `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleTypeInferrer.kt`, changing only:
- Package declaration: `package io.github.rcosteira79.depgraph.plugin.analysis`
- Import for ModuleType: `import io.github.rcosteira79.depgraph.plugin.model.ModuleType`

- [ ] **Step 5: Copy ModuleTypeInferrer tests**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/analysis/ModuleTypeInferrerTest.kt`.

Copy from `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ModuleTypeInferrerTest.kt`, changing only the package and import lines.

- [ ] **Step 6: Run all analysis tests**

```bash
./gradlew test --tests "*.analysis.*"
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add ModuleTypeInferrer and ModuleIdConverter"
```

---

## Task 4: Bridge message handlers

**Files:**
- Create: `src/main/kotlin/.../bridge/MessageParser.kt`
- Create: `src/main/kotlin/.../bridge/ModuleViewBridge.kt`
- Create: `src/main/kotlin/.../bridge/ClassViewBridge.kt`
- Create: `src/test/kotlin/.../bridge/ModuleViewBridgeTest.kt`
- Create: `src/test/kotlin/.../bridge/ClassViewBridgeTest.kt`

Bridges are pure Kotlin — no JCEF dependency. They accept callbacks so they can be tested without any IDE context.

- [ ] **Step 1: Write failing tests for ModuleViewBridge**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/bridge/ModuleViewBridgeTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.bridge

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ModuleViewBridgeTest {
    @Test
    fun `viewClasses action calls onViewClasses with moduleId`() {
        var actualModuleId: String? = null
        val inputMessage = """{"action":"viewClasses","moduleId":":feature:login"}"""
        val bridge = ModuleViewBridge(
            onViewClasses = { moduleId -> actualModuleId = moduleId },
            onRevealInProject = {},
        )

        bridge.handleMessage(inputMessage)

        assertEquals(":feature:login", actualModuleId)
    }

    @Test
    fun `revealInProject action calls onRevealInProject with moduleId`() {
        var actualModuleId: String? = null
        val inputMessage = """{"action":"revealInProject","moduleId":":app"}"""
        val bridge = ModuleViewBridge(
            onViewClasses = {},
            onRevealInProject = { moduleId -> actualModuleId = moduleId },
        )

        bridge.handleMessage(inputMessage)

        assertEquals(":app", actualModuleId)
    }

    @Test
    fun `unknown action is silently ignored`() {
        val bridge = ModuleViewBridge(onViewClasses = {}, onRevealInProject = {})
        bridge.handleMessage("""{"action":"unknownAction","moduleId":":app"}""")
        // no exception expected
    }
}
```

- [ ] **Step 2: Write failing tests for ClassViewBridge**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/bridge/ClassViewBridgeTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.bridge

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ClassViewBridgeTest {
    @Test
    fun `goToClass action calls onGoToClass with qualified name`() {
        var actualName: String? = null
        val inputMessage = """{"action":"goToClass","qualifiedName":"com.example.LoginFragment"}"""
        val bridge = ClassViewBridge(
            onGoToClass = { name -> actualName = name },
            onViewClasses = { _, _ -> },
            onViewModuleGraph = {},
            onExpandModule = { _, _ -> "" },
        )

        bridge.handleMessage(inputMessage)

        assertEquals("com.example.LoginFragment", actualName)
    }

    @Test
    fun `expandModule action returns response from onExpandModule`() {
        val expectedResponse = """{"action":"expandedModule","moduleId":":core:ui"}"""
        val inputMessage = """{"action":"expandModule","moduleId":":core:ui","inspectedModuleId":":feature:login"}"""
        val bridge = ClassViewBridge(
            onGoToClass = {},
            onViewClasses = { _, _ -> },
            onViewModuleGraph = {},
            onExpandModule = { _, _ -> expectedResponse },
        )

        val actualResponse = bridge.handleMessage(inputMessage)

        assertEquals(expectedResponse, actualResponse)
    }

    @Test
    fun `goToClass returns null (no response needed)`() {
        val bridge = ClassViewBridge(
            onGoToClass = {},
            onViewClasses = { _, _ -> },
            onViewModuleGraph = {},
            onExpandModule = { _, _ -> "" },
        )

        val actualResult = bridge.handleMessage("""{"action":"goToClass","qualifiedName":"com.example.Foo"}""")

        assertNull(actualResult)
    }
}
```

- [ ] **Step 3: Run to verify failure**

```bash
./gradlew test --tests "*.bridge.*"
```

- [ ] **Step 4: Create `MessageParser.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

private val json = Json { ignoreUnknownKeys = true }

internal fun parseAction(message: String): String? =
    runCatching {
        json.decodeFromString<JsonObject>(message)["action"]?.jsonPrimitive?.content
    }.getOrNull()

internal fun parseStringField(message: String, field: String): String? =
    runCatching {
        json.decodeFromString<JsonObject>(message)[field]?.jsonPrimitive?.content
    }.getOrNull()
```

- [ ] **Step 5: Create `ModuleViewBridge.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.bridge

class ModuleViewBridge(
    private val onViewClasses: (moduleId: String) -> Unit,
    private val onRevealInProject: (moduleId: String) -> Unit,
) {
    fun handleMessage(message: String) {
        val action: String = parseAction(message) ?: return
        val moduleId: String = parseStringField(message, "moduleId") ?: return
        when (action) {
            "viewClasses" -> onViewClasses(moduleId)
            "revealInProject" -> onRevealInProject(moduleId)
        }
    }
}
```

- [ ] **Step 6: Create `ClassViewBridge.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.bridge

class ClassViewBridge(
    private val onGoToClass: (qualifiedName: String) -> Unit,
    private val onViewClasses: (moduleId: String, inspectedModuleId: String) -> Unit,
    private val onViewModuleGraph: (moduleId: String) -> Unit,
    private val onExpandModule: (moduleId: String, inspectedModuleId: String) -> String,
) {
    /** Returns a JSON response string for actions that need one (expandModule), null otherwise. */
    fun handleMessage(message: String): String? {
        val action: String = parseAction(message) ?: return null
        return when (action) {
            "goToClass" -> {
                val qualifiedName: String = parseStringField(message, "qualifiedName") ?: return null
                onGoToClass(qualifiedName)
                null
            }
            "viewClasses" -> {
                val moduleId: String = parseStringField(message, "moduleId") ?: return null
                val inspectedModuleId: String = parseStringField(message, "inspectedModuleId") ?: return null
                onViewClasses(moduleId, inspectedModuleId)
                null
            }
            "viewModuleGraph" -> {
                val moduleId: String = parseStringField(message, "moduleId") ?: return null
                onViewModuleGraph(moduleId)
                null
            }
            "expandModule" -> {
                val moduleId: String = parseStringField(message, "moduleId") ?: return null
                val inspectedModuleId: String = parseStringField(message, "inspectedModuleId") ?: return null
                onExpandModule(moduleId, inspectedModuleId)
            }
            else -> null
        }
    }
}
```

- [ ] **Step 7: Run tests**

```bash
./gradlew test --tests "*.bridge.*"
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat: add bridge message handlers"
```

---

## Task 5: ModuleGraphAnalyser

**Files:**
- Create: `src/main/kotlin/.../analysis/ModuleGraphAnalyser.kt`
- Create: `src/test/kotlin/.../analysis/ModuleGraphAnalyserTest.kt`

Note: IntelliJ test fixtures extend JUnit 3 `TestCase`. Use `fun testXxx()` naming and JUnit 3 `assertEquals`. Do NOT use JUnit 5 `@Test` annotations in `BasePlatformTestCase` subclasses.

- [ ] **Step 1: Write failing test**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/analysis/ModuleGraphAnalyserTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import io.github.rcosteira79.depgraph.plugin.model.GraphModel

class ModuleGraphAnalyserTest : BasePlatformTestCase() {
    fun `test analyse returns at least one module for light project`() {
        // Given: the default BasePlatformTestCase light project (has one module)
        val analyser = ModuleGraphAnalyser(project)

        // When:
        val actualModel: GraphModel = analyser.analyse()

        // Then:
        assertTrue("Expected at least one module", actualModel.modules.isNotEmpty())
    }

    fun `test modules have non-empty ids`() {
        val analyser = ModuleGraphAnalyser(project)

        val actualModel: GraphModel = analyser.analyse()

        actualModel.modules.forEach { module ->
            assertTrue("Module id should not be blank", module.id.isNotBlank())
            assertTrue("Module id should start with :", module.id.startsWith(":"))
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
./gradlew test --tests "*.analysis.ModuleGraphAnalyserTest"
```

- [ ] **Step 3: Create `ModuleGraphAnalyser.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.DependencyScope
import com.intellij.openapi.roots.ModuleOrderEntry
import com.intellij.openapi.roots.ModuleRootManager
import io.github.rcosteira79.depgraph.plugin.model.Edge
import io.github.rcosteira79.depgraph.plugin.model.GraphModel
import io.github.rcosteira79.depgraph.plugin.model.Module as PluginModule

private val SCOPE_TO_CONFIGURATION: Map<DependencyScope, String> = mapOf(
    DependencyScope.COMPILE to "implementation",
    DependencyScope.PROVIDED to "compileOnly",
    DependencyScope.RUNTIME to "implementation",
    DependencyScope.TEST to "implementation",
)

class ModuleGraphAnalyser(private val project: Project) {
    fun analyse(): GraphModel {
        val projectBasePath: String = project.basePath ?: ""
        val allModules: List<Module> = ModuleManager.getInstance(project).modules
            .filter { module -> !ModuleIdConverter.isExcluded(module.name) }

        val moduleIds: Set<String> = allModules.map { module ->
            module.toGradlePath(projectBasePath)
        }.toSet()

        val pluginModules: List<PluginModule> = allModules.map { module ->
            module.toPluginModule(projectBasePath)
        }
        val edges: List<Edge> = allModules.flatMap { module ->
            module.collectEdges(projectBasePath, moduleIds)
        }

        return GraphModel(modules = pluginModules, edges = edges)
    }

    private fun Module.toGradlePath(projectBasePath: String): String {
        val relativePath: String = moduleFilePath
            .removeSuffix("/${name}.iml")
            .removePrefix(projectBasePath)
            .trimStart('/')
        return ModuleIdConverter.toGradlePath(relativePath)
    }

    private fun Module.toPluginModule(projectBasePath: String): PluginModule {
        val gradlePath: String = toGradlePath(projectBasePath)
        val pluginIds: Set<String> = appliedKnownPluginIds()
        val inferredType = ModuleTypeInferrer.infer(
            pluginIds = pluginIds,
            modulePath = gradlePath,
            moduleName = name,
        )
        val relativePath: String = moduleFilePath
            .removeSuffix("/${name}.iml")
            .removePrefix(projectBasePath)
            .trimStart('/')
        return PluginModule(
            id = gradlePath,
            type = inferredType.name.lowercase(),
            path = relativePath,
        )
    }

    private fun Module.collectEdges(
        projectBasePath: String,
        moduleIds: Set<String>,
    ): List<Edge> {
        val fromId: String = toGradlePath(projectBasePath)
        return ModuleRootManager.getInstance(this)
            .orderEntries
            .filterIsInstance<ModuleOrderEntry>()
            .filter { entry -> !ModuleIdConverter.isExcluded(entry.moduleName ?: "") }
            .mapNotNull { entry ->
                val depModule: Module = entry.module ?: return@mapNotNull null
                val toId: String = depModule.toGradlePath(projectBasePath)
                if (toId !in moduleIds) return@mapNotNull null
                Edge(
                    from = fromId,
                    to = toId,
                    configuration = SCOPE_TO_CONFIGURATION[entry.scope] ?: "implementation",
                )
            }
    }

    private fun Module.appliedKnownPluginIds(): Set<String> {
        // Use AndroidFacet to determine Android plugin type
        val androidFacet = try {
            com.android.tools.idea.facets.AndroidFacet.getInstance(this)
        } catch (e: NoClassDefFoundError) {
            null
        }
        return buildSet {
            when {
                androidFacet != null && androidFacet.configuration.isAppProject ->
                    add("com.android.application")
                androidFacet != null ->
                    add("com.android.library")
                else -> {
                    // Assume Kotlin JVM for modules without Android facet
                    add("org.jetbrains.kotlin.jvm")
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
./gradlew test --tests "*.analysis.ModuleGraphAnalyserTest"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: add ModuleGraphAnalyser"
```

---

## Task 6: ClassDependencyAnalyser

**Files:**
- Create: `src/main/kotlin/.../analysis/ClassDependencyAnalyser.kt`
- Create: `src/test/kotlin/.../analysis/ClassDependencyAnalyserTest.kt`

Note: Uses `LightJavaCodeInsightFixtureTestCase` (JUnit 3 style, `fun testXxx()`).

- [ ] **Step 1: Write failing tests**

Create `src/test/kotlin/io/github/rcosteira79/depgraph/plugin/analysis/ClassDependencyAnalyserTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase
import io.github.rcosteira79.depgraph.plugin.model.ClassGraphData

class ClassDependencyAnalyserTest : LightJavaCodeInsightFixtureTestCase() {
    fun `test detects cross-module dependency from import`() {
        // Given:
        myFixture.addFileToProject(
            "src/com/example/LoginFragment.java",
            """
            package com.example;
            import com.example.ui.Button;
            public class LoginFragment { private Button button; }
            """.trimIndent(),
        )
        // Button lives in a separate physical file simulating another module
        // For the light test we verify the analyser collects classes and finds refs
        // The module boundary test requires a multi-module fixture (covered in integration)
        val analyser = ClassDependencyAnalyser(project)

        // When: analyse the only module in this light project
        val allModules = com.intellij.openapi.module.ModuleManager.getInstance(project).modules
        val moduleId = allModules.first().let { m ->
            ModuleIdConverter.toGradlePath(
                m.moduleFilePath.removeSuffix("/${m.name}.iml")
                    .removePrefix(project.basePath ?: "").trimStart('/')
            )
        }
        val actualData: ClassGraphData = analyser.analyse(moduleId)

        // Then: LoginFragment is collected
        assertTrue("Expected LoginFragment in classes",
            actualData.classes.any { it.qualifiedName == "com.example.LoginFragment" })
    }

    fun `test resolves inner class reference to outer class`() {
        // Given:
        myFixture.addFileToProject(
            "src/com/example/Theme.java",
            """
            package com.example;
            public class Theme { public static class Dark {} }
            """.trimIndent(),
        )
        myFixture.addFileToProject(
            "src/com/example/LoginActivity.java",
            """
            package com.example;
            import com.example.Theme.Dark;
            public class LoginActivity { private Dark theme; }
            """.trimIndent(),
        )

        val analyser = ClassDependencyAnalyser(project)
        val allModules = com.intellij.openapi.module.ModuleManager.getInstance(project).modules
        val moduleId = allModules.first().let { m ->
            ModuleIdConverter.toGradlePath(
                m.moduleFilePath.removeSuffix("/${m.name}.iml")
                    .removePrefix(project.basePath ?: "").trimStart('/')
            )
        }

        // When:
        val actualData: ClassGraphData = analyser.analyse(moduleId)

        // Then: Theme.Dark reference records an internal edge to Theme (outer class), not Theme.Dark
        val darkRef = actualData.internalEdges.find { it.from == "com.example.LoginActivity" }
        assertNotNull("Expected an edge from LoginActivity", darkRef)
        assertEquals("com.example.Theme", darkRef?.to)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
./gradlew test --tests "*.analysis.ClassDependencyAnalyserTest"
```

- [ ] **Step 3: Create `ClassDependencyAnalyser.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.analysis

import com.intellij.ide.highlighter.JavaFileType
import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.module.ModuleUtilCore
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiClass
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiJavaCodeReferenceElement
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiRecursiveElementWalkingVisitor
import com.intellij.psi.search.FileTypeIndex
import com.intellij.psi.search.GlobalSearchScope
import com.intellij.psi.util.PsiTreeUtil
import io.github.rcosteira79.depgraph.plugin.model.ClassEdge
import io.github.rcosteira79.depgraph.plugin.model.ClassGraphData
import io.github.rcosteira79.depgraph.plugin.model.ClassNode
import io.github.rcosteira79.depgraph.plugin.model.ExternalDep
import org.jetbrains.kotlin.idea.KotlinFileType

class ClassDependencyAnalyser(private val project: Project) {
    fun analyse(moduleId: String): ClassGraphData {
        val projectBasePath: String = project.basePath ?: ""
        val targetModule: Module? = ModuleManager.getInstance(project).modules.firstOrNull { module ->
            ModuleIdConverter.toGradlePath(
                module.moduleFilePath
                    .removeSuffix("/${module.name}.iml")
                    .removePrefix(projectBasePath)
                    .trimStart('/')
            ) == moduleId
        }

        if (targetModule == null) {
            return ClassGraphData(
                inspectedModuleId = moduleId,
                classes = emptyList(),
                internalEdges = emptyList(),
                externalDeps = emptyList(),
            )
        }

        val scope: GlobalSearchScope = GlobalSearchScope.moduleScope(targetModule)
        val psiManager: PsiManager = PsiManager.getInstance(project)
        val classes: List<PsiClass> = collectTopLevelClasses(scope, psiManager)
        val classIds: Set<String> = classes.mapNotNull { it.qualifiedName }.toSet()

        val classNodes: List<ClassNode> = classes.mapNotNull { psiClass ->
            val qualifiedName: String = psiClass.qualifiedName ?: return@mapNotNull null
            ClassNode(id = qualifiedName, name = psiClass.name ?: qualifiedName, qualifiedName = qualifiedName)
        }

        val internalEdges: MutableList<ClassEdge> = mutableListOf()
        val externalDeps: MutableList<ExternalDep> = mutableListOf()

        classes.forEach { sourceClass ->
            val sourceId: String = sourceClass.qualifiedName ?: return@forEach
            collectReferencedClasses(sourceClass).forEach { targetClass ->
                val outerTarget: PsiClass = resolveToOuterClass(targetClass)
                val targetId: String = outerTarget.qualifiedName ?: return@forEach
                if (targetId == sourceId) return@forEach

                if (targetId in classIds) {
                    internalEdges += ClassEdge(from = sourceId, to = targetId)
                } else {
                    val targetModule: Module = ModuleUtilCore.findModuleForPsiElement(outerTarget)
                        ?: return@forEach
                    if (ModuleIdConverter.isExcluded(targetModule.name)) return@forEach
                    val targetModuleId: String = ModuleIdConverter.toGradlePath(
                        targetModule.moduleFilePath
                            .removeSuffix("/${targetModule.name}.iml")
                            .removePrefix(projectBasePath)
                            .trimStart('/')
                    )
                    if (targetModuleId == moduleId) return@forEach
                    externalDeps += ExternalDep(
                        sourceClassId = sourceId,
                        targetModuleId = targetModuleId,
                        targetClassId = targetId,
                    )
                }
            }
        }

        return ClassGraphData(
            inspectedModuleId = moduleId,
            classes = classNodes,
            internalEdges = internalEdges.distinct(),
            externalDeps = externalDeps.distinct(),
        )
    }

    private fun collectTopLevelClasses(
        scope: GlobalSearchScope,
        psiManager: PsiManager,
    ): List<PsiClass> {
        val javaFiles = FileTypeIndex.getFiles(JavaFileType.INSTANCE, scope)
        val kotlinFiles = FileTypeIndex.getFiles(KotlinFileType.INSTANCE, scope)
        return (javaFiles + kotlinFiles).flatMap { vFile ->
            val psiFile = psiManager.findFile(vFile) ?: return@flatMap emptyList()
            PsiTreeUtil.findChildrenOfType(psiFile, PsiClass::class.java)
                .filter { psiClass -> psiClass.qualifiedName != null && !psiClass.isAnonymous }
        }
    }

    private fun collectReferencedClasses(psiClass: PsiClass): List<PsiClass> {
        val refs: MutableList<PsiClass> = mutableListOf()
        psiClass.accept(object : PsiRecursiveElementWalkingVisitor() {
            override fun visitElement(element: PsiElement) {
                super.visitElement(element)
                if (element is PsiJavaCodeReferenceElement) {
                    val resolved = element.resolve()
                    if (resolved is PsiClass) refs += resolved
                }
            }
        })
        return refs.distinctBy { it.qualifiedName }
    }

    private fun resolveToOuterClass(psiClass: PsiClass): PsiClass {
        var current: PsiClass = psiClass
        while (current.containingClass != null) {
            current = current.containingClass!!
        }
        return current
    }
}
```

- [ ] **Step 4: Run tests**

```bash
./gradlew test --tests "*.analysis.ClassDependencyAnalyserTest"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: add ClassDependencyAnalyser"
```

---

## Task 7: HTML templates and HtmlBuilder

**Files:**
- Copy: `gradle-plugin/.../graph-template.js` → `src/main/resources/.../graph-template.js`
- Create: `src/main/resources/.../class-view.js`
- Create: `src/main/kotlin/.../report/HtmlBuilder.kt`

All HTML is constructed as a string with JS inlined (same pattern as `HtmlReportGenerator` in the Gradle plugin). No external file references at load time.

- [ ] **Step 1: Copy graph-template.js**

```bash
cp gradle-plugin/src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js \
   android-studio-plugin/src/main/resources/io/github/rcosteira79/depgraph/plugin/graph-template.js
```

- [ ] **Step 2: Create `class-view.js`**

Create `src/main/resources/io/github/rcosteira79/depgraph/plugin/class-view.js`:

```javascript
// Class dependency graph visualisation
// Expects: window.__CLASS_DATA__ (ClassGraphData JSON), window.__bridge__ (JBCefJSQuery bridge)

(function () {
  const data = window.__CLASS_DATA__;
  const expandedModules = new Map(); // moduleId → { classes, highlightedClassIds }
  let useBentArrows = false;

  // ── Bridge ──────────────────────────────────────────────────────
  function postToBridge(message) {
    if (window.__bridge__) window.__bridge__.postMessage(JSON.stringify(message));
  }

  // Called by Kotlin when an expandModule response arrives
  window.__onExpandedModule__ = function (responseJson) {
    const response = JSON.parse(responseJson);
    expandedModules.set(response.moduleId, {
      classes: response.classes,
      highlightedClassIds: response.highlightedClassIds,
    });
    render();
  };

  // ── D3 / zoom ────────────────────────────────────────────────────
  const svg = d3.select('#graph-svg');
  const content = svg.select('#graph-content');
  const zoom = d3.zoom().on('zoom', e => content.attr('transform', e.transform));
  svg.call(zoom);

  // ── Layout ──────────────────────────────────────────────────────
  function buildDagreGraph() {
    const g = new dagre.graphlib.Graph({ multigraph: true })
      .setDefaultEdgeLabel(() => ({}))
      .setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 });

    data.classes.forEach(cls => {
      g.setNode(cls.id, { label: cls.name, width: 160, height: 36, kind: 'class', highlighted: false });
    });

    const externalModuleIds = [...new Set(data.externalDeps.map(d => d.targetModuleId))];
    externalModuleIds.forEach(modId => {
      if (expandedModules.has(modId)) {
        const { classes, highlightedClassIds } = expandedModules.get(modId);
        classes.forEach(cls => {
          g.setNode(cls.id, {
            label: cls.name, width: 160, height: 36, kind: 'class',
            highlighted: highlightedClassIds.includes(cls.qualifiedName || cls.id),
          });
        });
      } else {
        g.setNode(modId, { label: modId + '  +', width: 200, height: 32, kind: 'ext-module' });
      }
    });

    data.internalEdges.forEach(e => {
      if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, { collapsed: false });
    });

    data.externalDeps.forEach(dep => {
      const targetNode = expandedModules.has(dep.targetModuleId) ? dep.targetClassId : dep.targetModuleId;
      if (g.hasNode(dep.sourceClassId) && g.hasNode(targetNode)) {
        g.setEdge(dep.sourceClassId, targetNode, { collapsed: !expandedModules.has(dep.targetModuleId) }, `${dep.sourceClassId}->${targetNode}`);
      }
    });

    dagre.layout(g);
    return g;
  }

  function straightPath(points) {
    if (points.length < 2) return '';
    return `M${points[0].x},${points[0].y}` + points.slice(1).map(p => `L${p.x},${p.y}`).join('');
  }

  function fitView() {
    const bounds = content.node().getBBox();
    if (!bounds.width || !bounds.height) return;
    const svgEl = document.getElementById('graph-svg');
    const scale = Math.min(0.9, Math.min(svgEl.clientWidth / bounds.width, svgEl.clientHeight / bounds.height));
    const tx = (svgEl.clientWidth - bounds.width * scale) / 2 - bounds.x * scale;
    const ty = (svgEl.clientHeight - bounds.height * scale) / 2 - bounds.y * scale;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ── Render ───────────────────────────────────────────────────────
  function render() {
    const g = buildDagreGraph();
    const pad = 24;
    const inspectedIds = new Set(data.classes.map(c => c.id));

    // Boundary boxes
    content.select('#boundaries').selectAll('*').remove();
    [
      { ids: inspectedIds, label: data.inspectedModuleId, color: '#4fc3f7' },
      ...[...expandedModules.entries()].map(([modId, modData]) => ({
        ids: new Set(modData.classes.map(c => c.id)),
        label: modId,
        color: '#888',
      })),
    ].forEach(({ ids, label, color }) => {
      const nodes = g.nodes().filter(id => ids.has(id)).map(id => g.node(id)).filter(Boolean);
      if (!nodes.length) return;
      const x1 = Math.min(...nodes.map(n => n.x - n.width / 2)) - pad;
      const y1 = Math.min(...nodes.map(n => n.y - n.height / 2)) - pad;
      const x2 = Math.max(...nodes.map(n => n.x + n.width / 2)) + pad;
      const y2 = Math.max(...nodes.map(n => n.y + n.height / 2)) + pad;
      const bg = content.select('#boundaries').append('g');
      bg.append('rect')
        .attr('x', x1).attr('y', y1).attr('width', x2 - x1).attr('height', y2 - y1)
        .attr('rx', 8).attr('fill', 'rgba(79,195,247,0.04)')
        .attr('stroke', color).attr('stroke-width', 1).attr('stroke-dasharray', '4,3');
      bg.append('text').attr('x', x1 + 8).attr('y', y1 + 14)
        .attr('fill', color).attr('font-size', '10px').attr('font-weight', 'bold').text(label);
    });

    // Edges
    content.select('#edges').selectAll('.edge').remove();
    g.edges().forEach(e => {
      const edgeData = g.edge(e);
      const points = edgeData.points;
      const d = useBentArrows
        ? d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis)(points)
        : straightPath(points);
      content.select('#edges').append('g').attr('class', `edge${edgeData.collapsed ? ' to-collapsed' : ''}`)
        .append('path').attr('d', d).attr('fill', 'none')
        .attr('stroke', edgeData.collapsed ? '#888' : 'rgba(255,255,255,0.3)')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', edgeData.collapsed ? '4,3' : 'none')
        .attr('marker-end', 'url(#arrow-class)');
    });

    // Nodes
    content.select('#nodes').selectAll('.node-g').remove();
    g.nodes().forEach(id => {
      const n = g.node(id);
      const isExtModule = n.kind === 'ext-module';
      const ng = content.select('#nodes').append('g')
        .attr('class', 'node-g')
        .attr('transform', `translate(${n.x},${n.y})`);

      ng.append('rect')
        .attr('x', -n.width / 2).attr('y', -n.height / 2)
        .attr('width', n.width).attr('height', n.height)
        .attr('rx', isExtModule ? 12 : 4)
        .attr('fill', isExtModule ? '#2b2b2b' : (n.highlighted ? '#0d3a5e' : '#2a3950'))
        .attr('stroke', isExtModule ? '#888' : (n.highlighted ? '#7dd3fa' : '#4fc3f7'))
        .attr('stroke-width', n.highlighted ? 2 : 1);

      ng.append('text')
        .attr('dy', '0.35em').attr('text-anchor', 'middle')
        .attr('fill', '#ccc').attr('font-size', '10px').attr('font-family', 'monospace')
        .text(n.label);

      if (isExtModule) {
        ng.style('cursor', 'pointer')
          .on('click', () => toggleExpandModule(id))
          .on('contextmenu', (event) => {
            event.preventDefault();
            postToBridge({ action: 'extModuleContextMenu', moduleId: id });
          });
      } else {
        ng.on('contextmenu', (event) => {
          event.preventDefault();
          postToBridge({ action: 'classContextMenu', classId: id });
        });
      }
    });
  }

  // ── Expand / Collapse ────────────────────────────────────────────
  function toggleExpandModule(moduleId) {
    if (expandedModules.has(moduleId)) {
      expandedModules.delete(moduleId);
      render();
    } else {
      postToBridge({ action: 'expandModule', moduleId: moduleId, inspectedModuleId: data.inspectedModuleId });
    }
  }

  // ── Toolbar ──────────────────────────────────────────────────────
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-reset').addEventListener('click', () => {
    svg.call(zoom.transform, d3.zoomIdentity);
  });
  document.getElementById('btn-arrow').addEventListener('click', function () {
    useBentArrows = !useBentArrows;
    this.textContent = `Arrow style: ${useBentArrows ? 'Bent' : 'Straight'}`;
    render();
  });

  document.getElementById('module-title').textContent = data.inspectedModuleId;

  // ── Init ─────────────────────────────────────────────────────────
  setTimeout(() => { render(); fitView(); }, 50);
})();
```

- [ ] **Step 3: Create `HtmlBuilder.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.report

import io.github.rcosteira79.depgraph.plugin.model.ClassGraphData
import io.github.rcosteira79.depgraph.plugin.model.GraphModel
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val json: Json = Json { prettyPrint = false }

object HtmlBuilder {
    fun buildModuleViewHtml(graphModel: GraphModel): String {
        val graphDataJson: String = escapeForScriptBlock(json.encodeToString(graphModel))
        val visualisationJs: String = loadResource("graph-template.js")
        return buildModuleHtml(graphDataJson, visualisationJs)
    }

    fun buildClassViewHtml(classGraphData: ClassGraphData): String {
        val classDataJson: String = escapeForScriptBlock(json.encodeToString(classGraphData))
        val classViewJs: String = loadResource("class-view.js")
        return buildClassHtml(classDataJson, classViewJs)
    }

    private fun escapeForScriptBlock(json: String): String = json.replace("</", "<\\/")

    private fun loadResource(name: String): String =
        HtmlBuilder::class.java
            .getResourceAsStream("/io/github/rcosteira79/depgraph/plugin/$name")
            ?.bufferedReader()
            ?.readText()
            ?: error("Resource not found: $name")

    private fun buildModuleHtml(graphDataJson: String, visualisationJs: String): String =
        """
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
            #graph-container { flex: 1; overflow: hidden; position: relative; }
            #graph-svg { width: 100%; height: 100%; display: block; }
            #detail { width: 200px; flex-shrink: 0; border-left: 1px solid #3c3c3c; background: #1e1e1e; padding: 10px; font-size: 11px; overflow-y: auto; }
            #edge-detail { color: #aaa; font-size: 10px; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div id="toolbar">
            <span style="font-weight:bold;color:#4fc3f7">◈ Dependency Graph</span>
            <button class="tb-btn" id="btn-reset">↺ Reset</button>
            <button class="tb-btn" id="btn-fit">⤢ Fit</button>
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
                  <marker id="arrow-cycle" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#e53935"/>
                  </marker>
                  <marker id="arrow-trans" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#c084fc"/>
                  </marker>
                </defs>
                <g id="graph-content">
                  <g id="edges"></g>
                  <g id="nodes"></g>
                </g>
              </svg>
            </div>
            <div id="detail">
              <div id="edge-detail" style="color:#555;font-size:10px">Click an edge to inspect it.</div>
            </div>
          </div>
          <script>window.__GRAPH_DATA__ = $graphDataJson;</script>
          <script>$visualisationJs</script>
          <script>
            // JCEF bridge injection — wire up right-click context menu to bridge
            (function() {
              var origNodeClick = window.onNodeClick;
              // Patch the node right-click handler once graph-template.js has run
              document.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                // graph-template.js exposes hoveredNodeId
                if (window.__hoveredNodeId__ && window.__bridge__) {
                  window.__bridge__.postMessage(JSON.stringify({
                    action: 'nodeContextMenu',
                    moduleId: window.__hoveredNodeId__
                  }));
                }
              });
            })();
          </script>
        </body>
        </html>
        """.trimIndent()

    private fun buildClassHtml(classDataJson: String, classViewJs: String): String =
        """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Class Dependencies</title>
          <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1/dist/dagre.min.js"></script>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #121220; color: #ccc; font-family: -apple-system, sans-serif; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
            #toolbar { background: #2b2b2b; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
            .tb-btn { background: #4c5052; border: none; border-radius: 3px; color: #ccc; padding: 4px 12px; font-size: 11px; cursor: pointer; }
            #graph-container { flex: 1; overflow: hidden; position: relative; }
            #graph-svg { width: 100%; height: 100%; display: block; }
          </style>
        </head>
        <body>
          <div id="toolbar">
            <span style="font-weight:bold;color:#4fc3f7">◈ Class Dependencies</span>
            <span id="module-title" style="color:#888;font-size:11px"></span>
            <button class="tb-btn" id="btn-reset">↺ Reset</button>
            <button class="tb-btn" id="btn-fit">⤢ Fit</button>
            <button class="tb-btn" id="btn-arrow">Arrow style: Straight</button>
          </div>
          <div id="graph-container">
            <svg id="graph-svg">
              <defs>
                <marker id="arrow-class" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                  <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="rgba(255,255,255,0.35)"/>
                </marker>
              </defs>
              <g id="graph-content">
                <g id="boundaries"></g>
                <g id="edges"></g>
                <g id="nodes"></g>
              </g>
            </svg>
          </div>
          <script>window.__CLASS_DATA__ = $classDataJson;</script>
          <script>$classViewJs</script>
        </body>
        </html>
        """.trimIndent()
}
```

- [ ] **Step 4: Commit**

```bash
git commit -am "feat: add HTML templates, class-view.js, and HtmlBuilder"
```

---

## Task 8: Tool window

**Files:**
- Create: `src/main/kotlin/.../toolwindow/DependencyGraphToolWindowFactory.kt`
- Create: `src/main/kotlin/.../toolwindow/DependencyGraphToolWindow.kt`

This wires all previous components together. No unit tests — verified manually via `runIde`.

- [ ] **Step 1: Create `DependencyGraphToolWindowFactory.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory

class DependencyGraphToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        DependencyGraphToolWindow(project, toolWindow).initialise()
    }
}
```

- [ ] **Step 2: Create `DependencyGraphToolWindow.kt`**

```kotlin
package io.github.rcosteira79.depgraph.plugin.toolwindow

import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootEvent
import com.intellij.openapi.roots.ModuleRootListener
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.wm.ToolWindow
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTabbedPane
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.concurrency.AppExecutorUtil
import io.github.rcosteira79.depgraph.plugin.analysis.ClassDependencyAnalyser
import io.github.rcosteira79.depgraph.plugin.analysis.ModuleGraphAnalyser
import io.github.rcosteira79.depgraph.plugin.analysis.ModuleIdConverter
import io.github.rcosteira79.depgraph.plugin.bridge.ClassViewBridge
import io.github.rcosteira79.depgraph.plugin.bridge.ModuleViewBridge
import io.github.rcosteira79.depgraph.plugin.model.ClassGraphData
import io.github.rcosteira79.depgraph.plugin.model.GraphModel
import io.github.rcosteira79.depgraph.plugin.report.HtmlBuilder
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import javax.swing.JPanel
import javax.swing.SwingUtilities

private val json = Json { prettyPrint = false }

class DependencyGraphToolWindow(
    private val project: Project,
    private val toolWindow: ToolWindow,
) {
    private val tabs = JBTabbedPane()
    private var moduleViewBrowser: JBCefBrowser? = null

    fun initialise() {
        val panel = SimpleToolWindowPanel(true)
        panel.setContent(tabs)
        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)

        tabs.addTab("Module Graph", loadingPanel("Analysing project…"))
        runModuleAnalysis()

        project.messageBus.connect().subscribe(
            ModuleRootListener.TOPIC,
            object : ModuleRootListener {
                override fun rootsChanged(event: ModuleRootEvent) {
                    runModuleAnalysis()
                    markClassTabsStale()
                }
            },
        )
    }

    // ── Module view ──────────────────────────────────────────────────

    private fun runModuleAnalysis() {
        ReadAction.nonBlocking<GraphModel> {
            ModuleGraphAnalyser(project).analyse()
        }.submit(AppExecutorUtil.getAppExecutorService())
            .onSuccess { graphModel -> SwingUtilities.invokeLater { renderModuleView(graphModel) } }
            .onError { SwingUtilities.invokeLater { tabs.setComponentAt(0, errorPanel()) } }
    }

    private fun renderModuleView(graphModel: GraphModel) {
        val html: String = HtmlBuilder.buildModuleViewHtml(graphModel)

        if (moduleViewBrowser == null) {
            val browser = JBCefBrowser()
            val bridge = JBCefJSQuery.create(browser)
            val handler = ModuleViewBridge(
                onViewClasses = { moduleId -> SwingUtilities.invokeLater { openClassTab(moduleId) } },
                onRevealInProject = { moduleId -> revealModuleInProject(moduleId) },
            )
            bridge.addHandler { message -> handler.handleMessage(message); null }

            browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(b: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                    injectBridge(browser, bridge)
                }
            }, browser.cefBrowser)

            moduleViewBrowser = browser
            tabs.setComponentAt(0, browserPanel(browser))
        }

        moduleViewBrowser!!.loadHTML(html)
    }

    // ── Class tabs ───────────────────────────────────────────────────

    private fun openClassTab(moduleId: String) {
        val existingIndex = (0 until tabs.tabCount).firstOrNull { i ->
            tabs.getTitleAt(i) == "Classes: $moduleId"
        }
        if (existingIndex != null) {
            tabs.selectedIndex = existingIndex
            return
        }

        val tabIndex = tabs.tabCount
        tabs.addTab("Classes: $moduleId", loadingPanel("Analysing $moduleId…"))
        tabs.selectedIndex = tabIndex

        ReadAction.nonBlocking<ClassGraphData> {
            ClassDependencyAnalyser(project).analyse(moduleId)
        }.submit(AppExecutorUtil.getAppExecutorService())
            .onSuccess { classData -> SwingUtilities.invokeLater { renderClassView(moduleId, classData, tabIndex) } }
            .onError { SwingUtilities.invokeLater { if (tabIndex < tabs.tabCount) tabs.setComponentAt(tabIndex, errorPanel()) } }
    }

    private fun renderClassView(moduleId: String, classData: ClassGraphData, tabIndex: Int) {
        val html: String = HtmlBuilder.buildClassViewHtml(classData)
        val browser = JBCefBrowser()
        val bridge = JBCefJSQuery.create(browser)

        val handler = ClassViewBridge(
            onGoToClass = { qualifiedName -> navigateToClass(qualifiedName) },
            onViewClasses = { targetModuleId, _ -> SwingUtilities.invokeLater { openClassTab(targetModuleId) } },
            onViewModuleGraph = { targetModuleId -> focusModuleInGraph(targetModuleId) },
            onExpandModule = { targetModuleId, inspectedModuleId ->
                buildExpandedModuleResponse(targetModuleId, inspectedModuleId)
            },
        )

        bridge.addHandler { message ->
            val response: String? = handler.handleMessage(message)
            if (response != null) {
                browser.cefBrowser.executeJavaScript(
                    "window.__onExpandedModule__(${json.encodeToString(response)});",
                    browser.cefBrowser.url, 0,
                )
            }
            null
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                injectBridge(browser, bridge)
            }
        }, browser.cefBrowser)

        if (tabIndex < tabs.tabCount) tabs.setComponentAt(tabIndex, browserPanel(browser))
        browser.loadHTML(html)
    }

    private fun markClassTabsStale() {
        SwingUtilities.invokeLater {
            (1 until tabs.tabCount).forEach { i ->
                val title = tabs.getTitleAt(i)
                if (!title.endsWith(" ⚠")) tabs.setTitleAt(i, "$title ⚠")
            }
        }
    }

    // ── IDE navigation ───────────────────────────────────────────────

    private fun revealModuleInProject(moduleId: String) {
        val moduleName = moduleId.removePrefix(":").replace(":", "-")
        val module = ModuleManager.getInstance(project).modules
            .firstOrNull { m -> m.name == moduleName } ?: return
        val projectView = com.intellij.ide.projectView.ProjectView.getInstance(project)
        projectView.selectModuleGroup(
            com.intellij.ide.projectView.impl.ModuleGroup(arrayOf(module)), true,
        )
    }

    private fun navigateToClass(qualifiedName: String) {
        val psiClass = com.intellij.psi.JavaPsiFacade.getInstance(project)
            .findClass(qualifiedName, com.intellij.psi.search.GlobalSearchScope.projectScope(project))
            ?: return
        com.intellij.psi.util.PsiNavigateUtil.navigate(psiClass)
    }

    private fun focusModuleInGraph(moduleId: String) {
        SwingUtilities.invokeLater {
            tabs.selectedIndex = 0
            moduleViewBrowser?.cefBrowser?.executeJavaScript(
                "if (typeof onNodeClick === 'function') onNodeClick('${moduleId.replace("'", "\\'")}');",
                moduleViewBrowser?.cefBrowser?.url ?: "", 0,
            )
        }
    }

    private fun buildExpandedModuleResponse(targetModuleId: String, inspectedModuleId: String): String {
        val targetData: ClassGraphData = ClassDependencyAnalyser(project).analyse(targetModuleId)
        val inspectedData: ClassGraphData = ClassDependencyAnalyser(project).analyse(inspectedModuleId)
        val highlightedClassIds: List<String> = inspectedData.externalDeps
            .filter { dep -> dep.targetModuleId == targetModuleId }
            .map { dep -> dep.targetClassId }
        return json.encodeToString(
            mapOf(
                "action" to "expandedModule",
                "moduleId" to targetModuleId,
                "classes" to targetData.classes,
                "highlightedClassIds" to highlightedClassIds,
            )
        )
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private fun injectBridge(browser: JBCefBrowser, bridge: JBCefJSQuery) {
        browser.cefBrowser.executeJavaScript(
            "window.__bridge__ = { postMessage: function(msg) { ${bridge.inject("msg")} } };",
            browser.cefBrowser.url, 0,
        )
    }

    private fun browserPanel(browser: JBCefBrowser): JPanel =
        JPanel(BorderLayout()).apply { add(browser.component, BorderLayout.CENTER) }

    private fun loadingPanel(message: String): JPanel =
        JPanel(BorderLayout()).apply { add(JBLabel(message), BorderLayout.CENTER) }

    private fun errorPanel(): JPanel =
        JPanel(BorderLayout()).apply { add(JBLabel("Analysis failed. Check IDE logs."), BorderLayout.CENTER) }
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: add tool window factory and implementation"
```

---

## Task 9: Run and verify in Android Studio

- [ ] **Step 1: Run the plugin in a sandbox IDE**

```bash
cd android-studio-plugin && ./gradlew runIde
```

Expected: A sandbox Android Studio instance launches. The "Dependency Graph" tool window appears in the right sidebar.

- [ ] **Step 2: Open the tool window and verify the module graph loads**

Expected: Loading indicator appears briefly, then the full module dependency graph renders with depth slider, transitive toggle, layout toggle, explorer panel, and auto-selected first app module.

- [ ] **Step 3: Verify right-click context menu on a module node**

Right-click any module node. Expected: context menu with "Reveal in Project" and "View Classes" options.

- [ ] **Step 4: Click "Reveal in Project"**

Expected: the Project panel reveals and selects the module's root directory.

- [ ] **Step 5: Click "View Classes" on a module**

Expected: a new tab "Classes: :module-name" opens showing the class graph with the inspected module's classes inside a boundary box, and collapsed external module pill nodes outside it.

- [ ] **Step 6: Click a collapsed external module node**

Expected: the node expands in-place showing the external module's classes, with highlighted classes being those depended upon by the inspected module's classes.

- [ ] **Step 7: Right-click a class node**

Expected: context menu with "Go to class" and "View dependencies" options.

- [ ] **Step 8: Click "Go to class"**

Expected: the editor opens and jumps to the class definition.

- [ ] **Step 9: Final commit**

```bash
git commit -am "chore: verified android studio plugin end-to-end"
```
