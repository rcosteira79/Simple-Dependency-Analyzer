package io.github.rcosteira79.depgraph

import io.github.rcosteira79.depgraph.analysis.ModuleAnalyser
import io.github.rcosteira79.depgraph.report.HtmlReportGenerator
import io.github.rcosteira79.depgraph.serialisation.GraphSerializer
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import java.io.File

private const val GRAPH_JSON_FILENAME: String = "graph.json"
private const val HTML_REPORT_FILENAME: String = "index.html"

abstract class GenerateDependencyGraphTask : DefaultTask() {
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val outputDirFile: File = outputDir.get().asFile
        val graph = ModuleAnalyser.analyse(project.rootProject)
        GraphSerializer.serialize(graph, File(outputDirFile, GRAPH_JSON_FILENAME))
        HtmlReportGenerator.generate(graph, File(outputDirFile, HTML_REPORT_FILENAME))
        logger.lifecycle("Dependency graph written to ${outputDirFile.absolutePath}")
    }
}
