package io.github.rcosteira79.depgraph.analysis

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import javax.tools.ToolProvider

class BytecodeClassAnalyzerTest {
    @Test
    fun `discovers classes in a directory`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Foo.java" to
                    """
                    package com.example;
                    public class Foo {}
                    """.trimIndent(),
                "com/example/Bar.java" to
                    """
                    package com.example;
                    public class Bar {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualClassNames: Set<String> = actualResult.discoveredClasses.map { it.qualifiedName }.toSet()
        assertEquals(setOf("com.example.Foo", "com.example.Bar"), actualClassNames)
    }

    @Test
    fun `extracts field type reference`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Bar.java" to
                    """
                    package com.example;
                    public class Bar {}
                    """.trimIndent(),
                "com/example/Foo.java" to
                    """
                    package com.example;
                    public class Foo { private Bar bar; }
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualFooRefs: Set<String> = actualResult.classReferences["com.example.Foo"] ?: emptySet()
        assertTrue(actualFooRefs.contains("com.example.Bar"))
    }

    @Test
    fun `extracts method return type reference`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Result.java" to
                    """
                    package com.example;
                    public class Result {}
                    """.trimIndent(),
                "com/example/Service.java" to
                    """
                    package com.example;
                    public class Service { public Result process() { return null; } }
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Service"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Result"))
    }

    @Test
    fun `extracts superclass reference`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Base.java" to
                    """
                    package com.example;
                    public class Base {}
                    """.trimIndent(),
                "com/example/Child.java" to
                    """
                    package com.example;
                    public class Child extends Base {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Child"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Base"))
    }

    @Test
    fun `extracts interface reference`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Clickable.java" to
                    """
                    package com.example;
                    public interface Clickable {}
                    """.trimIndent(),
                "com/example/Button.java" to
                    """
                    package com.example;
                    public class Button implements Clickable {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Button"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Clickable"))
    }

    @Test
    fun `extracts NEW instruction reference`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Bar.java" to
                    """
                    package com.example;
                    public class Bar {}
                    """.trimIndent(),
                "com/example/Foo.java" to
                    """
                    package com.example;
                    public class Foo { public Bar create() { return new Bar(); } }
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Foo"] ?: emptySet()
        assertTrue(actualRefs.contains("com.example.Bar"))
    }

    @Test
    fun `filters generated classes by name`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Hilt_MyActivity.java" to
                    """
                    package com.example;
                    public class Hilt_MyActivity {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        assertTrue(actualResult.discoveredClasses.none { it.qualifiedName == "com.example.Hilt_MyActivity" })
    }

    @Test
    fun `excludes self-references`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Standalone.java" to
                    """
                    package com.example;
                    public class Standalone {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Standalone"] ?: emptySet()
        assertTrue(!actualRefs.contains("com.example.Standalone"))
    }

    @Test
    fun `excludes java stdlib references`(
        @TempDir tempDir: File,
    ) {
        val classesDir: File =
            compileJavaSources(
                tempDir,
                "com/example/Holder.java" to
                    """
                    package com.example;
                    import java.util.List;
                    public class Holder { private List<String> items; }
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(classesDir))

        val actualRefs: Set<String> = actualResult.classReferences["com.example.Holder"] ?: emptySet()
        assertTrue(actualRefs.none { it.startsWith("java.") })
    }

    @Test
    fun `handles multiple class directories`(
        @TempDir tempDir: File,
    ) {
        val javaClassesDir: File =
            compileJavaSources(
                File(tempDir, "java-classes"),
                "com/example/JavaClass.java" to
                    """
                    package com.example;
                    public class JavaClass {}
                    """.trimIndent(),
            )
        val kotlinClassesDir: File =
            compileJavaSources(
                File(tempDir, "kotlin-classes"),
                "com/example/KotlinClass.java" to
                    """
                    package com.example;
                    public class KotlinClass {}
                    """.trimIndent(),
            )
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(javaClassesDir, kotlinClassesDir))

        val actualClassNames: Set<String> = actualResult.discoveredClasses.map { it.qualifiedName }.toSet()
        assertEquals(setOf("com.example.JavaClass", "com.example.KotlinClass"), actualClassNames)
    }

    @Test
    fun `returns empty result for empty directories`(
        @TempDir tempDir: File,
    ) {
        val emptyDir: File = File(tempDir, "empty").also { it.mkdirs() }
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(emptyDir))

        assertTrue(actualResult.discoveredClasses.isEmpty())
        assertTrue(actualResult.classReferences.isEmpty())
    }

    @Test
    fun `returns empty result for nonexistent directories`(
        @TempDir tempDir: File,
    ) {
        val missingDir = File(tempDir, "does-not-exist")
        val analyzer = BytecodeClassAnalyzer(moduleId = ":mymodule")

        val actualResult: BytecodeAnalysisResult = analyzer.analyze(listOf(missingDir))

        assertTrue(actualResult.discoveredClasses.isEmpty())
        assertTrue(actualResult.classReferences.isEmpty())
    }

    private fun compileJavaSources(
        outputBaseDir: File,
        vararg sources: Pair<String, String>,
    ): File {
        val srcDir = File(outputBaseDir, "src").also { it.mkdirs() }
        val classesDir = File(outputBaseDir, "classes").also { it.mkdirs() }

        val sourceFiles: List<File> =
            sources.map { (path, content) ->
                File(srcDir, path).also {
                    it.parentFile.mkdirs()
                    it.writeText(content)
                }
            }

        val compiler = ToolProvider.getSystemJavaCompiler()
        val fileManager = compiler.getStandardFileManager(null, null, null)
        val compilationUnits = fileManager.getJavaFileObjectsFromFiles(sourceFiles)
        val task =
            compiler.getTask(
                null,
                fileManager,
                null,
                listOf("-d", classesDir.absolutePath),
                null,
                compilationUnits,
            )
        check(task.call()) { "Compilation failed" }
        fileManager.close()

        return classesDir
    }
}
