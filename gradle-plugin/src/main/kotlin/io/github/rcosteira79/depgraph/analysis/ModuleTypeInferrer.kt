package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.ModuleType

object ModuleTypeInferrer {
    fun infer(
        pluginIds: Set<String>,
        modulePath: String,
        moduleName: String,
    ): ModuleType =
        when {
            pluginIds.contains("com.android.application") -> ModuleType.APP
            pluginIds.contains("com.android.dynamic-feature") -> ModuleType.FEATURE
            isFeatureByPath(modulePath, moduleName) -> ModuleType.FEATURE
            pluginIds.contains("com.android.library") && isDataByPath(modulePath, moduleName) -> ModuleType.DATA
            pluginIds.contains("com.android.library") -> ModuleType.CORE
            pluginIds.contains("java-library") -> ModuleType.CORE
            pluginIds.contains("org.jetbrains.kotlin.jvm") -> ModuleType.CORE
            else -> ModuleType.UNKNOWN
        }

    private fun isFeatureByPath(
        path: String,
        name: String,
    ): Boolean =
        path.contains("/feature/") ||
            path.contains(":feature:") ||
            name.startsWith("feature-") ||
            name.startsWith("feature:")

    private fun isDataByPath(
        path: String,
        name: String,
    ): Boolean =
        path.contains("/data/") ||
            path.contains(":data:") ||
            name.startsWith("data-") ||
            name.startsWith("data:") ||
            name.endsWith("-data")
}
