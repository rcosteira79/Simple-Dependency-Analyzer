package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class GraphModel(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val modules: List<Module>,
    val edges: List<Edge>,
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION: Int = 1
    }
}
