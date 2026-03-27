plugins {
    `kotlin-dsl`
    `java-gradle-plugin`
    kotlin("plugin.serialization") version embeddedKotlinVersion
    id("com.gradle.plugin-publish") version "1.2.1"
}

group = "io.github.rcosteira79"
version = "1.0.0"

repositories {
    mavenCentral()
    gradlePluginPortal()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("org.ow2.asm:asm:9.7.1")
    testImplementation(gradleTestKit())
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

gradlePlugin {
    website = "https://github.com/rcosteira79/dependency-graph"
    vcsUrl = "https://github.com/rcosteira79/dependency-graph"
    plugins {
        create("simpleDependencyAnalyser") {
            id = "io.github.rcosteira79.simple-dependency-analyser"
            implementationClass = "io.github.rcosteira79.depgraph.DependencyGraphPlugin"
            displayName = "Simple Dependency Analyser"
            description = "Visualises and analyses your Gradle multi-module dependency architecture"
            tags = listOf("android", "dependency-graph", "architecture", "visualization")
        }
    }
}

publishing {
    repositories {
        // Local repository for testing publication before pushing to the portal
        maven {
            name = "local"
            url = uri(layout.buildDirectory.dir("local-repo"))
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
