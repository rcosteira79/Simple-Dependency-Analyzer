package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import io.github.rcosteira79.depgraph.model.ModuleType
import org.gradle.api.Project

private val DEPENDENCY_CONFIGURATIONS: Set<String> = setOf("implementation", "api", "compileOnly")
private val EXCLUDED_PROJECTS: Set<String> = setOf("buildSrc")

object ModuleAnalyzer {
    fun analyze(rootProject: Project): GraphModel {
        // For multi-module projects, exclude the root (it's just a container).
        // For single-module projects, the root IS the module — include it.
        val candidates: Collection<Project> =
            if (rootProject.subprojects.isEmpty()) {
                listOf(rootProject)
            } else {
                rootProject.subprojects
            }
        val allProjects: List<Project> =
            candidates.filter { project ->
                project.name !in EXCLUDED_PROJECTS && !isContainerProject(project)
            }
        val projectPaths: Set<String> = allProjects.map { it.path }.toSet()

        val modules: List<Module> = allProjects.map { project -> project.toModule() }
        val edges: List<Edge> = allProjects.flatMap { project -> project.collectEdges(projectPaths) }

        return GraphModel(modules = modules, edges = edges)
    }

    private fun Project.toModule(): Module {
        val overriddenType: String? = extensions.findByType(DependencyGraphExtension::class.java)?.moduleType
        val inferredType: ModuleType =
            ModuleTypeInferrer.infer(
                pluginIds = appliedKnownPluginIds(),
                modulePath = path,
                moduleName = name,
            )
        return Module(
            id = path,
            type = overriddenType ?: inferredType.name.lowercase(),
            path = projectDir.relativeTo(rootProject.projectDir).path,
        )
    }

    private fun Project.collectEdges(projectPaths: Set<String>): List<Edge> =
        DEPENDENCY_CONFIGURATIONS.flatMap { configurationName ->
            val configuration = configurations.findByName(configurationName) ?: return@flatMap emptyList()

            configuration.dependencies
                .filterIsInstance<org.gradle.api.artifacts.ProjectDependency>()
                .mapNotNull { dependency ->
                    val depPath: String = resolveProjectDependencyPath(dependency) ?: return@mapNotNull null
                    if (depPath !in projectPaths) return@mapNotNull null
                    Edge(from = path, to = depPath, configuration = configurationName)
                }
        }
}

private fun resolveProjectDependencyPath(dependency: org.gradle.api.artifacts.ProjectDependency): String? =
    try {
        // Gradle 9+: ProjectDependency has a getPath() method
        dependency::class.java.getMethod("getPath").invoke(dependency) as? String
    } catch (_: NoSuchMethodException) {
        try {
            // Gradle 8.x: use deprecated getDependencyProject()
            val project = dependency::class.java.getMethod("getDependencyProject").invoke(dependency)
            project::class.java.getMethod("getPath").invoke(project) as? String
        } catch (_: Exception) {
            null
        }
    }

private fun isContainerProject(project: Project): Boolean = project.subprojects.isNotEmpty() && project.appliedKnownPluginIds().isEmpty()

private fun Project.appliedKnownPluginIds(): Set<String> =
    ModuleTypeInferrer.KNOWN_PLUGIN_IDS
        .filter { id -> pluginManager.hasPlugin(id) }
        .toSet()
