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
    fun `task runs successfully and produces graph json`(
        @TempDir tempDir: Path,
    ) {
        copyFixture("fixture-project", tempDir.toFile())

        val result =
            GradleRunner
                .create()
                .withProjectDir(tempDir.toFile())
                .withPluginClasspath()
                .withArguments("generateDependencyGraph", "--stacktrace")
                .build()

        assertEquals(TaskOutcome.SUCCESS, result.task(":generateDependencyGraph")?.outcome)

        val graphJson = File(tempDir.toFile(), "build/dep-graph/graph.json")
        assertTrue(graphJson.exists(), "graph.json should exist")

        val parsed = Json.parseToJsonElement(graphJson.readText()).jsonObject
        assertEquals(1, parsed["schemaVersion"]?.jsonPrimitive?.content?.toInt())

        val moduleIds =
            parsed["modules"]!!.jsonArray.map {
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
    fun `task also produces index html`(
        @TempDir tempDir: Path,
    ) {
        copyFixture("fixture-project", tempDir.toFile())
        GradleRunner
            .create()
            .withProjectDir(tempDir.toFile())
            .withPluginClasspath()
            .withArguments("generateDependencyGraph")
            .build()

        val htmlFile = File(tempDir.toFile(), "build/dep-graph/index.html")
        assertTrue(htmlFile.exists(), "index.html should exist")
        assertTrue(htmlFile.readText().contains("window.__GRAPH_DATA__"))
    }

    private fun copyFixture(
        fixtureName: String,
        dest: File,
    ) {
        val fixtureDir: File = File(javaClass.classLoader.getResource(fixtureName)!!.toURI())
        fixtureDir.copyRecursively(dest, overwrite = true)
    }
}
