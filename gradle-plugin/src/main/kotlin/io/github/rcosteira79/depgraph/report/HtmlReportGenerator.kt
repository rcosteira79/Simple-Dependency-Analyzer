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
          <title>Simple Dependency Analyser</title>
          <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1/dist/dagre.min.js"></script>
          <style>
            :root {
              --bg: #121220; --surface: #1e1e1e; --surface2: #2b2b2b; --border: #3c3c3c;
              --text: #ccc; --text-dim: #888; --text-faint: #555; --accent: #4fc3f7;
              --btn-bg: #4c5052; --btn-hover: #5c6062;
              --detail-title: #e2e8f0; --detail-sub: #555; --detail-path: #aaa; --detail-hr: #333;
            }
            :root.light {
              --bg: #f5f5f5; --surface: #ffffff; --surface2: #e8e8e8; --border: #ddd;
              --text: #333; --text-dim: #666; --text-faint: #999; --accent: #0288d1;
              --btn-bg: #d0d0d0; --btn-hover: #bbb;
              --detail-title: #1a1a1a; --detail-sub: #888; --detail-path: #444; --detail-hr: #ddd;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: var(--bg); color: var(--text); font-family: -apple-system, sans-serif; font-size: 12px; display: flex; flex-direction: column; height: 100vh; }
            #toolbar { background: var(--surface2); padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
            .tb-btn { background: var(--btn-bg); border: none; border-radius: 3px; color: var(--text); padding: 4px 12px; font-size: 11px; cursor: pointer; }
            .tb-btn:hover { background: var(--btn-hover); }
            #depth-control { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11px; }
            #main { display: flex; flex: 1; overflow: hidden; }
            #explorer { width: 200px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--surface); }
            #explorer-tabs { display: flex; border-bottom: 1px solid var(--border); }
            .ex-tab { flex: 1; text-align: center; padding: 6px; font-size: 11px; color: var(--text-dim); cursor: pointer; border-bottom: 2px solid transparent; }
            .ex-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
            #explorer-filter { margin: 6px; background: var(--surface2); border: none; border-radius: 3px; color: var(--text); padding: 5px 8px; font-size: 11px; width: calc(100% - 12px); outline: none; }
            #explorer-list { flex: 1; overflow-y: auto; }
            .ex-section { font-size: 9px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 1px; padding: 8px 8px 2px; }
            .ex-item { padding: 4px 10px; cursor: pointer; border-left: 2px solid transparent; font-family: monospace; font-size: 10px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ex-item:hover { background: var(--surface2); }
            .ex-item.selected { background: #0d3a5e; border-left-color: var(--accent); color: var(--accent); }
            #graph-container { flex: 1; overflow: hidden; position: relative; }
            #graph-svg { width: 100%; height: 100%; display: block; }
            #detail-wrapper { display: flex; flex-shrink: 0; }
            #detail-resize { width: 4px; cursor: col-resize; background: var(--border); flex-shrink: 0; }
            #detail-resize:hover { background: var(--accent); }
            #detail { width: 240px; min-width: 120px; max-width: 600px; flex-shrink: 0; border-left: 1px solid var(--border); background: var(--surface); padding: 10px; font-size: 11px; overflow-y: auto; }
            #edge-detail { color: var(--text-dim); font-size: 10px; line-height: 1.6; word-break: break-all; }
          </style>
        </head>
        <body>
          <div id="toolbar">
            <span id="app-title" style="font-weight:bold;color:var(--accent)">◈ Simple Dependency Analyser</span>
            <button class="tb-btn" id="btn-reset">↺ Reset</button>
            <button class="tb-btn" id="btn-fit">⤢ Fit</button>
            <button class="tb-btn" id="btn-inspect" disabled style="opacity:0.4">🔍 Inspect</button>
            <div id="depth-control">
              Depth <input id="depth-slider" type="range" min="1" max="5" value="1" style="width:80px">
              <span id="depth-value" style="color:#4fc3f7;font-weight:bold">1</span>
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
                  <marker id="arrow-rel-light" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="rgba(0,0,0,0.35)"/>
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
                  <marker id="arrow-class-out" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#66bb6a"/>
                  </marker>
                  <marker id="arrow-class-in" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
                    <path d="M0,0.5 L7,3.5 L0,6.5 Z" fill="#42a5f5"/>
                  </marker>
                </defs>
                <g id="graph-content">
                  <g id="edges"></g>
                  <g id="nodes"></g>
                </g>
              </svg>
            </div>
            <div id="detail-wrapper">
              <div id="detail-resize"></div>
              <div id="detail">
                <div id="edge-detail" style="color:#555;font-size:10px">Click an edge to inspect it.</div>
              </div>
            </div>
          </div>
          <script>window.__GRAPH_DATA__ = $graphDataJson;</script>
          <script>$visualisationJs</script>
        </body>
        </html>
        """.trimIndent()
}
