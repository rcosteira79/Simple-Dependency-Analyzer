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
        modulePath: String,
        moduleName: String,
    ): Boolean =
        modulePath.contains("/feature/") ||
            modulePath.contains(":feature:") ||
            moduleName.startsWith("feature-") ||
            moduleName.startsWith("feature:")

    /**
     * Returns true if the module's path or name indicates a data module.
     * Conventions: path segment "data", name prefix "data-"/"data:", name suffix "-data".
     */
    private fun isDataByPath(
        modulePath: String,
        moduleName: String,
    ): Boolean =
        modulePath.contains("/data/") ||
            modulePath.contains(":data:") ||
            moduleName.startsWith("data-") ||
            moduleName.startsWith("data:") ||
            moduleName.endsWith("-data")
}
