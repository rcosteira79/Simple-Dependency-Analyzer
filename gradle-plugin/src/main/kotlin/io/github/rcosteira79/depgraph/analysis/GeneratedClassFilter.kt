package io.github.rcosteira79.depgraph.analysis

import java.io.File

private val GENERATED_SUFFIXES: List<String> =
    listOf(
        "_Factory",
        "_HiltModules",
        "_GeneratedInjector",
        "_MembersInjector",
        "_ComponentTreeDeps",
        "_HiltComponents",
        "_BindingImpl",
        "_Provide",
    )

private val GENERATED_PREFIXES: List<String> = listOf("Hilt_", "Dagger")

private val GENERATED_EXACT: Set<String> = setOf("BuildConfig", "BR", "DataBinderMapperImpl")

object GeneratedClassFilter {
    fun isGenerated(
        simpleClassName: String,
        classFileDirectory: File,
    ): Boolean {
        if (simpleClassName in GENERATED_EXACT) return true
        if (GENERATED_SUFFIXES.any { simpleClassName.endsWith(it) }) return true
        if (GENERATED_PREFIXES.any { simpleClassName.startsWith(it) }) return true
        if (classFileDirectory.path.contains("/generated/")) return true
        return false
    }
}
