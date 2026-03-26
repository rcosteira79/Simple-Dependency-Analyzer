package io.github.rcosteira79.depgraph

import io.github.rcosteira79.depgraph.analysis.BytecodeAnalysisResult
import io.github.rcosteira79.depgraph.analysis.BytecodeClassAnalyser
import io.github.rcosteira79.depgraph.analysis.ClassAnalysisOrchestrator
import io.github.rcosteira79.depgraph.analysis.ModuleAnalyser
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
        val graph = ModuleAnalyser.analyse(project.rootProject)

        val classData: Map<String, ModuleClassData>? =
            if (modulesOnly.get()) {
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

        val candidates =
            if (rootProject.subprojects.isEmpty()) {
                listOf(rootProject)
            } else {
                rootProject.subprojects.toList()
            }

        val analysisResults: List<BytecodeAnalysisResult> =
            candidates.map { subproject ->
                val classDirs: List<File> = resolveClassDirectories(subproject, variant)
                val analyser = BytecodeClassAnalyser(moduleId = subproject.path)
                analyser.analyse(classDirs)
            }

        val moduleEdges: Map<String, Set<String>> =
            candidates.associate { subproject ->
                subproject.path to
                    subproject.configurations
                        .filter { it.name in setOf("implementation", "api", "compileOnly") }
                        .flatMap { config ->
                            config.dependencies
                                .filterIsInstance<org.gradle.api.artifacts.ProjectDependency>()
                                .map {
                                    // dependencyProject is deprecated since Gradle 8.x; the replacement API
                                    // requires Gradle 8.1+ which we don't mandate yet.
                                    @Suppress("DEPRECATION")
                                    it.dependencyProject.path
                                }
                        }.toSet()
            }

        return ClassAnalysisOrchestrator.buildClassData(analysisResults, moduleEdges)
    }

    private fun resolveClassDirectories(
        subproject: org.gradle.api.Project,
        variant: String,
    ): List<File> {
        val buildDir: File =
            subproject.layout.buildDirectory
                .get()
                .asFile
        val isAndroid: Boolean =
            subproject.pluginManager.hasPlugin("com.android.application") ||
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
