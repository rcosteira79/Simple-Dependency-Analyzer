# Bytecode Class Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bytecode-based class analysis to the Gradle plugin so the HTML report supports progressive drill-down from modules to packages to boundary classes.

**Architecture:** ASM scans compiled `.class` files per module to extract class references. A `ClassAnalysisOrchestrator` cross-references results to find boundary classes (those involved in cross-module edges), groups them by package, and embeds the data in the existing `GraphModel`. The JS visualization handles unfolding client-side. A `--modules-only` flag skips class analysis entirely.

**Tech Stack:** Kotlin, ASM 9.7, kotlinx-serialization, D3.js/dagre, JUnit 5, Gradle TestKit

---

## File Map

### New files (Kotlin)

| File | Responsibility |
|------|---------------|
| `src/main/kotlin/io/github/rcosteira79/depgraph/model/ClassModels.kt` | `ModuleClassData`, `PackageNode`, `BoundaryType`, `BoundaryClass`, `ClassLevelEdge` |
| `src/main/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilter.kt` | Name-based + directory-based filtering of generated classes |
| `src/main/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzer.kt` | ASM-based scanner: reads `.class` files, extracts class refs |
| `src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestrator.kt` | Orchestrates per-module analysis, computes boundary classes, groups by package |
| `src/test/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilterTest.kt` | Tests for filter logic |
| `src/test/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzerTest.kt` | Tests for bytecode scanning |
| `src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestratorTest.kt` | Tests for orchestration + boundary computation |

### Modified files (Kotlin)

| File | Change |
|------|--------|
| `build.gradle.kts` | Add ASM dependency |
| `src/main/kotlin/io/github/rcosteira79/depgraph/model/GraphModel.kt` | Add `classData` field, bump schema to 2 |
| `src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphExtension.kt` | Add `variant` property |
| `src/main/kotlin/io/github/rcosteira79/depgraph/GenerateDependencyGraphTask.kt` | Add `modulesOnly` input, wire compile deps, call orchestrator |
| `src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt` | Wire `modulesOnly` from project property, wire compile task deps |
| `src/test/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializerTest.kt` | Update for schema v2 |
| `src/test/kotlin/io/github/rcosteira79/depgraph/report/HtmlReportGeneratorTest.kt` | Update for schema v2 |

### Modified files (JS)

| File | Change |
|------|--------|
| `src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js` | Context menu, unfolding, package pills, class nodes, edge rewiring |

### Modified files (Test fixtures)

| File | Change |
|------|--------|
| `src/test/resources/fixture-project/app/src/main/java/com/example/app/AppMain.java` | New: fixture class referencing core-ui |
| `src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Button.java` | New: fixture class used by app |
| `src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Theme.java` | New: fixture class with no cross-module refs |

### Integration test

| File | Change |
|------|--------|
| `src/test/kotlin/io/github/rcosteira79/depgraph/integration/GenerateDependencyGraphTaskTest.kt` | Add class analysis + modules-only tests |

All paths are relative to `gradle-plugin/`.

---

### Task 1: Add ASM dependency and class data models

**Files:**
- Modify: `gradle-plugin/build.gradle.kts`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/ClassModels.kt`
- Modify: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/GraphModel.kt`
- Modify: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphExtension.kt`
- Modify: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializerTest.kt`
- Modify: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/report/HtmlReportGeneratorTest.kt`

- [ ] **Step 1: Add ASM dependency to build.gradle.kts**

In `gradle-plugin/build.gradle.kts`, add to the `dependencies` block:

```kotlin
implementation("org.ow2.asm:asm:9.7.1")
```

- [ ] **Step 2: Create ClassModels.kt**

Create `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/ClassModels.kt`:

```kotlin
package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

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
    val boundaryType: BoundaryType,
)

@Serializable
enum class BoundaryType {
    INCOMING,
    OUTGOING,
    BOTH,
}

@Serializable
data class BoundaryClass(
    val id: String,
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

- [ ] **Step 3: Update GraphModel to schema v2 with optional classData**

In `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/GraphModel.kt`, replace the entire file:

```kotlin
package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class GraphModel(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val modules: List<Module>,
    val edges: List<Edge>,
    val classData: Map<String, ModuleClassData>? = null,
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION: Int = 2
    }
}
```

- [ ] **Step 4: Add variant property to DependencyGraphExtension**

In `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphExtension.kt`, replace the entire file:

```kotlin
package io.github.rcosteira79.depgraph

open class DependencyGraphExtension {
    /** Override the inferred module type. Valid values: app, feature, core, data, unknown */
    var moduleType: String? = null

    /** Android build variant to analyze for class dependencies. Ignored for JVM modules. */
    var variant: String = "debug"
}
```

- [ ] **Step 5: Fix existing serializer test for schema v2**

In `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializerTest.kt`, update the schema version assertion in the first test:

Replace:
```kotlin
        val actualGraph = Json.decodeFromString<GraphModel>(outputFile.readText())
        assertEquals(inputGraph, actualGraph)
```
With:
```kotlin
        val actualGraph: GraphModel = Json.decodeFromString<GraphModel>(outputFile.readText())
        assertEquals(inputGraph, actualGraph)
        assertEquals(2, actualGraph.schemaVersion)
```

- [ ] **Step 6: Fix existing HTML report test for schema v2**

No changes needed — `HtmlReportGeneratorTest` doesn't assert on `schemaVersion`.

- [ ] **Step 7: Run tests to verify nothing is broken**

Run: `cd gradle-plugin && ./gradlew test --tests '*GraphSerializerTest*' --tests '*HtmlReportGeneratorTest*' --tests '*ModuleAnalyzerTest*' -q`

Expected: all tests pass. Schema version is now 2 everywhere. The `classData` field defaults to `null` so existing tests continue to work.

- [ ] **Step 8: Commit**

```bash
git add gradle-plugin/build.gradle.kts \
  gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/ClassModels.kt \
  gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/model/GraphModel.kt \
  gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphExtension.kt \
  gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/serialisation/GraphSerializerTest.kt
git commit -m "Add class data models and ASM dependency for bytecode analysis"
```

---

### Task 2: GeneratedClassFilter

**Files:**
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilterTest.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilter.kt`

- [ ] **Step 1: Write the failing tests**

Create `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilterTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class GeneratedClassFilterTest {
    @Test
    fun `filters Hilt prefixed classes`() {
        val inputClassName = "Hilt_MyActivity"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters Dagger prefixed classes`() {
        val inputClassName = "DaggerAppComponent"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters Factory suffixed classes`() {
        val inputClassName = "MyModule_Factory"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters HiltModules suffixed classes`() {
        val inputClassName = "MyApp_HiltModules"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters BuildConfig exact match`() {
        val inputClassName = "BuildConfig"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters BR exact match`() {
        val inputClassName = "BR"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters DataBinderMapperImpl exact match`() {
        val inputClassName = "DataBinderMapperImpl"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters classes under generated directory`() {
        val inputClassName = "NormalClassName"
        val inputDirectory = File("build/generated/ksp/debug/kotlin")

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, inputDirectory)

        assertTrue(actualResult)
    }

    @Test
    fun `does not filter normal classes in source directories`() {
        val inputClassName = "LoginViewModel"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("build/classes/kotlin/main"))

        assertFalse(actualResult)
    }

    @Test
    fun `filters GeneratedInjector suffixed classes`() {
        val inputClassName = "MyApp_GeneratedInjector"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }

    @Test
    fun `filters MembersInjector suffixed classes`() {
        val inputClassName = "MyActivity_MembersInjector"

        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))

        assertTrue(actualResult)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gradle-plugin && ./gradlew test --tests '*GeneratedClassFilterTest*' -q`

Expected: FAIL — `GeneratedClassFilter` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilter.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import java.io.File

private val GENERATED_SUFFIXES: List<String> =
    listOf(
        "_Factory",
        "_HiltModules",
        "_GeneratedInjector",
        "_MembersInjector",
        "_ComponentTreeDeps",
        "_HiltComponents",
        "_BindingImpl",
        "_Provide",
    )

private val GENERATED_PREFIXES: List<String> = listOf("Hilt_", "Dagger")

private val GENERATED_EXACT: Set<String> = setOf("BuildConfig", "BR", "DataBinderMapperImpl")

object GeneratedClassFilter {
    fun isGenerated(simpleClassName: String, classFileDirectory: File): Boolean {
        if (simpleClassName in GENERATED_EXACT) return true
        if (GENERATED_SUFFIXES.any { simpleClassName.endsWith(it) }) return true
        if (GENERATED_PREFIXES.any { simpleClassName.startsWith(it) }) return true
        if (classFileDirectory.path.contains("/generated/")) return true
        return false
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gradle-plugin && ./gradlew test --tests '*GeneratedClassFilterTest*' -q`

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilter.kt \
  gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/GeneratedClassFilterTest.kt
git commit -m "Add GeneratedClassFilter for name and directory based filtering"
```

---

### Task 3: BytecodeClassAnalyzer

**Files:**
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzerTest.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzer.kt`

The analyzer needs compiled `.class` files as input. The test will compile small Java source files at test time into a temp directory, then feed those `.class` files to the analyzer.

- [ ] **Step 1: Write the failing tests**

Create `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzerTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import javax.tools.ToolProvider

class BytecodeClassAnalyzerTest {
    @Test
    fun `discovers classes in a directory`(@TempDir tempDir: File) {
        // Given: two compiled classes
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Foo.java" to """
                package com.example;
                public class Foo {}
            """.trimIndent(),
            "com/example/Bar.java" to """
                package com.example;
                public class Bar {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then:
        val actualClassNames: Set<String> = actualResult.discoveredClasses.map { it.qualifiedName }.toSet()
        assertEquals(setOf("com.example.Foo", "com.example.Bar"), actualClassNames)
    }

    @Test
    fun `extracts field type reference`(@TempDir tempDir: File) {
        // Given: Foo has a field of type Bar
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Bar.java" to """
                package com.example;
                public class Bar {}
            """.trimIndent(),
            "com/example/Foo.java" to """
                package com.example;
                public class Foo { private Bar bar; }
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then: Foo references Bar
        val actualFooRefs: Set<String> = actualResult.classReferences["com.example.Foo"] ?: emptySet()
        assertTrue(actualFooRefs.contains("com.example.Bar"))
    }

    @Test
    fun `extracts method return type reference`(@TempDir tempDir: File) {
        // Given:
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Result.java" to """
                package com.example;
                public class Result {}
            """.trimIndent(),
            "com/example/Service.java" to """
                package com.example;
                public class Service { public Result process() { return null; } }
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then:
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Service"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Result"))
    }

    @Test
    fun `extracts superclass reference`(@TempDir tempDir: File) {
        // Given:
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Base.java" to """
                package com.example;
                public class Base {}
            """.trimIndent(),
            "com/example/Child.java" to """
                package com.example;
                public class Child extends Base {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then:
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Child"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Base"))
    }

    @Test
    fun `extracts interface reference`(@TempDir tempDir: File) {
        // Given:
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Clickable.java" to """
                package com.example;
                public interface Clickable {}
            """.trimIndent(),
            "com/example/Button.java" to """
                package com.example;
                public class Button implements Clickable {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then:
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Button"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Clickable"))
    }

    @Test
    fun `extracts NEW instruction reference`(@TempDir tempDir: File) {
        // Given: Foo creates a new Bar instance
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Bar.java" to """
                package com.example;
                public class Bar {}
            """.trimIndent(),
            "com/example/Foo.java" to """
                package com.example;
                public class Foo { public Bar create() { return new Bar(); } }
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then:
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Foo"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Bar"))
    }

    @Test
    fun `filters generated classes by name`(@TempDir tempDir: File) {
        // Given: a Hilt-generated class
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Hilt_MyActivity.java" to """
                package com.example;
                public class Hilt_MyActivity {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then: generated class is excluded
        assertTrue(actualResult.discoveredClasses.none { it.qualifiedName == "com.example.Hilt_MyActivity" })
    }

    @Test
    fun `excludes self-references`(@TempDir tempDir: File) {
        // Given: a class that only references itself (via java.lang.Object superclass)
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Standalone.java" to """
                package com.example;
                public class Standalone {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then: no self-reference
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Standalone"] ?: emptySet()
        assertTrue(!actualRefs.contains("com.example.Standalone"))
    }

    @Test
    fun `excludes java stdlib references`(@TempDir tempDir: File) {
        // Given: a class that uses java.util.List
        val classesDir: File = compileJavaSources(
            tempDir,
            "com/example/Holder.java" to """
                package com.example;
                import java.util.List;
                public class Holder { private List<String> items; }
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        // Then: java.util.List and java.lang.String are not in references
        val actualRefs: Set<String> = actualResult.classReferences["com.example.Holder"] ?: emptySet()
        assertTrue(actualRefs.none { it.startsWith("java.") })
    }

    @Test
    fun `handles multiple class directories`(@TempDir tempDir: File) {
        // Given: classes split across two directories (like java + kotlin output)
        val javaClassesDir: File = compileJavaSources(
            File(tempDir, "java-classes"),
            "com/example/JavaClass.java" to """
                package com.example;
                public class JavaClass {}
            """.trimIndent(),
        )
        val kotlinClassesDir: File = compileJavaSources(
            File(tempDir, "kotlin-classes"),
            "com/example/KotlinClass.java" to """
                package com.example;
                public class KotlinClass {}
            """.trimIndent(),
        )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(javaClassesDir, kotlinClassesDir))

        // Then:
        val actualClassNames: Set<String> = actualResult.discoveredClasses.map { it.qualifiedName }.toSet()
        assertEquals(setOf("com.example.JavaClass", "com.example.KotlinClass"), actualClassNames)
    }

    @Test
    fun `returns empty result for empty directories`(@TempDir tempDir: File) {
        // Given: an empty directory
        val emptyDir: File = File(tempDir, "empty").also { it.mkdirs() }
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(emptyDir))

        // Then:
        assertTrue(actualResult.discoveredClasses.isEmpty())
        assertTrue(actualResult.classReferences.isEmpty())
    }

    @Test
    fun `returns empty result for nonexistent directories`(@TempDir tempDir: File) {
        // Given: a directory that does not exist
        val missingDir = File(tempDir, "does-not-exist")
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        // When:
        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(missingDir))

        // Then:
        assertTrue(actualResult.discoveredClasses.isEmpty())
        assertTrue(actualResult.classReferences.isEmpty())
    }

    private fun compileJavaSources(outputBaseDir: File, vararg sources: Pair<String, String>): File {
        val srcDir = File(outputBaseDir, "src").also { it.mkdirs() }
        val classesDir = File(outputBaseDir, "classes").also { it.mkdirs() }

        val sourceFiles: List<File> = sources.map { (path, content) ->
            File(srcDir, path).also {
                it.parentFile.mkdirs()
                it.writeText(content)
            }
        }

        val compiler = ToolProvider.getSystemJavaCompiler()
        val fileManager = compiler.getStandardFileManager(null, null, null)
        val compilationUnits = fileManager.getJavaFileObjectsFromFiles(sourceFiles)
        val task = compiler.getTask(
            null, fileManager, null,
            listOf("-d", classesDir.absolutePath),
            null, compilationUnits,
        )
        check(task.call()) { "Compilation failed" }
        fileManager.close()

        return classesDir
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gradle-plugin && ./gradlew test --tests '*BytecodeClassAnalyzerTest*' -q`

Expected: FAIL — `BytecodeClassAnalyzer` and `BytecodeAnalysisResult` do not exist.

- [ ] **Step 3: Write the implementation**

Create `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzer.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import org.objectweb.asm.AnnotationVisitor
import org.objectweb.asm.ClassReader
import org.objectweb.asm.ClassVisitor
import org.objectweb.asm.FieldVisitor
import org.objectweb.asm.MethodVisitor
import org.objectweb.asm.Opcodes
import org.objectweb.asm.Type
import java.io.File
import java.io.InputStream

data class DiscoveredClass(
    val qualifiedName: String,
    val simpleName: String,
    val packageName: String,
)

data class BytecodeAnalysisResult(
    val moduleId: String,
    val discoveredClasses: List<DiscoveredClass>,
    val classReferences: Map<String, Set<String>>,
)

class BytecodeClassAnalyzer(
    private val moduleId: String,
) {
    fun analyze(classDirectories: List<File>): BytecodeAnalysisResult {
        val discoveredClasses: MutableList<DiscoveredClass> = mutableListOf()
        val classReferences: MutableMap<String, MutableSet<String>> = mutableMapOf()

        classDirectories
            .filter { it.exists() && it.isDirectory }
            .forEach { dir ->
                dir.walkTopDown()
                    .filter { it.isFile && it.extension == "class" }
                    .forEach { classFile ->
                        analyzeClassFile(classFile, dir, discoveredClasses, classReferences)
                    }
            }

        return BytecodeAnalysisResult(
            moduleId = moduleId,
            discoveredClasses = discoveredClasses,
            classReferences = classReferences,
        )
    }

    private fun analyzeClassFile(
        classFile: File,
        rootDirectory: File,
        discoveredClasses: MutableList<DiscoveredClass>,
        classReferences: MutableMap<String, MutableSet<String>>,
    ) {
        val inputStream: InputStream = classFile.inputStream()
        val classReader = ClassReader(inputStream.use { it.readBytes() })
        val internalName: String = classReader.className
        val qualifiedName: String = internalName.replace('/', '.')

        val simpleName: String = qualifiedName.substringAfterLast('.')
        val packageName: String = qualifiedName.substringBeforeLast('.', "")

        if (GeneratedClassFilter.isGenerated(simpleName, classFile.parentFile)) return
        if (simpleName.contains('$')) return // skip inner/anonymous classes

        discoveredClasses += DiscoveredClass(
            qualifiedName = qualifiedName,
            simpleName = simpleName,
            packageName = packageName,
        )

        val refs: MutableSet<String> = mutableSetOf()
        classReader.accept(ReferenceCollector(refs), ClassReader.SKIP_DEBUG or ClassReader.SKIP_FRAMES)

        val filteredRefs: Set<String> = refs
            .filter { it != qualifiedName }
            .filter { !it.startsWith("java.") && !it.startsWith("javax.") }
            .filter { !it.startsWith("kotlin.") && !it.startsWith("kotlinx.") }
            .filter { !it.contains('$') }
            .toSet()

        if (filteredRefs.isNotEmpty()) {
            classReferences[qualifiedName] = filteredRefs.toMutableSet()
        }
    }
}

private class ReferenceCollector(
    private val refs: MutableSet<String>,
) : ClassVisitor(Opcodes.ASM9) {

    override fun visit(
        version: Int,
        access: Int,
        name: String?,
        signature: String?,
        superName: String?,
        interfaces: Array<out String>?,
    ) {
        superName?.let { addInternalName(it) }
        interfaces?.forEach { addInternalName(it) }
    }

    override fun visitAnnotation(descriptor: String?, visible: Boolean): AnnotationVisitor? {
        descriptor?.let { addType(Type.getType(it)) }
        return null
    }

    override fun visitField(
        access: Int,
        name: String?,
        descriptor: String?,
        signature: String?,
        value: Any?,
    ): FieldVisitor? {
        descriptor?.let { addType(Type.getType(it)) }
        return null
    }

    override fun visitMethod(
        access: Int,
        name: String?,
        descriptor: String?,
        signature: String?,
        exceptions: Array<out String>?,
    ): MethodVisitor {
        descriptor?.let {
            val methodType: Type = Type.getMethodType(it)
            addType(methodType.returnType)
            methodType.argumentTypes.forEach { argType -> addType(argType) }
        }
        exceptions?.forEach { addInternalName(it) }

        return object : MethodVisitor(Opcodes.ASM9) {
            override fun visitTypeInsn(opcode: Int, type: String?) {
                type?.let { addInternalName(it) }
            }

            override fun visitFieldInsn(opcode: Int, owner: String?, name: String?, descriptor: String?) {
                owner?.let { addInternalName(it) }
            }

            override fun visitMethodInsn(
                opcode: Int,
                owner: String?,
                name: String?,
                descriptor: String?,
                isInterface: Boolean,
            ) {
                owner?.let { addInternalName(it) }
            }
        }
    }

    private fun addInternalName(internalName: String) {
        if (internalName.startsWith('[')) {
            addType(Type.getType(internalName))
        } else {
            refs += internalName.replace('/', '.')
        }
    }

    private fun addType(type: Type) {
        when (type.sort) {
            Type.ARRAY -> addType(type.elementType)
            Type.OBJECT -> refs += type.className
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gradle-plugin && ./gradlew test --tests '*BytecodeClassAnalyzerTest*' -q`

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzer.kt \
  gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/BytecodeClassAnalyzerTest.kt
git commit -m "Add BytecodeClassAnalyzer with ASM-based class reference extraction"
```

---

### Task 4: ClassAnalysisOrchestrator

**Files:**
- Create: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestratorTest.kt`
- Create: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestrator.kt`

The orchestrator takes the raw per-module `BytecodeAnalysisResult` data, cross-references it to compute boundary classes, groups by package, and assigns boundary types.

- [ ] **Step 1: Write the failing tests**

Create `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestratorTest.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.BoundaryType
import io.github.rcosteira79.depgraph.model.ModuleClassData
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ClassAnalysisOrchestratorTest {
    @Test
    fun `identifies outgoing boundary class`() {
        // Given: :app has AppMain that references core-ui's Button
        val inputAppResult = BytecodeAnalysisResult(
            moduleId = ":app",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
            ),
            classReferences = mapOf(
                "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
            ),
        )
        val inputCoreResult = BytecodeAnalysisResult(
            moduleId = ":core-ui",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputAppResult, inputCoreResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: AppMain is an outgoing boundary in :app
        val actualAppData: ModuleClassData = actualResult[":app"]!!
        val actualPackage = actualAppData.packages.single()
        assertEquals("com.example.app", actualPackage.name)
        assertEquals(BoundaryType.OUTGOING, actualPackage.boundaryType)
        assertEquals("AppMain", actualPackage.classes.single().simpleName)
    }

    @Test
    fun `identifies incoming boundary class`() {
        // Given: :app references :core-ui's Button
        val inputAppResult = BytecodeAnalysisResult(
            moduleId = ":app",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
            ),
            classReferences = mapOf(
                "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
            ),
        )
        val inputCoreResult = BytecodeAnalysisResult(
            moduleId = ":core-ui",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputAppResult, inputCoreResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: Button is an incoming boundary in :core-ui
        val actualCoreData: ModuleClassData = actualResult[":core-ui"]!!
        val actualPackage = actualCoreData.packages.single()
        assertEquals("com.example.coreui", actualPackage.name)
        assertEquals(BoundaryType.INCOMING, actualPackage.boundaryType)
        assertEquals("Button", actualPackage.classes.single().simpleName)
    }

    @Test
    fun `identifies BOTH boundary type when class is incoming and outgoing`() {
        // Given: :middle depends on :bottom and :top depends on :middle
        // :middle's Bridge class is used by :top AND uses :bottom's Foundation
        val inputTopResult = BytecodeAnalysisResult(
            moduleId = ":top",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.top.TopClass", "TopClass", "com.example.top"),
            ),
            classReferences = mapOf(
                "com.example.top.TopClass" to setOf("com.example.middle.Bridge"),
            ),
        )
        val inputMiddleResult = BytecodeAnalysisResult(
            moduleId = ":middle",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.middle.Bridge", "Bridge", "com.example.middle"),
            ),
            classReferences = mapOf(
                "com.example.middle.Bridge" to setOf("com.example.bottom.Foundation"),
            ),
        )
        val inputBottomResult = BytecodeAnalysisResult(
            moduleId = ":bottom",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.bottom.Foundation", "Foundation", "com.example.bottom"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(
            ":top" to setOf(":middle"),
            ":middle" to setOf(":bottom"),
        )

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputTopResult, inputMiddleResult, inputBottomResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: Bridge in :middle is BOTH
        val actualMiddleData: ModuleClassData = actualResult[":middle"]!!
        val actualPackage = actualMiddleData.packages.single()
        assertEquals(BoundaryType.BOTH, actualPackage.boundaryType)
    }

    @Test
    fun `produces class-level edges`() {
        // Given:
        val inputAppResult = BytecodeAnalysisResult(
            moduleId = ":app",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
            ),
            classReferences = mapOf(
                "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
            ),
        )
        val inputCoreResult = BytecodeAnalysisResult(
            moduleId = ":core-ui",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputAppResult, inputCoreResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: there is a class-level edge from AppMain in :app to Button in :core-ui
        val actualAppEdges = actualResult[":app"]!!.classEdges
        val actualEdge = actualAppEdges.single()
        assertEquals("com.example.app.AppMain", actualEdge.fromClassId)
        assertEquals(":app", actualEdge.fromModuleId)
        assertEquals("com.example.coreui.Button", actualEdge.toClassId)
        assertEquals(":core-ui", actualEdge.toModuleId)
    }

    @Test
    fun `groups boundary classes by package`() {
        // Given: :app has two classes in the same package that reference different external classes
        val inputAppResult = BytecodeAnalysisResult(
            moduleId = ":app",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.app.Login", "Login", "com.example.app"),
                DiscoveredClass("com.example.app.Signup", "Signup", "com.example.app"),
            ),
            classReferences = mapOf(
                "com.example.app.Login" to setOf("com.example.coreui.Button"),
                "com.example.app.Signup" to setOf("com.example.coreui.Button"),
            ),
        )
        val inputCoreResult = BytecodeAnalysisResult(
            moduleId = ":core-ui",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputAppResult, inputCoreResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: both classes are in one package node
        val actualAppData: ModuleClassData = actualResult[":app"]!!
        assertEquals(1, actualAppData.packages.size)
        assertEquals(2, actualAppData.packages.single().classes.size)
    }

    @Test
    fun `excludes modules with no boundary classes`() {
        // Given: :isolated has a class but no cross-module references
        val inputIsolatedResult = BytecodeAnalysisResult(
            moduleId = ":isolated",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.isolated.Internal", "Internal", "com.example.isolated"),
            ),
            classReferences = emptyMap(),
        )
        val inputModuleEdges: Map<String, Set<String>> = emptyMap()

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputIsolatedResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: :isolated has empty packages (still present in map but no boundary classes)
        val actualIsolatedData: ModuleClassData = actualResult[":isolated"]!!
        assertTrue(actualIsolatedData.packages.isEmpty())
    }

    @Test
    fun `ignores references to classes not in any analyzed module`() {
        // Given: :app references a third-party class not in any module
        val inputAppResult = BytecodeAnalysisResult(
            moduleId = ":app",
            discoveredClasses = listOf(
                DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
            ),
            classReferences = mapOf(
                "com.example.app.AppMain" to setOf("com.thirdparty.SomeLib"),
            ),
        )
        val inputModuleEdges: Map<String, Set<String>> = emptyMap()

        // When:
        val actualResult: Map<String, ModuleClassData> = ClassAnalysisOrchestrator.buildClassData(
            analysisResults = listOf(inputAppResult),
            moduleEdges = inputModuleEdges,
        )

        // Then: no boundary classes (third-party refs are ignored)
        val actualAppData: ModuleClassData = actualResult[":app"]!!
        assertTrue(actualAppData.packages.isEmpty())
        assertTrue(actualAppData.classEdges.isEmpty())
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gradle-plugin && ./gradlew test --tests '*ClassAnalysisOrchestratorTest*' -q`

Expected: FAIL — `ClassAnalysisOrchestrator` does not exist.

- [ ] **Step 3: Write the implementation**

Create `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestrator.kt`:

```kotlin
package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.BoundaryClass
import io.github.rcosteira79.depgraph.model.BoundaryType
import io.github.rcosteira79.depgraph.model.ClassLevelEdge
import io.github.rcosteira79.depgraph.model.ModuleClassData
import io.github.rcosteira79.depgraph.model.PackageNode

object ClassAnalysisOrchestrator {
    fun buildClassData(
        analysisResults: List<BytecodeAnalysisResult>,
        moduleEdges: Map<String, Set<String>>,
    ): Map<String, ModuleClassData> {
        val classToModule: Map<String, String> = analysisResults.flatMap { result ->
            result.discoveredClasses.map { it.qualifiedName to result.moduleId }
        }.toMap()

        val classInfoByName: Map<String, DiscoveredClass> = analysisResults.flatMap { result ->
            result.discoveredClasses
        }.associateBy { it.qualifiedName }

        val allClassEdges: List<ClassLevelEdge> = analysisResults.flatMap { result ->
            result.classReferences.flatMap { (sourceClass, targetClasses) ->
                val sourceModule: String = result.moduleId
                targetClasses.mapNotNull { targetClass ->
                    val targetModule: String = classToModule[targetClass] ?: return@mapNotNull null
                    if (targetModule == sourceModule) return@mapNotNull null
                    ClassLevelEdge(
                        fromClassId = sourceClass,
                        fromModuleId = sourceModule,
                        toClassId = targetClass,
                        toModuleId = targetModule,
                    )
                }
            }
        }.distinct()

        val outgoingByModule: Map<String, Set<String>> = allClassEdges
            .groupBy { it.fromModuleId }
            .mapValues { (_, edges) -> edges.map { it.fromClassId }.toSet() }

        val incomingByModule: Map<String, Set<String>> = allClassEdges
            .groupBy { it.toModuleId }
            .mapValues { (_, edges) -> edges.map { it.toClassId }.toSet() }

        return analysisResults.associate { result ->
            val moduleId: String = result.moduleId
            val outgoingClassIds: Set<String> = outgoingByModule[moduleId] ?: emptySet()
            val incomingClassIds: Set<String> = incomingByModule[moduleId] ?: emptySet()
            val boundaryClassIds: Set<String> = outgoingClassIds + incomingClassIds

            val boundaryClasses: List<Pair<DiscoveredClass, BoundaryType>> = boundaryClassIds.mapNotNull { classId ->
                val classInfo: DiscoveredClass = classInfoByName[classId] ?: return@mapNotNull null
                val isOutgoing: Boolean = classId in outgoingClassIds
                val isIncoming: Boolean = classId in incomingClassIds
                val boundaryType: BoundaryType = when {
                    isOutgoing && isIncoming -> BoundaryType.BOTH
                    isOutgoing -> BoundaryType.OUTGOING
                    else -> BoundaryType.INCOMING
                }
                classInfo to boundaryType
            }

            val packages: List<PackageNode> = boundaryClasses
                .groupBy { it.first.packageName }
                .map { (packageName, classesWithType) ->
                    val packageBoundaryType: BoundaryType = classesWithType
                        .map { it.second }
                        .reduce { acc, type -> combineBoundaryTypes(acc, type) }
                    PackageNode(
                        name = packageName,
                        classes = classesWithType.map { (cls, _) ->
                            BoundaryClass(id = cls.qualifiedName, simpleName = cls.simpleName)
                        },
                        boundaryType = packageBoundaryType,
                    )
                }

            val moduleClassEdges: List<ClassLevelEdge> = allClassEdges.filter { it.fromModuleId == moduleId }

            moduleId to ModuleClassData(
                moduleId = moduleId,
                packages = packages,
                classEdges = moduleClassEdges,
            )
        }
    }

    private fun combineBoundaryTypes(a: BoundaryType, b: BoundaryType): BoundaryType =
        if (a == b) a else BoundaryType.BOTH
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gradle-plugin && ./gradlew test --tests '*ClassAnalysisOrchestratorTest*' -q`

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestrator.kt \
  gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/analysis/ClassAnalysisOrchestratorTest.kt
git commit -m "Add ClassAnalysisOrchestrator for boundary class computation"
```

---

### Task 5: Wire class analysis into the Gradle task

**Files:**
- Modify: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/GenerateDependencyGraphTask.kt`
- Modify: `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt`

- [ ] **Step 1: Update GenerateDependencyGraphTask**

Replace the contents of `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/GenerateDependencyGraphTask.kt`:

```kotlin
package io.github.rcosteira79.depgraph

import io.github.rcosteira79.depgraph.analysis.BytecodeClassAnalyzer
import io.github.rcosteira79.depgraph.analysis.BytecodeAnalysisResult
import io.github.rcosteira79.depgraph.analysis.ClassAnalysisOrchestrator
import io.github.rcosteira79.depgraph.analysis.ModuleAnalyzer
import io.github.rcosteira79.depgraph.model.ModuleClassData
import io.github.rcosteira79.depgraph.report.HtmlReportGenerator
import io.github.rcosteira79.depgraph.serialisation.GraphSerializer
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import java.io.File

private const val GRAPH_JSON_FILENAME: String = "graph.json"
private const val HTML_REPORT_FILENAME: String = "index.html"

abstract class GenerateDependencyGraphTask : DefaultTask() {
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Input
    abstract val modulesOnly: Property<Boolean>

    @TaskAction
    fun generate() {
        val outputDirFile: File = outputDir.get().asFile
        val graph = ModuleAnalyzer.analyze(project.rootProject)

        val classData: Map<String, ModuleClassData>? = if (modulesOnly.get()) {
            null
        } else {
            runClassAnalysis()
        }

        val fullGraph = graph.copy(classData = classData)
        GraphSerializer.serialize(fullGraph, File(outputDirFile, GRAPH_JSON_FILENAME))
        HtmlReportGenerator.generate(fullGraph, File(outputDirFile, HTML_REPORT_FILENAME))
        logger.lifecycle("Dependency graph written to ${outputDirFile.absolutePath}")
    }

    private fun runClassAnalysis(): Map<String, ModuleClassData> {
        val rootProject = project.rootProject
        val extension: DependencyGraphExtension =
            rootProject.extensions.findByType(DependencyGraphExtension::class.java)
                ?: DependencyGraphExtension()
        val variant: String = extension.variant

        val candidates = if (rootProject.subprojects.isEmpty()) {
            listOf(rootProject)
        } else {
            rootProject.subprojects.toList()
        }

        val analysisResults: List<BytecodeAnalysisResult> = candidates.map { subproject ->
            val classDirs: List<File> = resolveClassDirectories(subproject, variant)
            val analyzer = BytecodeClassAnalyzer(moduleId = subproject.path)
            analyzer.analyze(classDirs)
        }

        val moduleEdges: Map<String, Set<String>> = candidates.associate { subproject ->
            subproject.path to subproject.configurations
                .filter { it.name in setOf("implementation", "api", "compileOnly") }
                .flatMap { config ->
                    config.dependencies
                        .filterIsInstance<org.gradle.api.artifacts.ProjectDependency>()
                        .map { @Suppress("DEPRECATION") it.dependencyProject.path }
                }
                .toSet()
        }

        return ClassAnalysisOrchestrator.buildClassData(analysisResults, moduleEdges)
    }

    private fun resolveClassDirectories(subproject: org.gradle.api.Project, variant: String): List<File> {
        val buildDir: File = subproject.layout.buildDirectory.get().asFile
        val isAndroid: Boolean = subproject.pluginManager.hasPlugin("com.android.application") ||
            subproject.pluginManager.hasPlugin("com.android.library")

        return if (isAndroid) {
            listOf(
                File(buildDir, "intermediates/javac/$variant/classes"),
                File(buildDir, "tmp/kotlin-classes/$variant"),
            )
        } else {
            listOf(
                File(buildDir, "classes/java/main"),
                File(buildDir, "classes/kotlin/main"),
            )
        }
    }
}
```

- [ ] **Step 2: Update DependencyGraphPlugin to wire modulesOnly and compile dependencies**

Replace the contents of `gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt`:

```kotlin
package io.github.rcosteira79.depgraph

import org.gradle.api.Action
import org.gradle.api.Plugin
import org.gradle.api.Project

private const val TASK_NAME: String = "generateDependencyGraph"
private const val TASK_GROUP: String = "reporting"
private const val TASK_DESCRIPTION: String = "Generates the module dependency graph report"
private const val OUTPUT_DIR_NAME: String = "dep-graph"
private const val MODULES_ONLY_PROPERTY: String = "modulesOnly"

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        target.allprojects(Action { extensions.create("dependencyGraph", DependencyGraphExtension::class.java) })

        if (target == target.rootProject) {
            target.tasks.register(
                TASK_NAME,
                GenerateDependencyGraphTask::class.java,
                Action {
                    group = TASK_GROUP
                    description = TASK_DESCRIPTION
                    outputDir.convention(target.layout.buildDirectory.dir(OUTPUT_DIR_NAME))
                    modulesOnly.convention(target.provider {
                        target.findProperty(MODULES_ONLY_PROPERTY)?.toString()?.toBoolean() ?: false
                    })
                },
            )

            target.afterEvaluate {
                val task = target.tasks.findByName(TASK_NAME) as? GenerateDependencyGraphTask ?: return@afterEvaluate
                if (task.modulesOnly.get()) return@afterEvaluate

                val extension: DependencyGraphExtension =
                    target.extensions.findByType(DependencyGraphExtension::class.java) ?: return@afterEvaluate
                val variant: String = extension.variant

                target.subprojects.forEach { subproject ->
                    subproject.afterEvaluate {
                        val isAndroid: Boolean = subproject.pluginManager.hasPlugin("com.android.application") ||
                            subproject.pluginManager.hasPlugin("com.android.library")
                        val compileTaskNames: List<String> = if (isAndroid) {
                            val capitalized: String = variant.replaceFirstChar { it.uppercase() }
                            listOf("compile${capitalized}JavaWithJavac", "compile${capitalized}Kotlin")
                        } else {
                            listOf("compileJava", "compileKotlin")
                        }
                        compileTaskNames.forEach { taskName ->
                            subproject.tasks.findByName(taskName)?.let { compileTask ->
                                task.dependsOn(compileTask)
                            }
                        }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 3: Run all existing tests to verify nothing is broken**

Run: `cd gradle-plugin && ./gradlew test -q`

Expected: all tests pass. The integration test may need the fixture updated (next task), but model-level tests should still pass because `classData` defaults to `null`.

- [ ] **Step 4: Commit**

```bash
git add gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/GenerateDependencyGraphTask.kt \
  gradle-plugin/src/main/kotlin/io/github/rcosteira79/depgraph/DependencyGraphPlugin.kt
git commit -m "Wire class analysis into Gradle task with modulesOnly flag"
```

---

### Task 6: Integration tests with fixture classes

**Files:**
- Create: `gradle-plugin/src/test/resources/fixture-project/app/src/main/java/com/example/app/AppMain.java`
- Create: `gradle-plugin/src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Button.java`
- Create: `gradle-plugin/src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Theme.java`
- Modify: `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/integration/GenerateDependencyGraphTaskTest.kt`

- [ ] **Step 1: Add fixture Java source files**

Create `gradle-plugin/src/test/resources/fixture-project/app/src/main/java/com/example/app/AppMain.java`:

```java
package com.example.app;

import com.example.coreui.Button;

public class AppMain {
    private Button button;
}
```

Create `gradle-plugin/src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Button.java`:

```java
package com.example.coreui;

public class Button {
    private String label;
}
```

Create `gradle-plugin/src/test/resources/fixture-project/core-ui/src/main/java/com/example/coreui/Theme.java`:

```java
package com.example.coreui;

public class Theme {
    private String name;
}
```

- [ ] **Step 2: Add integration tests**

Add the following tests to `gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/integration/GenerateDependencyGraphTaskTest.kt`, inside the class body:

```kotlin
    @Test
    fun `task produces classData when modulesOnly is not set`(
        @TempDir tempDir: Path,
    ) {
        copyFixture("fixture-project", tempDir.toFile())

        GradleRunner
            .create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph", "--stacktrace")
            .build()

        val actualGraphJson: File = File(tempDir.toFile(), "build/dep-graph/graph.json")
        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject

        assertEquals(2, actualGraph["schemaVersion"]?.jsonPrimitive?.content?.toInt())

        val actualClassData: JsonObject? = actualGraph["classData"]?.jsonObject
        assertTrue(actualClassData != null, "classData should be present")
        assertTrue(actualClassData!!.containsKey(":app"), "classData should contain :app")
        assertTrue(actualClassData.containsKey(":core-ui"), "classData should contain :core-ui")
    }

    @Test
    fun `classData contains boundary classes for cross-module dependency`(
        @TempDir tempDir: Path,
    ) {
        copyFixture("fixture-project", tempDir.toFile())

        GradleRunner
            .create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph", "--stacktrace")
            .build()

        val actualGraphJson: File = File(tempDir.toFile(), "build/dep-graph/graph.json")
        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject
        val actualClassData: JsonObject = actualGraph["classData"]!!.jsonObject

        // :app should have AppMain as outgoing boundary (it uses Button from :core-ui)
        val actualAppPackages: JsonArray = actualClassData[":app"]!!.jsonObject["packages"]!!.jsonArray
        val actualAppClassNames: List<String> = actualAppPackages.flatMap { pkg ->
            pkg.jsonObject["classes"]!!.jsonArray.map { it.jsonObject["simpleName"]!!.jsonPrimitive.content }
        }
        assertTrue(actualAppClassNames.contains("AppMain"), "AppMain should be a boundary class in :app")

        // :core-ui should have Button as incoming boundary (it is used by :app)
        val actualCorePackages: JsonArray = actualClassData[":core-ui"]!!.jsonObject["packages"]!!.jsonArray
        val actualCoreClassNames: List<String> = actualCorePackages.flatMap { pkg ->
            pkg.jsonObject["classes"]!!.jsonArray.map { it.jsonObject["simpleName"]!!.jsonPrimitive.content }
        }
        assertTrue(actualCoreClassNames.contains("Button"), "Button should be a boundary class in :core-ui")
        // Theme has no cross-module refs, so it should NOT be a boundary class
        assertTrue(!actualCoreClassNames.contains("Theme"), "Theme should not be a boundary class")
    }

    @Test
    fun `modulesOnly flag skips class analysis`(
        @TempDir tempDir: Path,
    ) {
        copyFixture("fixture-project", tempDir.toFile())

        GradleRunner
            .create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph", "-PmodulesOnly=true", "--stacktrace")
            .build()

        val actualGraphJson: File = File(tempDir.toFile(), "build/dep-graph/graph.json")
        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject

        // classData should be absent (null → omitted from JSON)
        assertTrue(
            !actualGraph.containsKey("classData") || actualGraph["classData"]!!.toString() == "null",
            "classData should be null when modulesOnly is set",
        )
    }
```

Also update the first existing test to expect schema version 2:

Replace in the `task runs successfully and produces graph json` test:
```kotlin
        assertEquals(1, actualGraph["schemaVersion"]?.jsonPrimitive?.content?.toInt())
```
With:
```kotlin
        assertEquals(2, actualGraph["schemaVersion"]?.jsonPrimitive?.content?.toInt())
```

- [ ] **Step 3: Run the integration tests**

Run: `cd gradle-plugin && ./gradlew test --tests '*GenerateDependencyGraphTaskTest*' -q`

Expected: all tests PASS. This may take longer than unit tests since it uses GradleRunner.

- [ ] **Step 4: Run the full test suite**

Run: `cd gradle-plugin && ./gradlew test -q`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradle-plugin/src/test/resources/fixture-project/app/src/main/java/ \
  gradle-plugin/src/test/resources/fixture-project/core-ui/src/main/java/ \
  gradle-plugin/src/test/kotlin/io/github/rcosteira79/depgraph/integration/GenerateDependencyGraphTaskTest.kt
git commit -m "Add integration tests for class analysis with fixture classes"
```

---

### Task 7: JS visualization — context menu and module unfolding

**Files:**
- Modify: `gradle-plugin/src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js`

This is the largest task. It adds:
1. Right-click context menu on module nodes
2. Module unfolding into dashed bounding box with package pill nodes
3. Package expansion into class nodes
4. Class highlighting
5. Edge rewiring at each drill-down level

- [ ] **Step 1: Add unfold state variables and constants at the top of the IIFE**

After the existing state variables (after `let isAnimating = false;`), add:

```javascript
  // ── Unfold state ──────────────────────────────────────────────────────────
  const unfoldedModules   = new Map();  // moduleId → classData entry
  const expandedPackages  = new Map();  // moduleId → Set of expanded package names
  let highlightedClassId  = null;

  const hasClassData = !!(data.classData && Object.keys(data.classData).length > 0);

  // Package pill dimensions
  const PILL_W = 180, PILL_H = 24;
  const CLASS_W = 120, CLASS_H = 22;
  const BOX_PAD = 16;
  const PILL_COLORS = {
    INCOMING: '#4fc3f7',
    OUTGOING: '#f5a623',
    BOTH:     '#c084fc',
  };
```

- [ ] **Step 2: Add context menu infrastructure**

After the constants section, add:

```javascript
  // ── Context menu ──────────────────────────────────────────────────────────
  let contextMenu = null;

  function showContextMenu(x, y, items) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#2b2b2b;border:1px solid #555;border-radius:4px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
    items.forEach(item => {
      const row = document.createElement('div');
      row.textContent = item.label;
      row.style.cssText = 'padding:6px 14px;font-size:11px;color:#ccc;cursor:pointer;';
      row.addEventListener('mouseenter', () => { row.style.background = '#3c3c3c'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
      row.addEventListener('click', () => { hideContextMenu(); item.action(); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    contextMenu = menu;
  }

  function hideContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
  }

  document.addEventListener('click', hideContextMenu);
```

- [ ] **Step 3: Add unfold/collapse logic**

```javascript
  function unfoldModule(moduleId) {
    if (!hasClassData || !data.classData[moduleId]) return;
    unfoldedModules.set(moduleId, data.classData[moduleId]);
    expandedPackages.set(moduleId, new Set());
    highlightedClassId = null;
    rerender();
  }

  function collapseModule(moduleId) {
    unfoldedModules.delete(moduleId);
    expandedPackages.delete(moduleId);
    highlightedClassId = null;
    rerender();
  }

  function togglePackage(moduleId, packageName) {
    const expanded = expandedPackages.get(moduleId) || new Set();
    if (expanded.has(packageName)) {
      expanded.delete(packageName);
      highlightedClassId = null;
    } else {
      expanded.add(packageName);
    }
    expandedPackages.set(moduleId, expanded);
    rerender();
  }

  function highlightClass(classId) {
    highlightedClassId = highlightedClassId === classId ? null : classId;
    rerender();
  }
```

- [ ] **Step 4: Modify drawNodes to render unfolded modules**

In the existing `drawNodes` function, inside the `modules.forEach(m => { ... })` loop, wrap the existing node-drawing code in a condition. Before the existing `const pos = nodePos[m.id];` line, add:

```javascript
      // If this module is unfolded, draw the bounding box instead of the normal node
      if (unfoldedModules.has(m.id)) {
        drawUnfoldedModule(m, visibleIds);
        return;
      }
```

Then add the `drawUnfoldedModule` function after `drawNodes`:

```javascript
  function drawUnfoldedModule(m, visibleIds) {
    const pos = nodePos[m.id];
    if (!pos) return;
    const isDim = focusedId && !visibleIds.has(m.id);
    const classDataEntry = unfoldedModules.get(m.id);
    if (!classDataEntry) return;

    const expanded = expandedPackages.get(m.id) || new Set();
    const packages = classDataEntry.packages;
    if (packages.length === 0) { collapseModule(m.id); return; }

    const nodeGroup = document.getElementById('nodes');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    nodeElements[m.id] = g;

    // Compute box dimensions
    let totalHeight = 30; // title area
    let maxWidth = PILL_W + BOX_PAD * 2;
    packages.forEach(pkg => {
      if (expanded.has(pkg.name)) {
        totalHeight += 20 + pkg.classes.length * (CLASS_H + 4);
        maxWidth = Math.max(maxWidth, CLASS_W + BOX_PAD * 2 + 20);
      } else {
        totalHeight += PILL_H + 6;
      }
    });
    totalHeight += BOX_PAD;

    // Dashed bounding box
    const boxW = maxWidth, boxH = totalHeight;
    const border = NODE_BORDERS[m.type] || NODE_BORDERS.unknown;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', -boxW / 2); rect.setAttribute('y', -boxH / 2);
    rect.setAttribute('width', boxW); rect.setAttribute('height', boxH);
    rect.setAttribute('rx', '8'); rect.setAttribute('fill', 'rgba(30,30,30,0.85)');
    rect.setAttribute('stroke', border); rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '6,3');
    rect.setAttribute('opacity', isDim ? '0.12' : '1');
    g.appendChild(rect);

    // Title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', 0); title.setAttribute('y', -boxH / 2 + 18);
    title.setAttribute('text-anchor', 'middle'); title.setAttribute('font-size', '10');
    title.setAttribute('font-family', 'monospace'); title.setAttribute('fill', '#888');
    title.setAttribute('opacity', isDim ? '0.12' : '1');
    title.textContent = m.id;
    title.style.cursor = 'pointer';
    title.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Collapse', action: () => collapseModule(m.id) },
      ]);
    });
    g.appendChild(title);

    // Package pills / expanded classes
    let yOffset = -boxH / 2 + 30;
    packages.forEach(pkg => {
      const color = PILL_COLORS[pkg.boundaryType] || '#888';
      if (expanded.has(pkg.name)) {
        // Package header (collapsible)
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        header.setAttribute('x', -boxW / 2 + BOX_PAD); header.setAttribute('y', yOffset + 12);
        header.setAttribute('font-size', '9'); header.setAttribute('font-family', 'monospace');
        header.setAttribute('fill', color); header.setAttribute('cursor', 'pointer');
        header.textContent = `▾ ${pkg.name}`;
        header.addEventListener('click', () => togglePackage(m.id, pkg.name));
        g.appendChild(header);
        yOffset += 20;

        // Class nodes
        pkg.classes.forEach(cls => {
          const isHighlighted = highlightedClassId === cls.id;
          const clsRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          clsRect.setAttribute('x', -CLASS_W / 2); clsRect.setAttribute('y', yOffset);
          clsRect.setAttribute('width', CLASS_W); clsRect.setAttribute('height', CLASS_H);
          clsRect.setAttribute('rx', '3');
          clsRect.setAttribute('fill', isHighlighted ? '#333' : '#252525');
          clsRect.setAttribute('stroke', isHighlighted ? '#fff' : color);
          clsRect.setAttribute('stroke-width', isHighlighted ? '2' : '0.5');
          clsRect.style.cursor = 'pointer';
          clsRect.addEventListener('click', () => highlightClass(cls.id));
          g.appendChild(clsRect);

          const clsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          clsText.setAttribute('x', 0); clsText.setAttribute('y', yOffset + 14);
          clsText.setAttribute('text-anchor', 'middle'); clsText.setAttribute('font-size', '9');
          clsText.setAttribute('font-family', 'monospace');
          clsText.setAttribute('fill', isHighlighted ? '#fff' : '#aaa');
          clsText.setAttribute('pointer-events', 'none');
          clsText.textContent = cls.simpleName;
          g.appendChild(clsText);

          yOffset += CLASS_H + 4;
        });
      } else {
        // Collapsed pill
        const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        pill.setAttribute('x', -PILL_W / 2); pill.setAttribute('y', yOffset);
        pill.setAttribute('width', PILL_W); pill.setAttribute('height', PILL_H);
        pill.setAttribute('rx', PILL_H / 2); pill.setAttribute('fill', '#1a1a2e');
        pill.setAttribute('stroke', color); pill.setAttribute('stroke-width', '1');
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', () => togglePackage(m.id, pkg.name));
        g.appendChild(pill);

        const pillText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        pillText.setAttribute('x', 0); pillText.setAttribute('y', yOffset + 15);
        pillText.setAttribute('text-anchor', 'middle'); pillText.setAttribute('font-size', '9');
        pillText.setAttribute('font-family', 'monospace'); pillText.setAttribute('fill', color);
        pillText.setAttribute('pointer-events', 'none');
        const shortPkg = pkg.name.split('.').slice(-2).join('.');
        pillText.textContent = `${shortPkg} (${pkg.classes.length})`;
        g.appendChild(pillText);

        yOffset += PILL_H + 6;
      }
    });

    nodeGroup.appendChild(g);

    // Make the bounding box draggable
    const drag = d3.drag()
      .on('start', function (event) { d3.select(this).raise(); })
      .on('drag', function (event) {
        nodePos[m.id].x += event.dx;
        nodePos[m.id].y += event.dy;
        d3.select(g).attr('transform', `translate(${nodePos[m.id].x},${nodePos[m.id].y})`);
        drawEdges(getEffectiveVisibleIds());
      });
    d3.select(g).call(drag);
  }
```

- [ ] **Step 5: Add right-click handler to module nodes**

In the existing `drawNodes` function, find the line where the node group `g` is appended to the DOM and the drag handler is set up. After the drag handler's `.on('end', ...)` callback (where `onNodeClick` is called), add a contextmenu event listener:

```javascript
      d3.select(g).on('contextmenu', function (event) {
        event.preventDefault();
        const items = [];
        if (hasClassData && data.classData[m.id] && data.classData[m.id].packages.length > 0 && !unfoldedModules.has(m.id)) {
          items.push({ label: 'Inspect classes', action: () => unfoldModule(m.id) });
        }
        if (unfoldedModules.has(m.id)) {
          items.push({ label: 'Collapse', action: () => collapseModule(m.id) });
        }
        if (items.length > 0) showContextMenu(event.clientX, event.clientY, items);
      });
```

- [ ] **Step 6: Modify drawEdges for class-level edge rewiring**

In the `drawEdges` function, after drawing all module-level edges, add class-level edge drawing when modules are unfolded:

```javascript
    // ── Class-level edges for unfolded modules ──────────────────────────────
    if (unfoldedModules.size > 0) {
      unfoldedModules.forEach((classDataEntry, moduleId) => {
        classDataEntry.classEdges.forEach(ce => {
          const fromPos = nodePos[ce.fromModuleId];
          const toPos = nodePos[ce.toModuleId];
          if (!fromPos || !toPos) return;
          if (!visibleIds.has(ce.fromModuleId) || !visibleIds.has(ce.toModuleId)) return;

          const isHighlighted = highlightedClassId === ce.fromClassId || highlightedClassId === ce.toClassId;
          const pathD = buildStraightPath(fromPos, toPos, GAP, GAP);

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD);
          path.setAttribute('fill', 'none');
          if (isHighlighted) {
            path.setAttribute('stroke', '#fff');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('opacity', '1');
          } else if (highlightedClassId) {
            path.setAttribute('stroke', 'rgba(255,255,255,0.15)');
            path.setAttribute('stroke-width', '0.8');
            path.setAttribute('opacity', '0.08');
          } else {
            path.setAttribute('stroke', '#c084fc');
            path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-dasharray', '3,2');
            path.setAttribute('opacity', '0.5');
          }
          path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-lit)' : 'url(#arrow-trans)');
          path.style.cursor = 'pointer';
          path.addEventListener('click', () => {
            const detail = document.getElementById('edge-detail');
            detail.innerHTML = `<strong style="color:#c084fc">Class edge</strong><br/>` +
              `<span style="color:#aaa">${ce.fromClassId}</span><br/>` +
              `<span style="color:#555">↓</span><br/>` +
              `<span style="color:#aaa">${ce.toClassId}</span>`;
          });
          edgeGroup.appendChild(path);
        });
      });
    }
```

- [ ] **Step 7: Test the visualization manually**

Run: `cd gradle-plugin && ./gradlew test -q`

Expected: all tests pass. Then test the HTML output manually:
1. Apply the plugin to a multi-module project
2. Run `./gradlew generateDependencyGraph`
3. Open `build/dep-graph/index.html` in a browser
4. Right-click a module → "Inspect classes" should unfold it
5. Click a package pill → should expand to show classes
6. Click a class → should highlight its edges
7. Right-click the module title → "Collapse" should fold it back

- [ ] **Step 8: Commit**

```bash
git add gradle-plugin/src/main/resources/io/github/rcosteira79/depgraph/report/graph-template.js
git commit -m "Add class drill-down visualization with context menu and edge rewiring"
```

---

### Task 8: Final verification and full test run

- [ ] **Step 1: Run full test suite**

Run: `cd gradle-plugin && ./gradlew clean test -q`

Expected: all tests pass.

- [ ] **Step 2: Run the plugin on the fixture and check JSON output**

Run: `cd gradle-plugin && ./gradlew test --tests '*GenerateDependencyGraphTaskTest*' -q --info 2>&1 | tail -20`

Expected: all integration tests pass, including the new class analysis tests.

- [ ] **Step 3: Verify modulesOnly flag works**

Run the integration test for modulesOnly:
`cd gradle-plugin && ./gradlew test --tests '*GenerateDependencyGraphTaskTest.modulesOnly*' -q`

Expected: test passes, confirming classData is null when flag is set.

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
# If there are uncommitted changes:
git add -A gradle-plugin/
git commit -m "Final cleanup for bytecode class analysis feature"
```
