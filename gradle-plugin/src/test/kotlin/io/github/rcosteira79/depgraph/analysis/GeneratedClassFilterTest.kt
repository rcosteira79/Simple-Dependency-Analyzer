package io.github.rcosteira79.depgraph.analysis

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class GeneratedClassFilterTest {
    @Test
    fun `filters Hilt prefixed classes`() {
        val inputClassName = "Hilt_MyActivity"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters Dagger prefixed classes`() {
        val inputClassName = "DaggerAppComponent"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters Factory suffixed classes`() {
        val inputClassName = "MyModule_Factory"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters HiltModules suffixed classes`() {
        val inputClassName = "MyApp_HiltModules"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters BuildConfig exact match`() {
        val inputClassName = "BuildConfig"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters BR exact match`() {
        val inputClassName = "BR"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters DataBinderMapperImpl exact match`() {
        val inputClassName = "DataBinderMapperImpl"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters classes under generated directory`() {
        val inputClassName = "NormalClassName"
        val inputDirectory = File("build/generated/ksp/debug/kotlin")
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, inputDirectory)
        assertTrue(actualResult)
    }

    @Test
    fun `does not filter normal classes in source directories`() {
        val inputClassName = "LoginViewModel"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("build/classes/kotlin/main"))
        assertFalse(actualResult)
    }

    @Test
    fun `filters GeneratedInjector suffixed classes`() {
        val inputClassName = "MyApp_GeneratedInjector"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }

    @Test
    fun `filters MembersInjector suffixed classes`() {
        val inputClassName = "MyActivity_MembersInjector"
        val actualResult: Boolean = GeneratedClassFilter.isGenerated(inputClassName, File("src/main"))
        assertTrue(actualResult)
    }
}
