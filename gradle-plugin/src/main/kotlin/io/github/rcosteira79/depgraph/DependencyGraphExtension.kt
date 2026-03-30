package io.github.rcosteira79.depgraph

open class DependencyGraphExtension {
    /** Override the inferred module type. Valid values: app, feature, core, data, test, unknown */
    var moduleType: String? = null

    /** Android build variant to analyze for class dependencies. Ignored for JVM modules. */
    var variant: String = "debug"
}
