package io.github.rcosteira79.depgraph.report

import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class HtmlReportGeneratorTest {
    private val inputGraph =
        GraphModel(
            modules =
                listOf(
                    Module(id = ":app", type = "app", path = "app"),
                    Module(id = ":core-ui", type = "core", path = "core/ui"),
                ),
            edges = listOf(Edge(from = ":app", to = ":core-ui", configuration = "implementation")),
        )

    @Test
    fun `produces a valid html file`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val actualHtml = outputFile.readText()
        assertTrue(actualHtml.trimStart().startsWith("<!DOCTYPE html>"), "Expected HTML doctype")
        assertTrue(actualHtml.contains("<html"), "Expected html tag")
    }

    @Test
    fun `embeds graph data as window __GRAPH_DATA__`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val actualHtml = outputFile.readText()
        assertTrue(actualHtml.contains("window.__GRAPH_DATA__"), "Expected graph data variable")
        assertTrue(actualHtml.contains(":app"), "Expected module id in embedded data")
        assertTrue(actualHtml.contains(":core-ui"), "Expected module id in embedded data")
    }

    @Test
    fun `includes d3 and dagre script references`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        val actualHtml = outputFile.readText()
        assertTrue(actualHtml.contains("d3"), "Expected D3.js reference")
        assertTrue(actualHtml.contains("dagre"), "Expected dagre reference")
    }

    @Test
    fun `creates parent directories if missing`(
        @TempDir tempDir: File,
    ) {
        val outputFile = File(tempDir, "sub/dir/index.html")
        HtmlReportGenerator.generate(inputGraph, outputFile)

        assertTrue(outputFile.exists())
    }
}
