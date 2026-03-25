package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModuleAnalyserTest {
    @Test
    fun `analyses single-module project with no edges`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        rootProject.pluginManager.apply("java-library")

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        assertEquals(1, actualGraph.modules.size)
        assertEquals(":", actualGraph.modules.first().id)
        assertEquals("core", actualGraph.modules.first().type)
        assertTrue(actualGraph.edges.isEmpty())
    }

    @Test
    fun `collects implementation edge between two subprojects`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        val appProject =
            ProjectBuilder
                .builder()
                .withName("app")
                .withParent(rootProject)
                .build()
        val coreProject =
            ProjectBuilder
                .builder()
                .withName("core-ui")
                .withParent(rootProject)
                .build()

        appProject.pluginManager.apply("java-library")
        coreProject.pluginManager.apply("java-library")
        appProject.configurations.maybeCreate("implementation")
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
        ProjectBuilder
            .builder()
            .withName("buildSrc")
            .withParent(rootProject)
            .build()

        val actualGraph = ModuleAnalyser.analyse(rootProject)

        assertTrue(actualGraph.modules.none { it.id == ":buildSrc" })
    }

    @Test
    fun `respects moduleType override from extension`() {
        val rootProject = ProjectBuilder.builder().withName("root").build()
        val module =
            ProjectBuilder
                .builder()
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
