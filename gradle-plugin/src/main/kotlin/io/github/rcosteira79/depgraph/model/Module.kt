package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class Module(
    val id: String,
    val type: String,
    val path: String,
)
