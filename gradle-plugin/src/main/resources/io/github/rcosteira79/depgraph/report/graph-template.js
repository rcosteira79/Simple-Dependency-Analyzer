(function () {
  const data = window.__GRAPH_DATA__;
  if (!data) { document.body.innerHTML = '<p style="color:red">No graph data found.</p>'; return; }

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 140, NODE_H = 32, GAP = 8, FOCUS_GAP = 10;
  const PORT_SPACING = 14;
  const CORNER_R = 6;
  const LAYER_ORDER = ['app', 'feature', 'core', 'data', 'unknown'];
  const NODE_COLORS  = { app:'#7b1212', feature:'#0d3461', core:'#2d0d5e', data:'#0d3318', unknown:'#2a2a2a' };
  const NODE_BORDERS = { app:'#c62828', feature:'#1565c0', core:'#6a1fc2', data:'#2e7d32', unknown:'#555' };
  const OPPOSITE_SIDE = { bottom:'top', top:'bottom', right:'left', left:'right' };

  let focusedId   = null;
  let depthValue  = 1;
  let edgeMode    = 'straight'; // 'straight' | 'orthogonal'
  let showTransitive      = false;
  let subgraphLayoutMode  = 'flat';     // 'flat' (BFS rows) | 'deep' (longest-path)
  let selectedIds = new Set();
  let isAnimating = false;

  // ── Unfold state ──────────────────────────────────────────────────────────
  const unfoldedModules   = new Map();  // moduleId → classData entry
  const expandedPackages  = new Map();  // moduleId → Set of expanded package names
  let highlightedClassId  = null;

  const hasClassData = !!(data.classData && Object.keys(data.classData).length > 0);

  // Package pill dimensions
  const PILL_W = 180, PILL_H = 24;
  const CLASS_W = 120, CLASS_H = 22;
  const BOX_PAD = 16;
  const PILL_COLORS = {
    INCOMING: '#4fc3f7',
    OUTGOING: '#f5a623',
    BOTH:     '#c084fc',
  };

  // Mutable node positions — initialised from dagre, updated by drag/layout
  const nodePos      = {};
  // Live <g> element references — updated by drawNodes, used for animation
  const nodeElements = {};

  // Fast module lookup
  const moduleById = {};
  data.modules.forEach(m => { moduleById[m.id] = m; });

  // ── Context menu ──────────────────────────────────────────────────────────
  let contextMenu = null;

  function showContextMenu(x, y, items) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#2b2b2b;border:1px solid #555;border-radius:4px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
    items.forEach(item => {
      const row = document.createElement('div');
      row.textContent = item.label;
      row.style.cssText = 'padding:6px 14px;font-size:11px;color:#ccc;cursor:pointer;';
      row.addEventListener('mouseenter', () => { row.style.background = '#3c3c3c'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
      row.addEventListener('click', () => { hideContextMenu(); item.action(); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    contextMenu = menu;
  }

  function hideContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
  }

  document.addEventListener('click', hideContextMenu);

  // ── Unfold / collapse / highlight logic ─────────────────────────────────
  function cleanUpSubPositions(moduleId) {
    Object.keys(nodePos).forEach(key => {
      if (key.startsWith('pkg:' + moduleId + ':') || key.startsWith('class:')) {
        delete nodePos[key];
      }
    });
  }

  function unfoldModule(moduleId) {
    if (!hasClassData || !data.classData[moduleId]) return;
    unfoldedModules.set(moduleId, data.classData[moduleId]);
    expandedPackages.set(moduleId, new Set());
    highlightedClassId = null;
    computeLayout(data.modules, data.edges);
    rerender();
  }

  function collapseModule(moduleId) {
    cleanUpSubPositions(moduleId);
    unfoldedModules.delete(moduleId);
    expandedPackages.delete(moduleId);
    highlightedClassId = null;
    computeLayout(data.modules, data.edges);
    rerender();
  }

  function togglePackage(moduleId, packageName) {
    const expanded = expandedPackages.get(moduleId) || new Set();
    if (expanded.has(packageName)) {
      expanded.delete(packageName);
      highlightedClassId = null;
    } else {
      expanded.add(packageName);
    }
    expandedPackages.set(moduleId, expanded);
    computeLayout(data.modules, data.edges);
    rerender();
  }

  function highlightClass(classId) {
    highlightedClassId = highlightedClassId === classId ? null : classId;
    rerender();
  }

  // ── Cycle detection (iterative DFS, computed once) ─────────────────────────
  const cycleEdgeKeys = (function () {
    const adj = {};
    data.modules.forEach(m => { adj[m.id] = []; });
    data.edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e); });

    const visited = new Set();
    const inStack = new Set();
    const cycles  = new Set();

    data.modules.forEach(m => {
      if (visited.has(m.id)) return;
      // Iterative DFS with explicit frame stack
      const stack = [{ id: m.id, edgeIdx: 0 }];
      visited.add(m.id);
      inStack.add(m.id);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const out   = adj[frame.id] || [];
        if (frame.edgeIdx < out.length) {
          const e = out[frame.edgeIdx++];
          if (!visited.has(e.to)) {
            visited.add(e.to);
            inStack.add(e.to);
            stack.push({ id: e.to, edgeIdx: 0 });
          } else if (inStack.has(e.to)) {
            cycles.add(`${e.from}|${e.to}`);
          }
        } else {
          inStack.delete(frame.id);
          stack.pop();
        }
      }
    });
    return cycles;
  })();

  const cycleNodeIds = new Set();
  cycleEdgeKeys.forEach(key => {
    const [a, b] = key.split('|');
    cycleNodeIds.add(a);
    cycleNodeIds.add(b);
  });

  // ── Unfolded box size computation ─────────────────────────────────────────
  function getUnfoldedBoxSize(moduleId) {
    const classDataEntry = unfoldedModules.get(moduleId);
    if (!classDataEntry) return { width: NODE_W, height: NODE_H };
    const expanded = expandedPackages.get(moduleId) || new Set();
    const packages = classDataEntry.packages;

    const incomingPkgs = packages.filter(p => p.boundaryType === 'INCOMING' || p.boundaryType === 'BOTH');
    const outgoingPkgs = packages.filter(p => p.boundaryType === 'OUTGOING' || p.boundaryType === 'BOTH');

    const ZONE_PAD = 12;
    const TITLE_H = 30;
    const ZONE_LABEL_H = 18;

    function zoneSize(pkgs) {
      let rowW = 0;
      let maxExpandedH = 0;
      let hasExpanded = false;
      pkgs.forEach(pkg => {
        if (expanded.has(pkg.name)) {
          hasExpanded = true;
          const cols = Math.min(pkg.classes.length, 3);
          const rows = Math.ceil(pkg.classes.length / 3);
          rowW += cols * (CLASS_W + 8) + 16;
          maxExpandedH = Math.max(maxExpandedH, 20 + rows * (CLASS_H + 4));
        } else {
          rowW += PILL_W + 8;
        }
      });
      const h = hasExpanded ? maxExpandedH + PILL_H + 10 : PILL_H + 6;
      return { width: rowW + ZONE_PAD * 2, height: h + ZONE_LABEL_H };
    }

    const inSize = incomingPkgs.length > 0 ? zoneSize(incomingPkgs) : { width: 0, height: 0 };
    const outSize = outgoingPkgs.length > 0 ? zoneSize(outgoingPkgs) : { width: 0, height: 0 };

    const boxW = Math.max(400, inSize.width, outSize.width, PILL_W + BOX_PAD * 2);
    const boxH = TITLE_H + inSize.height + outSize.height + BOX_PAD * 2;

    return { width: boxW, height: Math.max(boxH, NODE_H) };
  }

  // ── Smart edge routing helpers ────────────────────────────────────────────
  function classPackage(classId) {
    const idx = classId.lastIndexOf('.');
    return idx > 0 ? classId.substring(0, idx) : '';
  }

  function resolveEdgePos(moduleId, classId) {
    const pkg = classPackage(classId);
    const expanded = expandedPackages.get(moduleId);
    if (expanded && expanded.has(pkg)) {
      return nodePos['class:' + classId] || nodePos['pkg:' + moduleId + ':' + pkg] || nodePos[moduleId];
    }
    return nodePos['pkg:' + moduleId + ':' + pkg] || nodePos[moduleId];
  }

  // ── Layout (dagre) ─────────────────────────────────────────────────────────
  function buildDagreGraph(modules, edges, opts = {}) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      nodesep: opts.nodesep ?? 80,
      ranksep: opts.ranksep ?? 120,
      marginx: opts.marginx ?? 80,
      marginy: opts.marginy ?? 80,
    });
    g.setDefaultEdgeLabel(() => ({}));
    modules.forEach(m => {
      const unfoldSize = unfoldedModules.has(m.id) ? getUnfoldedBoxSize(m.id) : null;
      const attrs = {
        width:  unfoldSize ? unfoldSize.width  : NODE_W,
        height: unfoldSize ? unfoldSize.height : NODE_H
      };
      // Hint dagre to place app-type modules at the minimum (topmost) rank
      if (moduleById[m.id]?.type === 'app') attrs.rank = 'min';
      g.setNode(m.id, attrs);
    });
    edges.forEach(e => {
      if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
    });
    dagre.layout(g);
    return g;
  }

  function computeLayout(modules, edges) {
    const g = buildDagreGraph(modules, edges);
    modules.forEach(m => {
      const n = g.node(m.id);
      if (n) nodePos[m.id] = { x: n.x, y: n.y };
    });
  }

  // Custom subgraph layout: BFS forward/backward from the focused node.
  // Dependencies (forward edges) are placed below; dependents (reverse edges)
  // are placed above.  Uses barycenter heuristic to minimise crossings.
  function computeCustomSubgraphLayout(focusId, visibleIds) {
    const LAYER_SEP = 170;
    const BASE_NODE_SEP = 220;
    // Use wider separation when any visible node is unfolded
    const hasUnfolded = [...visibleIds].some(id => unfoldedModules.has(id));
    const NODE_SEP = hasUnfolded ? Math.max(BASE_NODE_SEP, 450) : BASE_NODE_SEP;

    // Local acyclic adjacency within visible set
    const succs = {}, preds = {};
    visibleIds.forEach(id => { succs[id] = []; preds[id] = []; });
    data.edges.forEach(e => {
      if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) return;
      if (cycleEdgeKeys.has(`${e.from}|${e.to}`)) return;
      succs[e.from].push(e.to);
      preds[e.to].push(e.from);
    });

    // Classify: isFwd = reachable forward; isBwd = can reach focusId
    const isFwd = new Set([focusId]);
    { const q = [focusId]; let qi = 0;
      while (qi < q.length)
        succs[q[qi++]].forEach(n => { if (!isFwd.has(n)) { isFwd.add(n); q.push(n); } }); }

    const isBwd = new Set([focusId]);
    { const q = [focusId]; let qi = 0;
      while (qi < q.length)
        preds[q[qi++]].forEach(n => { if (!isBwd.has(n)) { isBwd.add(n); q.push(n); } }); }

    // Assign layers
    const layerOf = { [focusId]: 0 };

    if (subgraphLayoutMode === 'flat') {
      // BFS forward: shortest-path depth
      const qF = [focusId]; let qFi = 0;
      while (qFi < qF.length) {
        const curr = qF[qFi++];
        succs[curr].forEach(next => {
          if (isFwd.has(next) && layerOf[next] === undefined) {
            layerOf[next] = (layerOf[curr] ?? 0) + 1;
            qF.push(next);
          }
        });
      }
      // BFS backward: shortest reverse-path depth
      const qB = [focusId]; let qBi = 0;
      while (qBi < qB.length) {
        const curr = qB[qBi++];
        preds[curr].forEach(prev => {
          if (isBwd.has(prev) && layerOf[prev] === undefined) {
            layerOf[prev] = (layerOf[curr] ?? 0) - 1;
            qB.push(prev);
          }
        });
      }
      visibleIds.forEach(id => { if (layerOf[id] === undefined) layerOf[id] = 0; });
    } else {
      // 'deep' — longest-path DP forward
      const fwdDepth = {};
      isFwd.forEach(id => { fwdDepth[id] = 0; });
      const inDegF = {};
      isFwd.forEach(id => { inDegF[id] = 0; });
      isFwd.forEach(id => succs[id].forEach(n => { if (isFwd.has(n)) inDegF[n]++; }));
      inDegF[focusId] = 0;
      const qF2 = [focusId]; let qF2i = 0;
      while (qF2i < qF2.length) {
        const curr = qF2[qF2i++];
        succs[curr].forEach(next => {
          if (!isFwd.has(next)) return;
          if ((fwdDepth[curr] ?? 0) + 1 > (fwdDepth[next] ?? 0))
            fwdDepth[next] = (fwdDepth[curr] ?? 0) + 1;
          if (--inDegF[next] === 0 && next !== focusId) qF2.push(next);
        });
      }
      // Longest-path DP backward
      const bwdDepth = {};
      isBwd.forEach(id => { bwdDepth[id] = 0; });
      const inDegB = {};
      isBwd.forEach(id => { inDegB[id] = 0; });
      isBwd.forEach(id => preds[id].forEach(n => { if (isBwd.has(n)) inDegB[n]++; }));
      inDegB[focusId] = 0;
      const qB2 = [focusId]; let qB2i = 0;
      while (qB2i < qB2.length) {
        const curr = qB2[qB2i++];
        preds[curr].forEach(prev => {
          if (!isBwd.has(prev)) return;
          if ((bwdDepth[curr] ?? 0) + 1 > (bwdDepth[prev] ?? 0))
            bwdDepth[prev] = (bwdDepth[curr] ?? 0) + 1;
          if (--inDegB[prev] === 0 && prev !== focusId) qB2.push(prev);
        });
      }
      visibleIds.forEach(id => {
        if (id === focusId) return;
        if (isFwd.has(id))      layerOf[id] =  (fwdDepth[id] ?? 1);
        else if (isBwd.has(id)) layerOf[id] = -(bwdDepth[id] ?? 1);
        else                    layerOf[id] = 0;
      });
    }

    // Group by layer
    const layerGroups = {};
    visibleIds.forEach(id => {
      const l = layerOf[id] ?? 0;
      (layerGroups[l] = layerGroups[l] || []).push(id);
    });

    // Initial ordering: by current X so animation looks smooth
    Object.values(layerGroups).forEach(g =>
      g.sort((a, b) => (nodePos[a]?.x ?? 0) - (nodePos[b]?.x ?? 0))
    );

    // Viewport centre in content-space
    const svgEl = document.getElementById('graph-svg');
    const { width: svgW, height: svgH } = svgEl.getBoundingClientRect();
    const tf   = d3.zoomTransform(svgEl);
    const vpCx = (svgW / 2 - tf.x) / tf.k;
    const vpCy = (svgH / 2 - tf.y) / tf.k;

    // Initial X assignment
    const xOf = {};
    const layers = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);
    layers.forEach(l => {
      const g = layerGroups[l], n = g.length;
      g.forEach((id, i) => { xOf[id] = vpCx + (i - (n - 1) / 2) * NODE_SEP; });
    });

    // Barycenter heuristic (3 passes)
    for (let pass = 0; pass < 3; pass++) {
      layers.forEach(l => {
        const g = layerGroups[l];
        if (g.length <= 1) return;
        const scores = g.map(id => {
          const nbX = [];
          data.edges.forEach(e => {
            if (e.from === id && xOf[e.to]   !== undefined) nbX.push(xOf[e.to]);
            if (e.to   === id && xOf[e.from] !== undefined) nbX.push(xOf[e.from]);
          });
          return nbX.length ? nbX.reduce((a, b) => a + b, 0) / nbX.length : xOf[id];
        });
        const paired = g.map((id, i) => ({ id, score: scores[i] }));
        paired.sort((a, b) => a.score - b.score);
        const n = paired.length;
        paired.forEach((item, i) => {
          xOf[item.id]      = vpCx + (i - (n - 1) / 2) * NODE_SEP;
          layerGroups[l][i] = item.id;
        });
      });
    }

    // Build result
    const result = {};
    visibleIds.forEach(id => {
      const l = layerOf[id] ?? 0;
      result[id] = { x: xOf[id] ?? vpCx, y: vpCy + l * LAYER_SEP };
    });
    return result;
  }

  // ── Animated layout transition ─────────────────────────────────────────────
  function animateToLayout(targetPos, duration = 380) {
    if (isAnimating) {
      // Already mid-animation: snap to end, then apply new target
      Object.entries(targetPos).forEach(([id, p]) => {
        if (nodePos[id]) nodePos[id] = { ...p };
      });
      rerender();
      return;
    }

    const startPos = {};
    Object.keys(targetPos).forEach(id => {
      if (!nodePos[id]) return;
      startPos[id] = { x: nodePos[id].x, y: nodePos[id].y };
    });

    const t0 = performance.now();
    isAnimating  = true;
    const visIds = getEffectiveVisibleIds();

    function tick(now) {
      const raw = Math.min((now - t0) / duration, 1);
      const t   = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw; // ease-in-out

      Object.entries(targetPos).forEach(([id, tgt]) => {
        const s = startPos[id];
        if (!s || !nodePos[id]) return;
        nodePos[id].x = s.x + (tgt.x - s.x) * t;
        nodePos[id].y = s.y + (tgt.y - s.y) * t;
        if (nodeElements[id]) {
          nodeElements[id].setAttribute('transform', `translate(${nodePos[id].x},${nodePos[id].y})`);
        }
      });

      drawEdges(visIds);

      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        isAnimating = false;
        rerender(); // final clean pass
      }
    }

    requestAnimationFrame(tick);
  }

  // ── Visibility (focus + depth) ─────────────────────────────────────────────
  function getVisibleIds(focusId, depth, modules, edges) {
    if (!focusId) return new Set(modules.map(m => m.id));
    const visible  = new Set([focusId]);
    let   frontier = new Set([focusId]);
    for (let d = 0; d < depth; d++) {
      const next = new Set();
      frontier.forEach(id => {
        edges.forEach(e => {
          if (e.from === id && !visible.has(e.to))   { visible.add(e.to);   next.add(e.to); }
          if (e.to   === id && !visible.has(e.from)) { visible.add(e.from); next.add(e.from); }
        });
      });
      frontier = next;
    }
    return visible;
  }

  // When transitive toggle is on and a node is focused, include every node
  // reachable from / able to reach the focused node (unlimited depth).
  function getEffectiveVisibleIds() {
    if (!focusedId) return new Set(data.modules.map(m => m.id));
    if (!showTransitive) return getVisibleIds(focusedId, depthValue, data.modules, data.edges);

    const all = new Set([focusedId]);
    // Forward BFS
    const q1 = [focusedId]; let q1i = 0;
    while (q1i < q1.length) {
      const curr = q1[q1i++];
      data.edges.forEach(e => {
        if (e.from === curr && !all.has(e.to))   { all.add(e.to);   q1.push(e.to); }
      });
    }
    // Backward BFS
    const q2 = [focusedId]; let q2i = 0;
    while (q2i < q2.length) {
      const curr = q2[q2i++];
      data.edges.forEach(e => {
        if (e.to === curr && !all.has(e.from)) { all.add(e.from); q2.push(e.from); }
      });
    }
    return all;
  }

  // Returns { transitiveOut, transitiveIn } where:
  // transitiveOut = nodes reachable from focusId (not direct neighbours)
  // transitiveIn  = nodes that can reach focusId (not direct neighbours)
  function computeTransitiveEdgesForFocus(focusId, visibleIds) {
    const directOut = new Set(
      data.edges.filter(e => e.from === focusId && visibleIds.has(e.to)).map(e => e.to)
    );
    const directIn = new Set(
      data.edges.filter(e => e.to === focusId && visibleIds.has(e.from)).map(e => e.from)
    );

    const reachableOut = new Set();
    const q1 = [focusId]; let q1i = 0;
    while (q1i < q1.length) {
      const curr = q1[q1i++];
      data.edges.forEach(e => {
        if (e.from === curr && visibleIds.has(e.to) && !reachableOut.has(e.to)) {
          reachableOut.add(e.to);
          q1.push(e.to);
        }
      });
    }

    const reachableIn = new Set();
    const q2 = [focusId]; let q2i = 0;
    while (q2i < q2.length) {
      const curr = q2[q2i++];
      data.edges.forEach(e => {
        if (e.to === curr && visibleIds.has(e.from) && !reachableIn.has(e.from)) {
          reachableIn.add(e.from);
          q2.push(e.from);
        }
      });
    }

    return {
      transitiveOut: [...reachableOut].filter(id => !directOut.has(id)),
      transitiveIn:  [...reachableIn].filter(id => !directIn.has(id)),
    };
  }

  // ── Straight edge routing ──────────────────────────────────────────────────
  function nodeEdgePoint(cx, cy, tx, ty, gap) {
    const dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return { x: cx, y: cy };
    const ux = dx / len, uy = dy / len;
    const tX = (NODE_W / 2 + gap) / Math.abs(ux || 1e-9);
    const tY = (NODE_H / 2 + gap) / Math.abs(uy || 1e-9);
    return { x: cx + ux * Math.min(tX, tY), y: cy + uy * Math.min(tX, tY) };
  }

  function buildStraightPath(sp, tp, srcGap, tgtGap) {
    const src = nodeEdgePoint(sp.x, sp.y, tp.x, tp.y, srcGap);
    const tgt = nodeEdgePoint(tp.x, tp.y, sp.x, sp.y, tgtGap);
    return `M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`;
  }

  // ── Orthogonal routing ─────────────────────────────────────────────────────
  function exitSide(sp, tp) {
    const dx = tp.x - sp.x, dy = tp.y - sp.y;
    if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'bottom' : 'top';
    return dx > 0 ? 'right' : 'left';
  }

  function computeEdgePorts(edges) {
    const sideEntries = {};
    edges.forEach((e, i) => {
      const sp = nodePos[e.from], tp = nodePos[e.to];
      if (!sp || !tp) return;
      const src = exitSide(sp, tp);
      const tgt = OPPOSITE_SIDE[src];
      const srcKey = `${e.from}|${src}`;
      const tgtKey = `${e.to}|${tgt}`;
      if (!sideEntries[srcKey]) sideEntries[srcKey] = [];
      if (!sideEntries[tgtKey]) sideEntries[tgtKey] = [];
      sideEntries[srcKey].push({ edgeIdx: i, isSource: true,  otherPos: tp });
      sideEntries[tgtKey].push({ edgeIdx: i, isSource: false, otherPos: sp });
    });
    const portOffset = edges.map(() => ({ src: 0, tgt: 0 }));
    Object.entries(sideEntries).forEach(([key, entries]) => {
      if (entries.length <= 1) return;
      const side = key.split('|')[1];
      const horiz = side === 'top' || side === 'bottom';
      entries.sort((a, b) => horiz ? a.otherPos.x - b.otherPos.x : a.otherPos.y - b.otherPos.y);
      const n = entries.length;
      const spacing = Math.min(PORT_SPACING, (horiz ? NODE_W : NODE_H) * 0.65 / Math.max(n - 1, 1));
      entries.forEach(({ edgeIdx, isSource }, i) => {
        const off = (i - (n - 1) / 2) * spacing;
        if (isSource) portOffset[edgeIdx].src = off;
        else          portOffset[edgeIdx].tgt = off;
      });
    });
    return portOffset;
  }

  function buildEdgePath(sp, tp, srcOff, tgtOff, srcGap, tgtGap) {
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const side = exitSide(sp, tp);
    let p1, p2, p3, p4;
    if (side === 'bottom') {
      p1 = { x: sp.x + srcOff, y: sp.y + hh + srcGap };
      p4 = { x: tp.x + tgtOff, y: tp.y - hh - tgtGap };
      const midY = (p1.y + p4.y) / 2;
      p2 = { x: p1.x, y: midY }; p3 = { x: p4.x, y: midY };
    } else if (side === 'top') {
      p1 = { x: sp.x + srcOff, y: sp.y - hh - srcGap };
      p4 = { x: tp.x + tgtOff, y: tp.y + hh + tgtGap };
      const midY = (p1.y + p4.y) / 2;
      p2 = { x: p1.x, y: midY }; p3 = { x: p4.x, y: midY };
    } else if (side === 'right') {
      p1 = { x: sp.x + hw + srcGap, y: sp.y + srcOff };
      p4 = { x: tp.x - hw - tgtGap, y: tp.y + tgtOff };
      const midX = (p1.x + p4.x) / 2;
      p2 = { x: midX, y: p1.y }; p3 = { x: midX, y: p4.y };
    } else {
      p1 = { x: sp.x - hw - srcGap, y: sp.y + srcOff };
      p4 = { x: tp.x + hw + tgtGap, y: tp.y + tgtOff };
      const midX = (p1.x + p4.x) / 2;
      p2 = { x: midX, y: p1.y }; p3 = { x: midX, y: p4.y };
    }
    return roundedPolyPath([p1, p2, p3, p4], CORNER_R);
  }

  function roundedPolyPath(pts, r) {
    const ps = pts.filter((p, i) =>
      i === 0 || Math.abs(p.x - pts[i-1].x) > 0.5 || Math.abs(p.y - pts[i-1].y) > 0.5);
    if (ps.length < 2) return '';
    let d = `M ${ps[0].x} ${ps[0].y}`;
    for (let i = 1; i < ps.length - 1; i++) {
      const prev = ps[i-1], curr = ps[i], next = ps[i+1];
      const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
      const d2x = next.x - curr.x, d2y = next.y - curr.y;
      const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
      if (len1 < 0.5 || len2 < 0.5) { d += ` L ${curr.x} ${curr.y}`; continue; }
      const cr = Math.min(r, len1 / 2, len2 / 2);
      const bx = curr.x - (d1x / len1) * cr, by = curr.y - (d1y / len1) * cr;
      const ax = curr.x + (d2x / len2) * cr, ay = curr.y + (d2y / len2) * cr;
      d += ` L ${bx} ${by} Q ${curr.x} ${curr.y} ${ax} ${ay}`;
    }
    return d + ` L ${ps[ps.length-1].x} ${ps[ps.length-1].y}`;
  }

  // ── Draw edges ─────────────────────────────────────────────────────────────
  function drawEdges(visibleIds) {
    const { edges } = data;
    const portOffsets = edgeMode === 'orthogonal' ? computeEdgePorts(edges) : null;
    const edgeGroup   = document.getElementById('edges');
    edgeGroup.innerHTML = '';

    // Pre-compute transitive sets
    let transitiveOut = [], transitiveIn = [], transitiveNodeIds = null;
    if (showTransitive && focusedId) {
      ({ transitiveOut, transitiveIn } = computeTransitiveEdgesForFocus(focusedId, visibleIds));
      transitiveNodeIds = new Set([...transitiveOut, ...transitiveIn]);
    }

    edges.forEach((e, i) => {
      const sp = nodePos[e.from], tp = nodePos[e.to];
      if (!sp || !tp) return;

      const isCycle       = cycleEdgeKeys.has(`${e.from}|${e.to}`);
      const isFocusEdge   = focusedId && (e.from === focusedId || e.to === focusedId);
      const isInSubgraph  = !focusedId || (visibleIds.has(e.from) && visibleIds.has(e.to));
      const isSecondaryTrans = transitiveNodeIds !== null && isInSubgraph &&
        !isFocusEdge && !isCycle &&
        (transitiveNodeIds.has(e.from) || transitiveNodeIds.has(e.to));
      const srcGap = e.from === focusedId ? FOCUS_GAP : GAP;
      const tgtGap = e.to   === focusedId ? FOCUS_GAP : GAP;

      const pathD = edgeMode === 'orthogonal'
        ? buildEdgePath(sp, tp, portOffsets[i].src, portOffsets[i].tgt, srcGap, tgtGap)
        : buildStraightPath(sp, tp, srcGap, tgtGap);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');

      if (isCycle) {
        // Cycle edges: always red dashed, visible regardless of focus
        path.setAttribute('stroke', '#e53935');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '5,3');
        path.setAttribute('opacity', isInSubgraph ? '1' : '0.08');
        path.setAttribute('marker-end', 'url(#arrow-cycle)');
      } else if (isFocusEdge) {
        // Directly connected to focused node: orange, full opacity
        path.setAttribute('stroke', '#f5a623');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('opacity', '1');
        path.setAttribute('marker-end', 'url(#arrow-lit)');
      } else if (isSecondaryTrans) {
        path.setAttribute('stroke', '#c084fc');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('stroke-dasharray', '3,3');
        path.setAttribute('opacity', '0.35');
        path.setAttribute('marker-end', 'url(#arrow-trans)');
      } else {
        // All other edges: dim when there is a focus
        const opacity = !isInSubgraph ? '0.05' : focusedId ? '0.15' : '1';
        path.setAttribute('stroke', 'rgba(255,255,255,0.25)');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('opacity', opacity);
        path.setAttribute('marker-end', 'url(#arrow-rel)');
      }

      path.dataset.from = e.from; path.dataset.to = e.to;
      path.style.cursor = 'pointer';
      path.addEventListener('click', () => onEdgeClick(e.from, e.to, isCycle));
      edgeGroup.appendChild(path);
    });

    // Main transitive arrows (focus ↔ transitive nodes)
    if (showTransitive && focusedId) {
      const drawTransEdge = (fromId, toId) => {
        const sp = nodePos[fromId], tp = nodePos[toId];
        if (!sp || !tp) return;
        const pathD = edgeMode === 'orthogonal'
          ? buildEdgePath(sp, tp, 0, 0, GAP, GAP)
          : buildStraightPath(sp, tp, GAP, GAP);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#c084fc');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '4,3');
        path.setAttribute('opacity', '0.7');
        path.setAttribute('marker-end', 'url(#arrow-trans)');
        path.style.cursor = 'pointer';
        path.addEventListener('click', () => onTransitiveEdgeClick(fromId, toId));
        edgeGroup.appendChild(path);
      };

      transitiveOut.forEach(toId   => drawTransEdge(focusedId, toId));
      transitiveIn.forEach(fromId  => drawTransEdge(fromId, focusedId));
    }

    // ── Class-level edges for unfolded modules ──────────────────────────────
    if (unfoldedModules.size > 0) {
      unfoldedModules.forEach((classDataEntry, moduleId) => {
        classDataEntry.classEdges.forEach(ce => {
          const fromPos = unfoldedModules.has(ce.fromModuleId)
            ? resolveEdgePos(ce.fromModuleId, ce.fromClassId)
            : nodePos[ce.fromModuleId];
          const toPos = unfoldedModules.has(ce.toModuleId)
            ? resolveEdgePos(ce.toModuleId, ce.toClassId)
            : nodePos[ce.toModuleId];
          if (!fromPos || !toPos) return;
          if (!visibleIds.has(ce.fromModuleId) || !visibleIds.has(ce.toModuleId)) return;

          const isHighlighted = highlightedClassId === ce.fromClassId || highlightedClassId === ce.toClassId;
          const pathD = buildStraightPath(fromPos, toPos, GAP, GAP);

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD);
          path.setAttribute('fill', 'none');
          if (isHighlighted) {
            path.setAttribute('stroke', '#fff');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('opacity', '1');
          } else if (highlightedClassId) {
            path.setAttribute('stroke', 'rgba(255,255,255,0.15)');
            path.setAttribute('stroke-width', '0.8');
            path.setAttribute('opacity', '0.08');
          } else {
            path.setAttribute('stroke', '#c084fc');
            path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-dasharray', '3,2');
            path.setAttribute('opacity', '0.5');
          }
          path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-lit)' : 'url(#arrow-trans)');
          path.style.cursor = 'pointer';
          path.addEventListener('click', () => {
            const detail = document.getElementById('edge-detail');
            detail.innerHTML = `<strong style="color:#c084fc">Class edge</strong><br/>` +
              `<span style="color:#aaa">${ce.fromClassId}</span><br/>` +
              `<span style="color:#555">↓</span><br/>` +
              `<span style="color:#aaa">${ce.toClassId}</span>`;
          });
          edgeGroup.appendChild(path);
        });
      });
    }
  }

  // ── Draw nodes ─────────────────────────────────────────────────────────────
  function drawNodes(visibleIds) {
    const { modules } = data;
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const nodeGroup = document.getElementById('nodes');
    nodeGroup.innerHTML = '';

    modules.forEach(m => {
      if (unfoldedModules.has(m.id)) {
        drawUnfoldedModule(m, visibleIds);
        return;
      }

      const pos = nodePos[m.id];
      if (!pos) return;
      const isFocused   = m.id === focusedId;
      const isSelected  = selectedIds.has(m.id);
      const isDim       = focusedId && !visibleIds.has(m.id);
      const isCycleNode = cycleNodeIds.has(m.id);
      const color  = NODE_COLORS[m.type]  || NODE_COLORS.unknown;
      const border = NODE_BORDERS[m.type] || NODE_BORDERS.unknown;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      nodeElements[m.id] = g;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -hw); rect.setAttribute('y', -hh);
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', '5'); rect.setAttribute('fill', color);
      const strokeColor = isFocused ? '#f5a623' : isSelected ? '#4fc3f7' : isCycleNode ? '#e53935' : border;
      const strokeWidth = (isFocused || isSelected) ? '2.5' : isCycleNode ? '2' : '1';
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('opacity', isDim ? '0.12' : '1');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 0); text.setAttribute('y', 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', 'white');
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('opacity', isDim ? '0.12' : '1');
      text.textContent = m.id;

      g.appendChild(rect);
      g.appendChild(text);

      // Small red badge on cycle nodes so they stand out even when not focused
      if (isCycleNode && !isDim) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        badge.setAttribute('cx', hw - 5); badge.setAttribute('cy', -(hh - 5));
        badge.setAttribute('r', '4');
        badge.setAttribute('fill', '#e53935');
        badge.setAttribute('pointer-events', 'none');
        const badgeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeTxt.setAttribute('x', hw - 5); badgeTxt.setAttribute('y', -(hh - 9));
        badgeTxt.setAttribute('text-anchor', 'middle');
        badgeTxt.setAttribute('font-size', '6');
        badgeTxt.setAttribute('fill', 'white');
        badgeTxt.setAttribute('pointer-events', 'none');
        badgeTxt.textContent = '↻';
        g.appendChild(badge);
        g.appendChild(badgeTxt);
      }

      nodeGroup.appendChild(g);

      let dragMoved   = false;
      let prevDragPos = null;
      let dragOrigin  = null;

      const drag = d3.drag()
        .on('start', function (event) {
          dragMoved   = false;
          prevDragPos = { x: event.x, y: event.y };
          dragOrigin  = { x: event.x, y: event.y };
          d3.select(this).raise();
        })
        .on('drag', function (event) {
          const totalDx = event.x - dragOrigin.x;
          const totalDy = event.y - dragOrigin.y;
          if (Math.abs(totalDx) > 3 || Math.abs(totalDy) > 3) dragMoved = true;
          const dx = event.x - prevDragPos.x;
          const dy = event.y - prevDragPos.y;
          prevDragPos = { x: event.x, y: event.y };

          if (!dragMoved) return; // don't move until threshold exceeded
          const idsToMove = selectedIds.has(m.id) ? selectedIds : new Set([m.id]);
          idsToMove.forEach(id => {
            nodePos[id].x += dx;
            nodePos[id].y += dy;
            if (nodeElements[id]) {
              d3.select(nodeElements[id]).attr('transform', `translate(${nodePos[id].x},${nodePos[id].y})`);
            }
          });
          drawEdges(getEffectiveVisibleIds());
        })
        .on('end', function () {
          prevDragPos = null;
          dragOrigin  = null;
          if (!dragMoved) onNodeClick(m.id);
        });

      d3.select(g).call(drag).style('cursor', 'grab');

      d3.select(g).on('contextmenu', function (event) {
        event.preventDefault();
        const items = [];
        if (hasClassData && data.classData[m.id] && data.classData[m.id].packages.length > 0 && !unfoldedModules.has(m.id)) {
          items.push({ label: 'Inspect classes', action: () => unfoldModule(m.id) });
        }
        if (unfoldedModules.has(m.id)) {
          items.push({ label: 'Collapse', action: () => collapseModule(m.id) });
        }
        if (items.length > 0) showContextMenu(event.clientX, event.clientY, items);
      });
    });
  }

  // ── Draw unfolded module ───────────────────────────────────────────────────
  function drawUnfoldedModule(m, visibleIds) {
    const pos = nodePos[m.id];
    if (!pos) return;
    const isDim = focusedId && !visibleIds.has(m.id);
    const classDataEntry = unfoldedModules.get(m.id);
    if (!classDataEntry) return;

    const expanded = expandedPackages.get(m.id) || new Set();
    const packages = classDataEntry.packages;
    if (packages.length === 0) { collapseModule(m.id); return; }

    const nodeGroup = document.getElementById('nodes');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    nodeElements[m.id] = g;

    // Classify packages into incoming (top) and outgoing (bottom) zones
    const incomingPkgs = packages.filter(p => p.boundaryType === 'INCOMING' || p.boundaryType === 'BOTH');
    const outgoingPkgs = packages.filter(p => p.boundaryType === 'OUTGOING' || p.boundaryType === 'BOTH');

    const boxSize = getUnfoldedBoxSize(m.id);
    const boxW = boxSize.width;
    const boxH = boxSize.height;

    // Dashed bounding box
    const border = NODE_BORDERS[m.type] || NODE_BORDERS.unknown;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', -boxW / 2); rect.setAttribute('y', -boxH / 2);
    rect.setAttribute('width', boxW); rect.setAttribute('height', boxH);
    rect.setAttribute('rx', '8'); rect.setAttribute('fill', 'rgba(30,30,30,0.85)');
    rect.setAttribute('stroke', border); rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '6,3');
    rect.setAttribute('opacity', isDim ? '0.12' : '1');
    g.appendChild(rect);

    // Title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', 0); title.setAttribute('y', -boxH / 2 + 18);
    title.setAttribute('text-anchor', 'middle'); title.setAttribute('font-size', '10');
    title.setAttribute('font-family', 'monospace'); title.setAttribute('fill', '#888');
    title.setAttribute('opacity', isDim ? '0.12' : '1');
    title.textContent = m.id;
    title.style.cursor = 'pointer';
    title.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Collapse', action: () => collapseModule(m.id) },
      ]);
    });
    g.appendChild(title);

    // Draw a zone of packages (either incoming or outgoing)
    function drawZone(pkgs, zoneLabel, zoneTop) {
      // Zone label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', -boxW / 2 + BOX_PAD); label.setAttribute('y', zoneTop + 12);
      label.setAttribute('font-size', '8'); label.setAttribute('font-family', 'monospace');
      label.setAttribute('fill', '#555'); label.setAttribute('pointer-events', 'none');
      label.textContent = zoneLabel;
      g.appendChild(label);

      let xCursor = -boxW / 2 + BOX_PAD;
      const yBase = zoneTop + 20;

      pkgs.forEach(pkg => {
        const color = PILL_COLORS[pkg.boundaryType] || '#888';

        if (expanded.has(pkg.name)) {
          // Package header
          const header = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          header.setAttribute('x', xCursor); header.setAttribute('y', yBase + 12);
          header.setAttribute('font-size', '9'); header.setAttribute('font-family', 'monospace');
          header.setAttribute('fill', color); header.setAttribute('cursor', 'pointer');
          header.textContent = `▾ ${pkg.name.split('.').slice(-2).join('.')}`;
          header.addEventListener('click', () => togglePackage(m.id, pkg.name));
          g.appendChild(header);

          // Classes in a grid (max 3 columns)
          const cols = Math.min(pkg.classes.length, 3);
          pkg.classes.forEach((cls, ci) => {
            const col = ci % cols;
            const row = Math.floor(ci / cols);
            const cx = xCursor + col * (CLASS_W + 8) + CLASS_W / 2;
            const cy = yBase + 20 + row * (CLASS_H + 4);

            const isHighlighted = highlightedClassId === cls.id;
            const clsRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            clsRect.setAttribute('x', cx - CLASS_W / 2); clsRect.setAttribute('y', cy);
            clsRect.setAttribute('width', CLASS_W); clsRect.setAttribute('height', CLASS_H);
            clsRect.setAttribute('rx', '3');
            clsRect.setAttribute('fill', isHighlighted ? '#333' : '#252525');
            clsRect.setAttribute('stroke', isHighlighted ? '#fff' : color);
            clsRect.setAttribute('stroke-width', isHighlighted ? '2' : '0.5');
            clsRect.style.cursor = 'pointer';
            clsRect.addEventListener('click', () => highlightClass(cls.id));
            g.appendChild(clsRect);

            const clsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            clsText.setAttribute('x', cx); clsText.setAttribute('y', cy + 14);
            clsText.setAttribute('text-anchor', 'middle'); clsText.setAttribute('font-size', '9');
            clsText.setAttribute('font-family', 'monospace');
            clsText.setAttribute('fill', isHighlighted ? '#fff' : '#aaa');
            clsText.setAttribute('pointer-events', 'none');
            clsText.textContent = cls.simpleName;
            g.appendChild(clsText);

            // Store absolute position for edge routing
            nodePos['class:' + cls.id] = { x: pos.x + cx, y: pos.y + cy + CLASS_H / 2 };
          });

          xCursor += Math.min(pkg.classes.length, 3) * (CLASS_W + 8) + 16;
        } else {
          // Collapsed pill
          const pillX = xCursor;
          const pillY = yBase;
          const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          pill.setAttribute('x', pillX); pill.setAttribute('y', pillY);
          pill.setAttribute('width', PILL_W); pill.setAttribute('height', PILL_H);
          pill.setAttribute('rx', PILL_H / 2); pill.setAttribute('fill', '#1a1a2e');
          pill.setAttribute('stroke', color); pill.setAttribute('stroke-width', '1');
          pill.style.cursor = 'pointer';
          pill.addEventListener('click', () => togglePackage(m.id, pkg.name));
          g.appendChild(pill);

          const pillText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          pillText.setAttribute('x', pillX + PILL_W / 2); pillText.setAttribute('y', pillY + 15);
          pillText.setAttribute('text-anchor', 'middle'); pillText.setAttribute('font-size', '9');
          pillText.setAttribute('font-family', 'monospace'); pillText.setAttribute('fill', color);
          pillText.setAttribute('pointer-events', 'none');
          const shortPkg = pkg.name.split('.').slice(-2).join('.');
          pillText.textContent = `${shortPkg} (${pkg.classes.length})`;
          g.appendChild(pillText);

          // Store absolute position for edge routing
          nodePos['pkg:' + m.id + ':' + pkg.name] = { x: pos.x + pillX + PILL_W / 2, y: pos.y + pillY + PILL_H / 2 };

          xCursor += PILL_W + 8;
        }
      });
    }

    // Layout: incoming zone in top half, outgoing zone in bottom half
    const titleH = 30;
    const halfH = (boxH - titleH) / 2;
    const topZoneY = -boxH / 2 + titleH;
    const bottomZoneY = -boxH / 2 + titleH + halfH;

    if (incomingPkgs.length > 0) {
      drawZone(incomingPkgs, '▼ INCOMING', topZoneY);
    }
    if (outgoingPkgs.length > 0) {
      drawZone(outgoingPkgs, '▲ OUTGOING', bottomZoneY);
    }

    // Divider line between zones
    if (incomingPkgs.length > 0 && outgoingPkgs.length > 0) {
      const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      divider.setAttribute('x1', -boxW / 2 + 8); divider.setAttribute('y1', bottomZoneY);
      divider.setAttribute('x2', boxW / 2 - 8); divider.setAttribute('y2', bottomZoneY);
      divider.setAttribute('stroke', '#444'); divider.setAttribute('stroke-width', '0.5');
      divider.setAttribute('stroke-dasharray', '3,3');
      g.appendChild(divider);
    }

    nodeGroup.appendChild(g);

    // Make the bounding box draggable
    const drag = d3.drag()
      .on('start', function (event) { d3.select(this).raise(); })
      .on('drag', function (event) {
        nodePos[m.id].x += event.dx;
        nodePos[m.id].y += event.dy;
        d3.select(g).attr('transform', `translate(${nodePos[m.id].x},${nodePos[m.id].y})`);
        // Update sub-positions for pills/classes
        drawEdges(getEffectiveVisibleIds());
      });
    d3.select(g).call(drag);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    computeLayout(data.modules, data.edges);
    rerender();
  }

  function rerender() {
    const visibleIds = getEffectiveVisibleIds();
    drawEdges(visibleIds);
    drawNodes(visibleIds);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function onNodeClick(id) {
    const wasFocused = focusedId === id;
    focusedId = wasFocused ? null : id;
    updateExplorer();

    if (focusedId) {
      const visibleIds = getEffectiveVisibleIds();
      let targetPos = {};
      try {
        targetPos = computeCustomSubgraphLayout(focusedId, visibleIds);
      } catch (e) {
        console.error('Layout computation failed:', e);
      }
      drawEdges(visibleIds);
      drawNodes(visibleIds);
      if (Object.keys(targetPos).length > 0) animateToLayout(targetPos);
    } else {
      rerender();
    }
  }

  function onEdgeClick(from, to, isCycle) {
    const detail = document.getElementById('edge-detail');
    const cycleNote = isCycle
      ? '<br/><span style="color:#e53935;font-weight:bold">⚠ Circular dependency</span>'
      : '';
    detail.innerHTML = `<strong>${from} → ${to}</strong>${cycleNote}`;
  }

  // BFS shortest-path finder (follows edge direction only)
  function findShortestPath(fromId, toId) {
    const prev = { [fromId]: null };
    const queue = [fromId]; let qi = 0;
    while (qi < queue.length) {
      const curr = queue[qi++];
      if (curr === toId) break;
      data.edges.forEach(e => {
        if (e.from === curr && prev[e.to] === undefined) {
          prev[e.to] = curr;
          queue.push(e.to);
        }
      });
    }
    if (prev[toId] === undefined) return null;
    const path = [];
    let curr = toId;
    while (curr !== null) { path.unshift(curr); curr = prev[curr]; }
    return path;
  }

  function onTransitiveEdgeClick(fromId, toId) {
    const path = findShortestPath(fromId, toId);
    const detail = document.getElementById('edge-detail');
    if (!path || path.length < 2) {
      detail.innerHTML = `<strong>${fromId} → ${toId}</strong><br/><span style="color:#c084fc">Transitive dependency</span>`;
      return;
    }
    const hops = path.length - 2;
    const steps = path.map((id, i) => {
      const isEndpoint = i === 0 || i === path.length - 1;
      const col = isEndpoint ? '#e2e8f0' : '#94a3b8';
      return `<span style="color:${col}">${id}</span>`;
    }).join('<br/><span style="color:#c084fc;font-size:9px">↓ via</span><br/>');
    detail.innerHTML =
      `<span style="color:#c084fc;font-weight:bold">◈ Transitive</span>` +
      `<span style="color:#888;font-size:9px"> · ${hops} hop${hops !== 1 ? 's' : ''}</span>` +
      `<hr style="border-color:#333;margin:6px 0"/>` +
      `<div style="line-height:1.9;font-size:10px">${steps}</div>`;
  }

  // ── Explorer panel ─────────────────────────────────────────────────────────
  let explorerMode = 'type';

  function updateExplorer() {
    const list      = document.getElementById('explorer-list');
    const filterVal = document.getElementById('explorer-filter').value.toLowerCase();
    const filtered  = data.modules.filter(m => m.id.toLowerCase().includes(filterVal));
    list.innerHTML  = '';

    if (explorerMode === 'type') {
      const grouped = LAYER_ORDER.reduce((acc, type) => {
        const group = filtered.filter(m => m.type === type);
        if (group.length) acc[type] = group;
        return acc;
      }, {});
      Object.entries(grouped).forEach(([type, mods]) => {
        const header = document.createElement('div');
        header.className = 'ex-section';
        header.textContent = `${type.toUpperCase()} (${mods.length})`;
        list.appendChild(header);
        mods.forEach(m => list.appendChild(makeExplorerItem(m)));
      });
    } else {
      const grouped = {};
      filtered.forEach(m => {
        const parts = m.id.split(':').filter(Boolean);
        const key   = parts.length > 1 ? parts[0] : '_root';
        (grouped[key] = grouped[key] || []).push(m);
      });
      Object.entries(grouped).forEach(([group, mods]) => {
        if (group !== '_root') {
          const header = document.createElement('div');
          header.className = 'ex-section';
          header.textContent = `:${group}`;
          list.appendChild(header);
        }
        mods.forEach(m => list.appendChild(makeExplorerItem(m)));
      });
    }
  }

  function makeExplorerItem(m) {
    const item = document.createElement('div');
    item.className = 'ex-item' + (m.id === focusedId ? ' selected' : '');
    item.textContent = m.id;
    item.addEventListener('click', () => onNodeClick(m.id));
    return item;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const svg     = d3.select('#graph-svg');
    const content = d3.select('#graph-content');

    // ctrl+wheel (pinch gesture or ctrl+scroll) = zoom; middle mouse drag = pan
    // Plain wheel (two-finger trackpad swipe or scroll wheel) = pan — see handler below
    const zoom = d3.zoom()
      .filter(event => (event.type === 'wheel' && event.ctrlKey) || event.button === 1)
      .scaleExtent([0.05, 4])
      .on('zoom', event => content.attr('transform', event.transform));

    svg.call(zoom).on('dblclick.zoom', null);

    // Two-finger trackpad swipe (and plain scroll wheel) → pan
    svg.node().addEventListener('wheel', event => {
      if (event.ctrlKey) return; // pinch zoom handled by D3 above
      event.preventDefault();
      const tf = d3.zoomTransform(svg.node());
      zoom.transform(svg, tf.translate(-event.deltaX / tf.k, -event.deltaY / tf.k));
    }, { passive: false });

    // Prevent middle-click autoscroll cursor
    svg.node().addEventListener('mousedown', event => {
      if (event.button === 1) event.preventDefault();
    }, { passive: false });

    // ── Rubber-band multi-select (left drag on background) ────────────────────
    let lassoStart = null;
    let lassoEl    = null;

    svg.on('mousedown.lasso', function (event) {
      if (event.button !== 0) return;
      if (document.getElementById('nodes').contains(event.target)) return;

      const tf = d3.zoomTransform(svg.node());
      const [mx, my] = tf.invert(d3.pointer(event, svg.node()));
      lassoStart = { x: mx, y: my };
      lassoEl = content.append('rect')
        .attr('x', mx).attr('y', my).attr('width', 0).attr('height', 0)
        .attr('fill', 'rgba(79,195,247,0.07)')
        .attr('stroke', '#4fc3f7').attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,2').attr('pointer-events', 'none');
    });

    svg.on('mousemove.lasso', function (event) {
      if (!lassoStart) return;
      const tf = d3.zoomTransform(svg.node());
      const [mx, my] = tf.invert(d3.pointer(event, svg.node()));
      lassoEl
        .attr('x', Math.min(lassoStart.x, mx)).attr('y', Math.min(lassoStart.y, my))
        .attr('width', Math.abs(mx - lassoStart.x)).attr('height', Math.abs(my - lassoStart.y));
    });

    svg.on('mouseup.lasso', function (event) {
      if (!lassoStart) return;
      const tf = d3.zoomTransform(svg.node());
      const [mx, my] = tf.invert(d3.pointer(event, svg.node()));
      const wasDrag = Math.abs(mx - lassoStart.x) > 4 || Math.abs(my - lassoStart.y) > 4;

      if (wasDrag) {
        const x1 = Math.min(lassoStart.x, mx), x2 = Math.max(lassoStart.x, mx);
        const y1 = Math.min(lassoStart.y, my), y2 = Math.max(lassoStart.y, my);
        const hw = NODE_W / 2, hh = NODE_H / 2;
        selectedIds = new Set();
        data.modules.forEach(m => {
          const pos = nodePos[m.id];
          if (pos && pos.x + hw >= x1 && pos.x - hw <= x2 && pos.y + hh >= y1 && pos.y - hh <= y2) {
            selectedIds.add(m.id);
          }
        });
        rerender();
      } else if (selectedIds.size > 0) {
        selectedIds = new Set();
        rerender();
      }

      lassoEl?.remove();
      lassoStart = null;
      lassoEl    = null;
    });

    const btnTrans = document.createElement('button');
    btnTrans.className = 'tb-btn'; btnTrans.id = 'btn-transitive';
    btnTrans.textContent = 'Transitive: Off';
    btnTrans.title = 'Show transitive dependency edges for the focused node';
    const depthCtrl = document.getElementById('depth-control');
    depthCtrl.parentNode.insertBefore(btnTrans, depthCtrl);
    btnTrans.addEventListener('click', () => {
      showTransitive = !showTransitive;
      btnTrans.textContent = `Transitive: ${showTransitive ? 'On' : 'Off'}`;
      btnTrans.style.color = showTransitive ? '#c084fc' : '';
      rerender();
    });

    // ── Layout mode toggle ─────────────────────────────────────────────────────
    const btnLayoutMode = document.createElement('button');
    btnLayoutMode.className = 'tb-btn'; btnLayoutMode.id = 'btn-layout-mode';
    btnLayoutMode.textContent = 'Layout: Flat';
    btnLayoutMode.title = 'Flat: all direct deps in one row. Deep: longest-path layers.';
    depthCtrl.parentNode.insertBefore(btnLayoutMode, depthCtrl);
    btnLayoutMode.addEventListener('click', () => {
      subgraphLayoutMode = subgraphLayoutMode === 'flat' ? 'deep' : 'flat';
      btnLayoutMode.textContent = `Layout: ${subgraphLayoutMode === 'flat' ? 'Flat' : 'Deep'}`;
      if (focusedId) {
        const visibleIds = getEffectiveVisibleIds();
        const targetPos  = computeCustomSubgraphLayout(focusedId, visibleIds);
        drawEdges(visibleIds);
        drawNodes(visibleIds);
        if (Object.keys(targetPos).length > 0) animateToLayout(targetPos);
      }
    });

    // ── Edge mode toggle ──────────────────────────────────────────────────────
    const btnEdge = document.createElement('button');
    btnEdge.className = 'tb-btn'; btnEdge.id = 'btn-edge-mode';
    btnEdge.textContent = 'Arrow Style: Bent';
    btnEdge.title = 'Toggle straight / orthogonal edge routing';
    depthCtrl.parentNode.insertBefore(btnEdge, depthCtrl);
    btnEdge.addEventListener('click', () => {
      edgeMode = edgeMode === 'straight' ? 'orthogonal' : 'straight';
      btnEdge.textContent = edgeMode === 'straight' ? 'Arrow Style: Bent' : 'Arrow Style: Straight';
      rerender();
    });

    // ── Panel / toolbar wiring ────────────────────────────────────────────────
    document.getElementById('tab-type').addEventListener('click', () => {
      explorerMode = 'type';
      document.getElementById('tab-type').classList.add('active');
      document.getElementById('tab-path').classList.remove('active');
      updateExplorer();
    });
    document.getElementById('tab-path').addEventListener('click', () => {
      explorerMode = 'path';
      document.getElementById('tab-path').classList.add('active');
      document.getElementById('tab-type').classList.remove('active');
      updateExplorer();
    });
    document.getElementById('explorer-filter').addEventListener('input', updateExplorer);
    document.getElementById('depth-slider').addEventListener('input', e => {
      depthValue = parseInt(e.target.value);
      document.getElementById('depth-value').textContent = depthValue;
      // Re-layout if a node is focused so the new depth neighbourhood is organised
      if (focusedId) {
        const visibleIds = getEffectiveVisibleIds();
        const targetPos  = computeCustomSubgraphLayout(focusedId, visibleIds);
        drawEdges(visibleIds);
        drawNodes(visibleIds);
        if (Object.keys(targetPos).length > 0) animateToLayout(targetPos);
      } else {
        rerender();
      }
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      focusedId   = null;
      selectedIds = new Set();
      updateExplorer();
      rerender();
    });
    document.getElementById('btn-fit').addEventListener('click', () => {
      const { width: svgW, height: svgH } = document.getElementById('graph-svg').getBoundingClientRect();
      const positions = Object.values(nodePos);
      if (!positions.length) return;
      const hw = NODE_W / 2, hh = NODE_H / 2;
      const minX = Math.min(...positions.map(p => p.x)) - hw;
      const maxX = Math.max(...positions.map(p => p.x)) + hw;
      const minY = Math.min(...positions.map(p => p.y)) - hh;
      const maxY = Math.max(...positions.map(p => p.y)) + hh;
      const pad   = 40;
      const scale = Math.min((svgW - pad * 2) / (maxX - minX), (svgH - pad * 2) / (maxY - minY), 1);
      const tx = (svgW - (maxX + minX) * scale) / 2;
      const ty = (svgH - (maxY + minY) * scale) / 2;
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    });

    updateExplorer();
    render();
    setTimeout(() => {
      // Auto-focus the first app module (alphabetically) so the graph opens
      // with a meaningful layout rather than the raw dagre view.
      const firstApp = data.modules
        .filter(m => m.type === 'app')
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (firstApp) {
        focusedId = firstApp.id;
        updateExplorer();
        const visibleIds = getEffectiveVisibleIds();
        const targetPos  = computeCustomSubgraphLayout(focusedId, visibleIds);
        // Snap to final positions — no animation on startup
        Object.entries(targetPos).forEach(([id, p]) => {
          if (nodePos[id]) { nodePos[id].x = p.x; nodePos[id].y = p.y; }
        });
        drawEdges(visibleIds);
        drawNodes(visibleIds);
      }
      document.getElementById('btn-fit').click();
    }, 50);
  });
})();
