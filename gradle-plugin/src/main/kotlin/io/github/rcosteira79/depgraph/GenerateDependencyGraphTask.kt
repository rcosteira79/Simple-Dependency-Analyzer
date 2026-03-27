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

    init {
        // Always regenerate so the report link is printed. The task is fast after compilation.
        outputs.upToDateWhen { false }
    }

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

        val appName: String? = resolveAppName(project.rootProject)
        val fullGraph = graph.copy(appName = appName, classData = classData)
        GraphSerializer.serialize(fullGraph, File(outputDirFile, GRAPH_JSON_FILENAME))
        HtmlReportGenerator.generate(fullGraph, File(outputDirFile, HTML_REPORT_FILENAME))
        val reportFile = File(outputDirFile, HTML_REPORT_FILENAME)
        logger.lifecycle("\n◈ Simple Dependency Analyser report: file://${reportFile.absolutePath}\n")
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

        return ClassAnalysisOrchestrator.buildClassData(analysisResults)
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

    private fun resolveAppName(rootProject: org.gradle.api.Project): String? {
        val appProject: org.gradle.api.Project =
            rootProject.subprojects
                .firstOrNull { it.pluginManager.hasPlugin("com.android.application") }
                ?: return rootProject.name

        val manifestFile: File = File(appProject.projectDir, "src/main/AndroidManifest.xml")
        if (!manifestFile.exists()) return appProject.name

        val manifestText: String = manifestFile.readText()
        val labelMatch: MatchResult =
            Regex("""android:label\s*=\s*"([^"]+)"""").find(manifestText)
                ?: return appProject.name

        val labelValue: String = labelMatch.groupValues[1]

        if (!labelValue.startsWith("@string/")) return labelValue

        val stringName: String = labelValue.removePrefix("@string/")
        val stringsFile: File = File(appProject.projectDir, "src/main/res/values/strings.xml")
        if (!stringsFile.exists()) return appProject.name

        val stringsText: String = stringsFile.readText()
        val stringMatch: MatchResult =
            Regex("""<string\s+name\s*=\s*"${Regex.escape(stringName)}"\s*>([^<]+)</string>""")
                .find(stringsText)
                ?: return appProject.name

        return stringMatch.groupValues[1]
    }
}
