package io.github.rcosteira79.depgraph

import io.github.rcosteira79.depgraph.analysis.ModuleAnalyser
import io.github.rcosteira79.depgraph.report.HtmlReportGenerator
import io.github.rcosteira79.depgraph.serialisation.GraphSerializer
import org.gradle.api.DefaultTask
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import java.io.File

abstract class GenerateDependencyGraphTask : DefaultTask() {
    @get:OutputDirectory
    val outputDir: File
        get() =
            project.layout.buildDirectory
                .dir("dep-graph")
                .get()
                .asFile

    @TaskAction
    fun generate() {
        val graph = ModuleAnalyser.analyse(project.rootProject)
        GraphSerializer.serialize(graph, File(outputDir, "graph.json"))
        HtmlReportGenerator.generate(graph, File(outputDir, "index.html"))
        logger.lifecycle("Dependency graph written to ${outputDir.absolutePath}")
    }
}
