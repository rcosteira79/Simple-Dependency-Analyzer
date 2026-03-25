package io.github.rcosteira79.depgraph.serialisation

import io.github.rcosteira79.depgraph.model.GraphModel
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

private val json: Json =
    Json {
        prettyPrint = true
        encodeDefaults = true
    }

object GraphSerializer {
    fun serialize(
        graph: GraphModel,
        outputFile: File,
    ) {
        outputFile.parentFile?.mkdirs()
        outputFile.writeText(json.encodeToString(graph))
    }
}
