package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.BoundaryClass
import io.github.rcosteira79.depgraph.model.BoundaryType
import io.github.rcosteira79.depgraph.model.ClassLevelEdge
import io.github.rcosteira79.depgraph.model.ModuleClassData
import io.github.rcosteira79.depgraph.model.PackageNode

object ClassAnalysisOrchestrator {
    fun buildClassData(
        analysisResults: List<BytecodeAnalysisResult>,
        moduleEdges: Map<String, Set<String>>,
    ): Map<String, ModuleClassData> {
        val classToModule: Map<String, String> =
            analysisResults
                .flatMap { result ->
                    result.discoveredClasses.map { it.qualifiedName to result.moduleId }
                }.toMap()

        val classInfoByName: Map<String, DiscoveredClass> =
            analysisResults
                .flatMap { result ->
                    result.discoveredClasses
                }.associateBy { it.qualifiedName }

        val allClassEdges: List<ClassLevelEdge> =
            analysisResults
                .flatMap { result ->
                    result.classReferences.flatMap { (sourceClass, targetClasses) ->
                        val sourceModule: String = result.moduleId
                        targetClasses.mapNotNull { targetClass ->
                            val targetModule: String = classToModule[targetClass] ?: return@mapNotNull null
                            if (targetModule == sourceModule) return@mapNotNull null
                            ClassLevelEdge(
                                fromClassId = sourceClass,
                                fromModuleId = sourceModule,
                                toClassId = targetClass,
                                toModuleId = targetModule,
                            )
                        }
                    }
                }.distinct()

        val outgoingByModule: Map<String, Set<String>> =
            allClassEdges
                .groupBy { it.fromModuleId }
                .mapValues { (_, edges) -> edges.map { it.fromClassId }.toSet() }

        val incomingByModule: Map<String, Set<String>> =
            allClassEdges
                .groupBy { it.toModuleId }
                .mapValues { (_, edges) -> edges.map { it.toClassId }.toSet() }

        return analysisResults.associate { result ->
            val moduleId: String = result.moduleId
            val outgoingClassIds: Set<String> = outgoingByModule[moduleId] ?: emptySet()
            val incomingClassIds: Set<String> = incomingByModule[moduleId] ?: emptySet()
            val boundaryClassIds: Set<String> = outgoingClassIds + incomingClassIds

            val boundaryClasses: List<Pair<DiscoveredClass, BoundaryType>> =
                boundaryClassIds.mapNotNull { classId ->
                    val classInfo: DiscoveredClass = classInfoByName[classId] ?: return@mapNotNull null
                    val isOutgoing: Boolean = classId in outgoingClassIds
                    val isIncoming: Boolean = classId in incomingClassIds
                    val boundaryType: BoundaryType =
                        when {
                            isOutgoing && isIncoming -> BoundaryType.BOTH
                            isOutgoing -> BoundaryType.OUTGOING
                            else -> BoundaryType.INCOMING
                        }
                    classInfo to boundaryType
                }

            val packages: List<PackageNode> =
                boundaryClasses
                    .groupBy { it.first.packageName }
                    .map { (packageName, classesWithType) ->
                        val packageBoundaryType: BoundaryType =
                            classesWithType
                                .map { it.second }
                                .reduce { acc, type -> combineBoundaryTypes(acc, type) }
                        PackageNode(
                            name = packageName,
                            classes =
                                classesWithType.map { (cls, _) ->
                                    BoundaryClass(id = cls.qualifiedName, simpleName = cls.simpleName)
                                },
                            boundaryType = packageBoundaryType,
                        )
                    }

            val moduleClassEdges: List<ClassLevelEdge> = allClassEdges.filter { it.fromModuleId == moduleId }

            moduleId to
                ModuleClassData(
                    moduleId = moduleId,
                    packages = packages,
                    classEdges = moduleClassEdges,
                )
        }
    }

    private fun combineBoundaryTypes(
        a: BoundaryType,
        b: BoundaryType,
    ): BoundaryType = if (a == b) a else BoundaryType.BOTH
}
