package io.github.rcosteira79.depgraph.serialization

import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class GraphSerializerTest {
    @Test
    fun `writes valid json to output file`(
        @TempDir tempDir: File,
    ) {
        val inputGraph =
            GraphModel(
                modules = listOf(Module(id = ":app", type = "app", path = "app")),
                edges = emptyList(),
            )
        val outputFile = File(tempDir, "graph.json")

        GraphSerializer.serialize(inputGraph, outputFile)

        val actualGraph = Json.decodeFromString<GraphModel>(outputFile.readText())
        assertEquals(inputGraph, actualGraph)
        assertEquals(2, actualGraph.schemaVersion)
    }

    @Test
    fun `output contains schemaVersion field`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "graph.json")
        GraphSerializer.serialize(GraphModel(modules = emptyList(), edges = emptyList()), outputFile)

        val actualJson = outputFile.readText()
        assert(actualJson.contains("\"schemaVersion\"")) { "Expected schemaVersion in output" }
    }

    @Test
    fun `creates parent directories if missing`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "sub/dir/graph.json")
        GraphSerializer.serialize(GraphModel(modules = emptyList(), edges = emptyList()), outputFile)

        assert(outputFile.exists())
    }
}
