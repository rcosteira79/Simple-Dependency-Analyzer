package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.BoundaryType
import io.github.rcosteira79.depgraph.model.ModuleClassData
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ClassAnalysisOrchestratorTest {
    @Test
    fun `identifies outgoing boundary class`() {
        // Given: :app has AppMain that references core-ui's Button
        val inputAppResult =
            BytecodeAnalysisResult(
                moduleId = ":app",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
                    ),
            )
        val inputCoreResult =
            BytecodeAnalysisResult(
                moduleId = ":core-ui",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        // When:
        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputAppResult, inputCoreResult),
                moduleEdges = inputModuleEdges,
            )

        // Then: AppMain is an outgoing boundary in :app
        val actualAppData: ModuleClassData = actualResult[":app"]!!
        val actualPackage = actualAppData.packages.single()
        assertEquals("com.example.app", actualPackage.name)
        assertEquals(BoundaryType.OUTGOING, actualPackage.boundaryType)
        assertEquals("AppMain", actualPackage.classes.single().simpleName)
    }

    @Test
    fun `identifies incoming boundary class`() {
        val inputAppResult =
            BytecodeAnalysisResult(
                moduleId = ":app",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
                    ),
            )
        val inputCoreResult =
            BytecodeAnalysisResult(
                moduleId = ":core-ui",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputAppResult, inputCoreResult),
                moduleEdges = inputModuleEdges,
            )

        val actualCoreData: ModuleClassData = actualResult[":core-ui"]!!
        val actualPackage = actualCoreData.packages.single()
        assertEquals("com.example.coreui", actualPackage.name)
        assertEquals(BoundaryType.INCOMING, actualPackage.boundaryType)
        assertEquals("Button", actualPackage.classes.single().simpleName)
    }

    @Test
    fun `identifies BOTH boundary type when class is incoming and outgoing`() {
        val inputTopResult =
            BytecodeAnalysisResult(
                moduleId = ":top",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.top.TopClass", "TopClass", "com.example.top"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.top.TopClass" to setOf("com.example.middle.Bridge"),
                    ),
            )
        val inputMiddleResult =
            BytecodeAnalysisResult(
                moduleId = ":middle",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.middle.Bridge", "Bridge", "com.example.middle"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.middle.Bridge" to setOf("com.example.bottom.Foundation"),
                    ),
            )
        val inputBottomResult =
            BytecodeAnalysisResult(
                moduleId = ":bottom",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.bottom.Foundation", "Foundation", "com.example.bottom"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> =
            mapOf(
                ":top" to setOf(":middle"),
                ":middle" to setOf(":bottom"),
            )

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputTopResult, inputMiddleResult, inputBottomResult),
                moduleEdges = inputModuleEdges,
            )

        val actualMiddleData: ModuleClassData = actualResult[":middle"]!!
        val actualPackage = actualMiddleData.packages.single()
        assertEquals(BoundaryType.BOTH, actualPackage.boundaryType)
    }

    @Test
    fun `produces class-level edges`() {
        val inputAppResult =
            BytecodeAnalysisResult(
                moduleId = ":app",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.app.AppMain" to setOf("com.example.coreui.Button"),
                    ),
            )
        val inputCoreResult =
            BytecodeAnalysisResult(
                moduleId = ":core-ui",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputAppResult, inputCoreResult),
                moduleEdges = inputModuleEdges,
            )

        val actualAppEdges = actualResult[":app"]!!.classEdges
        val actualEdge = actualAppEdges.single()
        assertEquals("com.example.app.AppMain", actualEdge.fromClassId)
        assertEquals(":app", actualEdge.fromModuleId)
        assertEquals("com.example.coreui.Button", actualEdge.toClassId)
        assertEquals(":core-ui", actualEdge.toModuleId)
    }

    @Test
    fun `groups boundary classes by package`() {
        val inputAppResult =
            BytecodeAnalysisResult(
                moduleId = ":app",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.app.Login", "Login", "com.example.app"),
                        DiscoveredClass("com.example.app.Signup", "Signup", "com.example.app"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.app.Login" to setOf("com.example.coreui.Button"),
                        "com.example.app.Signup" to setOf("com.example.coreui.Button"),
                    ),
            )
        val inputCoreResult =
            BytecodeAnalysisResult(
                moduleId = ":core-ui",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.coreui.Button", "Button", "com.example.coreui"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> = mapOf(":app" to setOf(":core-ui"))

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputAppResult, inputCoreResult),
                moduleEdges = inputModuleEdges,
            )

        val actualAppData: ModuleClassData = actualResult[":app"]!!
        assertEquals(1, actualAppData.packages.size)
        assertEquals(
            2,
            actualAppData.packages
                .single()
                .classes.size,
        )
    }

    @Test
    fun `excludes modules with no boundary classes`() {
        val inputIsolatedResult =
            BytecodeAnalysisResult(
                moduleId = ":isolated",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.isolated.Internal", "Internal", "com.example.isolated"),
                    ),
                classReferences = emptyMap(),
            )
        val inputModuleEdges: Map<String, Set<String>> = emptyMap()

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputIsolatedResult),
                moduleEdges = inputModuleEdges,
            )

        val actualIsolatedData: ModuleClassData = actualResult[":isolated"]!!
        assertTrue(actualIsolatedData.packages.isEmpty())
    }

    @Test
    fun `ignores references to classes not in any analysed module`() {
        val inputAppResult =
            BytecodeAnalysisResult(
                moduleId = ":app",
                discoveredClasses =
                    listOf(
                        DiscoveredClass("com.example.app.AppMain", "AppMain", "com.example.app"),
                    ),
                classReferences =
                    mapOf(
                        "com.example.app.AppMain" to setOf("com.thirdparty.SomeLib"),
                    ),
            )
        val inputModuleEdges: Map<String, Set<String>> = emptyMap()

        val actualResult: Map<String, ModuleClassData> =
            ClassAnalysisOrchestrator.buildClassData(
                analysisResults = listOf(inputAppResult),
                moduleEdges = inputModuleEdges,
            )

        val actualAppData: ModuleClassData = actualResult[":app"]!!
        assertTrue(actualAppData.packages.isEmpty())
        assertTrue(actualAppData.classEdges.isEmpty())
    }
}
