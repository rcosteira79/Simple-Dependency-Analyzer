package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import io.github.rcosteira79.depgraph.model.ModuleType
import org.gradle.api.Project

private val DEPENDENCY_CONFIGURATIONS: Set<String> = setOf("implementation", "api", "compileOnly")
private val EXCLUDED_PROJECTS: Set<String> = setOf("buildSrc")

object ModuleAnalyser {
    fun analyse(rootProject: Project): GraphModel {
        val allProjects: List<Project> =
            rootProject.allprojects
                .filter { it.name !in EXCLUDED_PROJECTS }
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
                .filter { dependency -> dependency.dependencyProject.path in projectPaths }
                .map { dependency ->
                    Edge(
                        from = path,
                        to = dependency.dependencyProject.path,
                        configuration = configurationName,
                    )
                }
        }
}

private fun Project.appliedKnownPluginIds(): Set<String> =
    ModuleTypeInferrer.KNOWN_PLUGIN_IDS
        .filter { id -> pluginManager.hasPlugin(id) }
        .toSet()
