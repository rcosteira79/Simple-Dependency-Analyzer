package io.github.rcosteira79.depgraph.model

import kotlinx.serialization.Serializable

@Serializable
data class ModuleClassData(
    val moduleId: String,
    val packages: List<PackageNode>,
    val classEdges: List<ClassLevelEdge>,
)

@Serializable
data class PackageNode(
    val name: String,
    val classes: List<BoundaryClass>,
    val boundaryType: BoundaryType,
)

@Serializable
enum class BoundaryType {
    INCOMING,
    OUTGOING,
    BOTH,
}

@Serializable
data class BoundaryClass(
    val id: String,
    val simpleName: String,
)

@Serializable
data class ClassLevelEdge(
    val fromClassId: String,
    val fromModuleId: String,
    val toClassId: String,
    val toModuleId: String,
)
