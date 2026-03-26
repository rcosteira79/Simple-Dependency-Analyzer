package io.github.rcosteira79.depgraph.integration

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.gradle.testkit.runner.BuildResult
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

        val actualResult: BuildResult =
            GradleRunner
                .create()
                .withProjectDir(tempDir.toFile())
                .withPluginClasspath()
                .withArguments("generateDependencyGraph", "--stacktrace")
                .build()

        assertEquals(TaskOutcome.SUCCESS, actualResult.task(":generateDependencyGraph")?.outcome)

        val actualGraphJson: File = File(tempDir.toFile(), "build/dep-graph/graph.json")
        assertTrue(actualGraphJson.exists(), "graph.json should exist")

        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject
        assertEquals(2, actualGraph["schemaVersion"]?.jsonPrimitive?.content?.toInt())

        val actualModuleIds: List<String> =
            actualGraph["modules"]!!.jsonArray.map {
                it.jsonObject["id"]!!.jsonPrimitive.content
            }
        assertTrue(actualModuleIds.contains(":app"))
        assertTrue(actualModuleIds.contains(":core-ui"))

        val actualEdges: JsonArray = actualGraph["edges"]!!.jsonArray
        assertEquals(1, actualEdges.size)
        assertEquals(":app", actualEdges[0].jsonObject["from"]!!.jsonPrimitive.content)
        assertEquals(":core-ui", actualEdges[0].jsonObject["to"]!!.jsonPrimitive.content)
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

        val actualHtmlFile: File = File(tempDir.toFile(), "build/dep-graph/index.html")
        assertTrue(actualHtmlFile.exists(), "index.html should exist")
        assertTrue(actualHtmlFile.readText().contains("window.__GRAPH_DATA__"))
    }

    private fun copyFixture(
        fixtureName: String,
        dest: File,
    ) {
        val resource =
            requireNotNull(javaClass.classLoader.getResource(fixtureName)) {
                "Fixture '$fixtureName' not found in test resources"
            }
        val fixtureDir: File = File(resource.toURI())
        fixtureDir.copyRecursively(dest, overwrite = true)
    }
}
