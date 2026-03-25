plugins {
    `kotlin-dsl`
    `java-gradle-plugin`
    kotlin("plugin.serialization") version "2.0.0"
    id("com.gradle.plugin-publish") version "1.2.1"
}

group = "io.github.rcosteira79"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    testImplementation(gradleTestKit())
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.10.2")
}

gradlePlugin {
    website = "https://github.com/rcosteira79/dependency-graph"
    vcsUrl = "https://github.com/rcosteira79/dependency-graph"
    plugins {
        create("dependencyGraph") {
            id = "io.github.rcosteira79.dependency-graph"
            implementationClass = "io.github.rcosteira79.depgraph.DependencyGraphPlugin"
            displayName = "Dependency Graph"
            description = "Visualises your Gradle multi-module dependency architecture"
            tags = listOf("android", "dependency-graph", "architecture", "visualization")
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
