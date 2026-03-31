package io.github.rcosteira79.depgraph

import org.gradle.api.Action
import org.gradle.api.Plugin
import org.gradle.api.Project

private const val TASK_NAME: String = "generateDependencyGraph"
private const val TASK_GROUP: String = "reporting"
private const val TASK_DESCRIPTION: String = "Generates the Simple Dependency Analyzer report"
private const val OUTPUT_DIR_NAME: String = "simple-dependency-analyzer"
private const val MODULES_ONLY_PROPERTY: String = "modulesOnly"

class DependencyGraphPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        target.allprojects(Action { extensions.create("dependencyGraph", DependencyGraphExtension::class.java) })

        if (target == target.rootProject) {
            target.tasks.register(
                TASK_NAME,
                GenerateDependencyGraphTask::class.java,
                Action {
                    group = TASK_GROUP
                    description = TASK_DESCRIPTION
                    outputDir.convention(target.layout.buildDirectory.dir(OUTPUT_DIR_NAME))
                    modulesOnly.convention(
                        target.provider {
                            target.findProperty(MODULES_ONLY_PROPERTY)?.toString()?.toBoolean() ?: false
                        },
                    )
                },
            )

            target.afterEvaluate {
                val task = target.tasks.findByName(TASK_NAME) as? GenerateDependencyGraphTask ?: return@afterEvaluate
                if (task.modulesOnly.get()) return@afterEvaluate

                val extension: DependencyGraphExtension =
                    target.extensions.findByType(DependencyGraphExtension::class.java) ?: return@afterEvaluate
                val variant: String = extension.variant

                target.subprojects.forEach { subproject ->
                    subproject.afterEvaluate {
                        val isAndroid: Boolean =
                            subproject.pluginManager.hasPlugin("com.android.application") ||
                                subproject.pluginManager.hasPlugin("com.android.library")
                        if (isAndroid) {
                            // Find compile tasks matching the variant (handles product flavors)
                            val capitalized: String = variant.replaceFirstChar { it.uppercase() }
                            subproject.tasks
                                .matching { t ->
                                    t.name.contains(capitalized) &&
                                        (t.name.startsWith("compile") && (t.name.endsWith("Kotlin") || t.name.endsWith("JavaWithJavac")))
                                }.forEach { compileTask ->
                                    task.dependsOn(compileTask)
                                }
                        } else {
                            listOf("compileJava", "compileKotlin").forEach { taskName ->
                                subproject.tasks.findByName(taskName)?.let { compileTask ->
                                    task.dependsOn(compileTask)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
