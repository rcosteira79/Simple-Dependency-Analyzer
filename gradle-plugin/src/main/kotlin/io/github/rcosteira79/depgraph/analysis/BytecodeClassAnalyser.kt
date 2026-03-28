package io.github.rcosteira79.depgraph.analysis

import org.objectweb.asm.AnnotationVisitor
import org.objectweb.asm.ClassReader
import org.objectweb.asm.ClassVisitor
import org.objectweb.asm.FieldVisitor
import org.objectweb.asm.MethodVisitor
import org.objectweb.asm.Opcodes
import org.objectweb.asm.Type
import java.io.File
import java.io.InputStream

data class DiscoveredClass(
    val qualifiedName: String,
    val simpleName: String,
    val packageName: String,
)

data class BytecodeAnalysisResult(
    val moduleId: String,
    val discoveredClasses: List<DiscoveredClass>,
    val classReferences: Map<String, Set<String>>,
    val inlineReferences: Map<String, Set<String>>,
)

class BytecodeClassAnalyser(
    private val moduleId: String,
) {
    fun analyse(classDirectories: List<File>): BytecodeAnalysisResult {
        val discoveredClasses: MutableList<DiscoveredClass> = mutableListOf()
        val classReferences: MutableMap<String, MutableSet<String>> = mutableMapOf()
        val inlineReferences: MutableMap<String, MutableSet<String>> = mutableMapOf()

        classDirectories
            .filter { it.exists() && it.isDirectory }
            .forEach { dir ->
                dir
                    .walkTopDown()
                    .filter { it.isFile && it.extension == "class" }
                    .forEach { classFile ->
                        analyseClassFile(classFile, discoveredClasses, classReferences, inlineReferences)
                    }
            }

        return BytecodeAnalysisResult(
            moduleId = moduleId,
            discoveredClasses = discoveredClasses,
            classReferences = classReferences,
            inlineReferences = inlineReferences,
        )
    }

    private fun analyseClassFile(
        classFile: File,
        discoveredClasses: MutableList<DiscoveredClass>,
        classReferences: MutableMap<String, MutableSet<String>>,
        inlineReferences: MutableMap<String, MutableSet<String>>,
    ) {
        val inputStream: InputStream = classFile.inputStream()
        val classReader = ClassReader(inputStream.use { it.readBytes() })
        val internalName: String = classReader.className
        val qualifiedName: String = internalName.replace('/', '.')

        val simpleName: String = qualifiedName.substringAfterLast('.')
        val packageName: String = qualifiedName.substringBeforeLast('.', "")

        if (GeneratedClassFilter.isGenerated(simpleName, classFile.parentFile)) return

        val isInnerClass: Boolean = simpleName.contains('$')
        // For inner/anonymous classes, attribute references to the outer class
        val ownerName: String =
            if (isInnerClass) {
                qualifiedName.substringBefore('$')
            } else {
                qualifiedName
            }

        if (!isInnerClass) {
            discoveredClasses +=
                DiscoveredClass(
                    qualifiedName = qualifiedName,
                    simpleName = simpleName,
                    packageName = packageName,
                )
        }

        val directRefs: MutableSet<String> = mutableSetOf()
        val smapRefs: MutableSet<String> = mutableSetOf()
        classReader.accept(ReferenceCollector(directRefs, smapRefs), ClassReader.SKIP_FRAMES)

        fun filterRefs(refs: Set<String>): Set<String> =
            refs
                .filter { it != qualifiedName && it != ownerName }
                .filter { !it.startsWith("java.") && !it.startsWith("javax.") }
                .filter { !it.startsWith("kotlin.") && !it.startsWith("kotlinx.") }
                .filter { !it.contains('$') }
                .toSet()

        val filteredDirect: Set<String> = filterRefs(directRefs)
        val filteredInline: Set<String> = filterRefs(smapRefs) - filteredDirect

        if (filteredDirect.isNotEmpty()) {
            classReferences.getOrPut(ownerName) { mutableSetOf() } += filteredDirect
        }
        if (filteredInline.isNotEmpty()) {
            inlineReferences.getOrPut(ownerName) { mutableSetOf() } += filteredInline
        }
    }
}

private class ReferenceCollector(
    private val refs: MutableSet<String>,
    private val smapRefs: MutableSet<String>,
) : ClassVisitor(Opcodes.ASM9) {
    override fun visit(
        version: Int,
        access: Int,
        name: String?,
        signature: String?,
        superName: String?,
        interfaces: Array<out String>?,
    ) {
        superName?.let { addInternalName(it) }
        interfaces?.forEach { addInternalName(it) }
    }

    override fun visitSource(
        source: String?,
        debug: String?,
    ) {
        // Parse Kotlin SMAP debug info to find inlined function origins.
        // SMAP format contains lines like: "+ 2 SomeFile.kt\ncom/example/SomeClassKt"
        // which indicate code was inlined from that class.
        if (debug != null && debug.contains("*F")) {
            val lines: List<String> = debug.split("\n")
            var i: Int = 0
            while (i < lines.size) {
                val trimmed: String = lines[i].trimStart()
                if (trimmed.startsWith("+ ") && !trimmed.startsWith("+ 1 ") && i + 1 < lines.size) {
                    val classLine: String = lines[i + 1].trim()
                    if (classLine.contains("/") && !classLine.startsWith("kotlin/")) {
                        smapRefs += classLine.replace('/', '.')
                    }
                }
                i++
            }
        }
    }

    override fun visitAnnotation(
        descriptor: String?,
        visible: Boolean,
    ): AnnotationVisitor? {
        descriptor?.let { addType(Type.getType(it)) }
        return null
    }

    override fun visitField(
        access: Int,
        name: String?,
        descriptor: String?,
        signature: String?,
        value: Any?,
    ): FieldVisitor? {
        descriptor?.let { addType(Type.getType(it)) }
        return null
    }

    override fun visitMethod(
        access: Int,
        name: String?,
        descriptor: String?,
        signature: String?,
        exceptions: Array<out String>?,
    ): MethodVisitor {
        descriptor?.let {
            val methodType: Type = Type.getMethodType(it)
            addType(methodType.returnType)
            methodType.argumentTypes.forEach { argType -> addType(argType) }
        }
        exceptions?.forEach { addInternalName(it) }

        return object : MethodVisitor(Opcodes.ASM9) {
            override fun visitTypeInsn(
                opcode: Int,
                type: String?,
            ) {
                type?.let { addInternalName(it) }
            }

            override fun visitFieldInsn(
                opcode: Int,
                owner: String?,
                name: String?,
                descriptor: String?,
            ) {
                owner?.let { addInternalName(it) }
            }

            override fun visitMethodInsn(
                opcode: Int,
                owner: String?,
                name: String?,
                descriptor: String?,
                isInterface: Boolean,
            ) {
                owner?.let { addInternalName(it) }
            }
        }
    }

    private fun addInternalName(internalName: String) {
        if (internalName.startsWith('[')) {
            addType(Type.getType(internalName))
        } else {
            refs += internalName.replace('/', '.')
        }
    }

    private fun addType(type: Type) {
        when (type.sort) {
            Type.ARRAY -> addType(type.elementType)
            Type.OBJECT -> refs += type.className
        }
    }
}
