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

        val actualGraphJson: File = File(tempDir.toFile(), "build/simple-dependency-analyzer/graph.json")
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

        val actualHtmlFile: File = File(tempDir.toFile(), "build/simple-dependency-analyzer/index.html")
        assertTrue(actualHtmlFile.exists(), "index.html should exist")
        assertTrue(actualHtmlFile.readText().contains("window.__GRAPH_DATA__"))
    }

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

        val actualGraphJson: File = File(tempDir.toFile(), "build/simple-dependency-analyzer/graph.json")
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

        val actualGraphJson: File = File(tempDir.toFile(), "build/simple-dependency-analyzer/graph.json")
        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject
        val actualClassData: JsonObject = actualGraph["classData"]!!.jsonObject

        // :app should have AppMain as outgoing boundary (it uses Button from :core-ui)
        val actualAppPackages: JsonArray = actualClassData[":app"]!!.jsonObject["packages"]!!.jsonArray
        val actualAppClassNames: List<String> =
            actualAppPackages.flatMap { pkg ->
                pkg.jsonObject["classes"]!!.jsonArray.map { it.jsonObject["simpleName"]!!.jsonPrimitive.content }
            }
        assertTrue(actualAppClassNames.contains("AppMain"), "AppMain should be a boundary class in :app")

        // :core-ui should have Button as incoming boundary (it is used by :app)
        val actualCorePackages: JsonArray = actualClassData[":core-ui"]!!.jsonObject["packages"]!!.jsonArray
        val actualCoreClassNames: List<String> =
            actualCorePackages.flatMap { pkg ->
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

        val actualGraphJson: File = File(tempDir.toFile(), "build/simple-dependency-analyzer/graph.json")
        val actualGraph: JsonObject = Json.parseToJsonElement(actualGraphJson.readText()).jsonObject

        // classData should be absent (null → omitted from JSON)
        assertTrue(
            !actualGraph.containsKey("classData") || actualGraph["classData"]!!.toString() == "null",
            "classData should be null when modulesOnly is set",
        )
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
