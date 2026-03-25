package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.DependencyGraphExtension
import io.github.rcosteira79.depgraph.model.Edge
import io.github.rcosteira79.depgraph.model.GraphModel
import io.github.rcosteira79.depgraph.model.Module
import org.gradle.api.Project

private val DEPENDENCY_CONFIGURATIONS: Set<String> = setOf("implementation", "api", "compileOnly")
private val EXCLUDED_PROJECTS: Set<String> = setOf("buildSrc")

object ModuleAnalyser {
    fun analyse(rootProject: Project): GraphModel {
        val allProjects: List<Project> =
            rootProject.allprojects
                .filter { project -> project.name !in EXCLUDED_PROJECTS }

        val modules: List<Module> = allProjects.map { project -> project.toModule() }
        val edges: List<Edge> = allProjects.flatMap { project -> project.collectEdges(allProjects) }

        return GraphModel(modules = modules, edges = edges)
    }

    private fun Project.toModule(): Module {
        val extension: DependencyGraphExtension? = extensions.findByType(DependencyGraphExtension::class.java)
        val overriddenType: String? = extension?.moduleType

        val inferredType: io.github.rcosteira79.depgraph.model.ModuleType =
            ModuleTypeInferrer.infer(
                pluginIds =
                    buildSet {
                        if (pluginManager.hasPlugin("com.android.application")) add("com.android.application")
                        if (pluginManager.hasPlugin("com.android.dynamic-feature")) add("com.android.dynamic-feature")
                        if (pluginManager.hasPlugin("com.android.library")) add("com.android.library")
                        if (pluginManager.hasPlugin("java-library")) add("java-library")
                        if (pluginManager.hasPlugin("org.jetbrains.kotlin.jvm")) add("org.jetbrains.kotlin.jvm")
                    },
                modulePath = path,
                moduleName = name,
            )

        return Module(
            id = path,
            type = overriddenType ?: inferredType.name.lowercase(),
            path = projectDir.relativeTo(rootProject.projectDir).path,
        )
    }

    private fun Project.collectEdges(allProjects: List<Project>): List<Edge> {
        val projectPaths: Set<String> = allProjects.map { project -> project.path }.toSet()

        return DEPENDENCY_CONFIGURATIONS.flatMap { configurationName ->
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
}
