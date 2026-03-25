package io.github.rcosteira79.depgraph

import org.gradle.api.Action
import org.gradle.api.Plugin
import org.gradle.api.Project

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        // Register the DSL extension on every (sub)project so modules can override their type
        target.allprojects(
            Action {
                extensions.create("dependencyGraph", DependencyGraphExtension::class.java)
            },
        )
        // Register the task only on the root project
        if (target == target.rootProject) {
            target.tasks.register(
                "generateDependencyGraph",
                GenerateDependencyGraphTask::class.java,
                Action {
                    group = "reporting"
                    description = "Generates the module dependency graph report"
                },
            )
        }
    }
}
