package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModuleAnalyzerTest {
    @Test
    fun `analyzes single-module project with no edges`() {
        val inputRootProject = ProjectBuilder.builder().withName("root").build()
        // Using java-library instead of com.android.application because AGP is not on the test classpath in ProjectBuilder tests
        inputRootProject.pluginManager.apply("java-library")

        val actualGraph = ModuleAnalyzer.analyze(inputRootProject)

        assertEquals(1, actualGraph.modules.size)
        assertEquals(":", actualGraph.modules.first().id)
        assertEquals("core", actualGraph.modules.first().type)
        assertTrue(actualGraph.edges.isEmpty())
    }

    @Test
    fun `collects implementation edge between two subprojects`() {
        val inputRootProject = ProjectBuilder.builder().withName("root").build()
        val inputAppProject =
            ProjectBuilder
                .builder()
                .withName("app")
                .withParent(inputRootProject)
                .build()
        val inputCoreProject =
            ProjectBuilder
                .builder()
                .withName("core-ui")
                .withParent(inputRootProject)
                .build()

        inputAppProject.pluginManager.apply("java-library")
        inputCoreProject.pluginManager.apply("java-library")
        inputAppProject.configurations.maybeCreate("implementation")
        inputAppProject.dependencies.add("implementation", inputCoreProject)

        val actualGraph = ModuleAnalyzer.analyze(inputRootProject)

        val actualEdge = actualGraph.edges.single()
        assertEquals(":app", actualEdge.from)
        assertEquals(":core-ui", actualEdge.to)
        assertEquals("implementation", actualEdge.configuration)
    }

    @Test
    fun `skips buildSrc project`() {
        val inputRootProject = ProjectBuilder.builder().withName("root").build()
        ProjectBuilder
            .builder()
            .withName("buildSrc")
            .withParent(inputRootProject)
            .build()

        val actualGraph = ModuleAnalyzer.analyze(inputRootProject)

        assertTrue(actualGraph.modules.none { it.id == ":buildSrc" })
    }

    @Test
    fun `respects moduleType override from extension`() {
        val inputRootProject = ProjectBuilder.builder().withName("root").build()
        val inputModule =
            ProjectBuilder
                .builder()
                .withName("weird-module")
                .withParent(inputRootProject)
                .build()
        inputModule.pluginManager.apply("java-library")
        // Simulate DSL override
        inputModule.extensions.create("dependencyGraph", DependencyGraphExtension::class.java)
        inputModule.extensions.getByType(DependencyGraphExtension::class.java).moduleType = "feature"

        val actualGraph = ModuleAnalyzer.analyze(inputRootProject)

        val actualModule = actualGraph.modules.find { it.id == ":weird-module" }!!
        assertEquals("feature", actualModule.type)
    }
}
