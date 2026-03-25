package io.github.rcosteira79.depgraph

import org.gradle.api.Action
import org.gradle.api.Plugin
import org.gradle.api.Project

private const val TASK_NAME: String = "generateDependencyGraph"
private const val TASK_GROUP: String = "reporting"
private const val TASK_DESCRIPTION: String = "Generates the module dependency graph report"
private const val OUTPUT_DIR_NAME: String = "dep-graph"

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        // Register the DSL extension on every (sub)project so modules can override their type
        target.allprojects(Action { extensions.create("dependencyGraph", DependencyGraphExtension::class.java) })
        // Register the task only on the root project
        if (target == target.rootProject) {
            target.tasks.register(
                TASK_NAME,
                GenerateDependencyGraphTask::class.java,
                Action {
                    group = TASK_GROUP
                    description = TASK_DESCRIPTION
                    outputDir.convention(target.layout.buildDirectory.dir(OUTPUT_DIR_NAME))
                },
            )
        }
    }
}
