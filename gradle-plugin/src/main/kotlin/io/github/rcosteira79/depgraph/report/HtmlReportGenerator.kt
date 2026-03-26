package io.github.rcosteira79.depgraph.report

import io.github.rcosteira79.depgraph.model.GraphModel
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

private val json: Json = Json { prettyPrint = false }

private const val VISUALISATION_RESOURCE_NAME: String = "graph-template.js"

object HtmlReportGenerator {
    fun generate(
        graph: GraphModel,
        outputFile: File,
    ) {
        outputFile.parentFile?.mkdirs()
        val graphDataJson: String = escapeForScriptBlock(json.encodeToString(graph))
        val visualisationJs: String = loadResource(VISUALISATION_RESOURCE_NAME)
        outputFile.writeText(buildHtml(graphDataJson, visualisationJs))
    }

    private fun escapeForScriptBlock(json: String): String = json.replace("</", "<\\/")

    private fun loadResource(name: String): String =
        HtmlReportGenerator::class.java
            .getResourceAsStream("/io/github/rcosteira79/depgraph/report/$name")
            ?.bufferedReader()
            ?.readText()
            ?: error("Resource not found: $name")

    private fun buildHtml(
        graphDataJson: String,
        visualisationJs: String,
    ): String =
        """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Dependency Graph</title>
          <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1/dist/dagre.min.js"></script>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #121220; color: #ccc; font-family: -apple-system, sans-serif; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
            #toolbar { background: #2b2b2b; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
            .tb-btn { background: #4c5052; border: none; border-radius: 3px; color: #ccc; padding: 4px 12px; font-size: 11px; cursor: pointer; }
            #depth-control { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11px; }
            #main { display: flex; flex: 1; overflow: hidden; }
            #explorer { width: 200px; flex-shrink: 0; border-right: 1px solid #3c3c3c; display: flex; flex-direction: column; background: #1e1e1e; }
            #explorer-tabs { display: flex; border-bottom: 1px solid #3c3c3c; }
            .ex-tab { flex: 1; text-align: center; padding: 6px; font-size: 11px; color: #888; cursor: pointer; border-bottom: 2px solid transparent; }
            .ex-tab.active { color: #4fc3f7; border-bottom-color: #4fc3f7; }
            #explorer-filter { margin: 6px; background: #2a2a2a; border: none; border-radius: 3px; color: #ccc; padding: 5px 8px; font-size: 11px; width: calc(100% - 12px); outline: none; }
            #explorer-list { flex: 1; overflow-y: auto; }
            .ex-section { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 1px; padding: 8px 8px 2px; }
            .ex-item { padding: 4px 10px; cursor: pointer; border-left: 2px solid transparent; font-family: monospace; font-size: 10px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ex-item:hover { background: #272727; }
            .ex-item.selected { background: #0d3a5e; border-left-color: #4fc3f7; color: #4fc3f7; }
            #graph-container { flex: 1; overflow: hidden; position: relative; }
            #graph-svg { width: 100%; height: 100%; display: block; }
            #detail { width: 200px; flex-shrink: 0; border-left: 1px solid #3c3c3c; background: #1e1e1e; padding: 10px; font-size: 11px; overflow-y: auto; }
            #edge-detail { color: #aaa; font-size: 10px; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div id="toolbar">
            <span style="font-weight:bold;color:#4fc3f7">◈ Dependency Graph</span>
            <button class="tb-btn" id="btn-reset">↺ Reset</button>
            <button class="tb-btn" id="btn-fit">⤢ Fit</button>
            <div id="depth-control">
              Depth <input id="depth-slider" type="range" min="1" max="5" value="2" style="width:80px">
              <span id="depth-value" style="color:#4fc3f7;font-weight:bold">2</span>
            </div>
          </div>
          <div id="main">
            <div id="explorer">
              <div id="explorer-tabs">
                <div class="ex-tab active" id="tab-type">By Type</div>
                <div class="ex-tab" id="tab-path">By Path</div>
              </div>
              <input id="explorer-filter" placeholder="🔍 Filter…">
              <div id="explorer-list"></div>
            </div>
            <div id="graph-container">
              <svg id="graph-svg">
                <defs>
                  <marker id="arrow-rel" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="rgba(255,255,255,0.35)"/>
                  </marker>
                  <marker id="arrow-lit" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#f5a623"/>
                  </marker>
                  <marker id="arrow-cycle" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#e53935"/>
                  </marker>
                  <marker id="arrow-trans" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#c084fc"/>
                  </marker>
                </defs>
                <g id="graph-content">
                  <g id="edges"></g>
                  <g id="nodes"></g>
                </g>
              </svg>
            </div>
            <div id="detail">
              <div id="edge-detail" style="color:#555;font-size:10px">Click an edge to inspect it.</div>
            </div>
          </div>
          <script>window.__GRAPH_DATA__ = $graphDataJson;</script>
          <script>$visualisationJs</script>
        </body>
        </html>
        """.trimIndent()
}
