package io.github.rcosteira79.depgraph.analysis

import io.github.rcosteira79.depgraph.model.ModuleType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.util.stream.Stream

class ModuleTypeInferrerTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("inferenceTestCases")
    fun `infers module type from plugin ids and path`(
        description: String,
        inputPluginIds: Set<String>,
        inputModulePath: String,
        inputModuleName: String,
        expectedType: ModuleType,
    ) {
        val actualType =
            ModuleTypeInferrer.infer(
                pluginIds = inputPluginIds,
                modulePath = inputModulePath,
                moduleName = inputModuleName,
            )
        assertEquals(expectedType, actualType)
    }

    companion object {
        @JvmStatic
        fun inferenceTestCases(): Stream<Arguments> =
            Stream.of(
                Arguments.of("com.android.application -> APP", setOf("com.android.application"), ":app", "app", ModuleType.APP),
                Arguments.of(
                    "com.android.dynamic-feature -> FEATURE",
                    setOf("com.android.dynamic-feature"),
                    ":feature-login",
                    "feature-login",
                    ModuleType.FEATURE,
                ),
                Arguments.of(
                    "path containing :feature: (colon variant) -> FEATURE",
                    setOf("com.android.library"),
                    ":feature:profile",
                    "profile",
                    ModuleType.FEATURE,
                ),
                Arguments.of(
                    "name starting with feature- -> FEATURE",
                    setOf("com.android.library"),
                    ":feature-home",
                    "feature-home",
                    ModuleType.FEATURE,
                ),
                Arguments.of(
                    "android library with data in path -> DATA",
                    setOf("com.android.library"),
                    ":data:user",
                    "user",
                    ModuleType.DATA,
                ),
                Arguments.of(
                    "android library with -data in name -> DATA",
                    setOf("com.android.library"),
                    ":data-user",
                    "data-user",
                    ModuleType.DATA,
                ),
                Arguments.of(
                    "android library (no data/feature indicator) -> CORE",
                    setOf("com.android.library"),
                    ":core-ui",
                    "core-ui",
                    ModuleType.CORE,
                ),
                Arguments.of("java-library -> CORE", setOf("java-library"), ":core-utils", "core-utils", ModuleType.CORE),
                Arguments.of(
                    "org.jetbrains.kotlin.jvm -> CORE",
                    setOf("org.jetbrains.kotlin.jvm"),
                    ":core-utils",
                    "core-utils",
                    ModuleType.CORE,
                ),
                Arguments.of("no recognised plugin -> UNKNOWN", emptySet<String>(), ":some-module", "some-module", ModuleType.UNKNOWN),
                Arguments.of(
                    "com.android.application beats feature path",
                    setOf("com.android.application"),
                    ":feature:app",
                    "app",
                    ModuleType.APP,
                ),
                Arguments.of(
                    "path containing /feature/ (slash variant) -> FEATURE",
                    setOf("com.android.library"),
                    ":/feature/profile",
                    "profile",
                    ModuleType.FEATURE,
                ),
                Arguments.of(
                    "name starting with feature: -> FEATURE",
                    setOf("com.android.library"),
                    ":some-module",
                    "feature:profile",
                    ModuleType.FEATURE,
                ),
                Arguments.of(
                    "path containing /data/ (slash variant) -> DATA",
                    setOf("com.android.library"),
                    ":/data/user",
                    "user",
                    ModuleType.DATA,
                ),
                Arguments.of(
                    "name starting with data: -> DATA",
                    setOf("com.android.library"),
                    ":some-module",
                    "data:user",
                    ModuleType.DATA,
                ),
                Arguments.of(
                    "name ending with -data -> DATA",
                    setOf("com.android.library"),
                    ":some-module",
                    "network-data",
                    ModuleType.DATA,
                ),
            )
    }
}
