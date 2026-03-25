package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class Edge(
    val from: String,
    val to: String,
    val configuration: String,
)
