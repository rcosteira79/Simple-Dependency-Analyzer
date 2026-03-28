(function () {
  const data = window.__GRAPH_DATA__;
  if (!data) { document.body.innerHTML = '<p style="color:red">No graph data found.</p>'; return; }

  const APP_NAME = data.appName || 'Project';

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 140, NODE_H = 32, GAP = 8, FOCUS_GAP = 10;
  const PORT_SPACING = 14;
  const CORNER_R = 6;
  const LAYER_ORDER = ['app', 'feature', 'core', 'data', 'unknown'];
  const NODE_COLORS_DARK   = { app:'#7b1212', feature:'#0d3461', core:'#2d0d5e', data:'#0d3318', unknown:'#2a2a2a' };
  const NODE_BORDERS_DARK  = { app:'#c62828', feature:'#1565c0', core:'#6a1fc2', data:'#2e7d32', unknown:'#555' };
  const NODE_COLORS_LIGHT  = { app:'#ffcdd2', feature:'#bbdefb', core:'#e1bee7', data:'#c8e6c9', unknown:'#e0e0e0' };
  const NODE_BORDERS_LIGHT = { app:'#e53935', feature:'#1976d2', core:'#8e24aa', data:'#43a047', unknown:'#999' };
  function isLight() { return document.documentElement.classList.contains('light'); }
  function getNodeColors()  { return isLight() ? NODE_COLORS_LIGHT  : NODE_COLORS_DARK; }
  function getNodeBorders() { return isLight() ? NODE_BORDERS_LIGHT : NODE_BORDERS_DARK; }
  const OPPOSITE_SIDE = { bottom:'top', top:'bottom', right:'left', left:'right' };

  let focusedId   = null;
  let depthValue  = 1;
  let edgeMode    = 'straight'; // 'straight' | 'orthogonal'
  let showTransitive      = false;
  let subgraphLayoutMode  = 'flat';     // 'flat' (BFS rows) | 'deep' (longest-path)
  let selectedIds = new Set();
  let isAnimating = false;
  let showInterDeps = false;

  // ── Inspection state ──────────────────────────────────────────────────────
  let inspectedModuleId   = null;    // module being inspected (shown as bounding box)
  let inspectionTargetId  = null;    // module we're viewing relationship with
  const expandedPackages  = new Map(); // inspectedModuleId → Set of expanded package names
  let highlightedClassId  = null;

  const hasClassData = !!(data.classData && Object.keys(data.classData).length > 0);

  // Package pill dimensions
  const PILL_W = 180, PILL_H = 24;
  const CLASS_H = 22;
  const CHAR_W = 6.2; // approximate monospace char width at font-size 9
  const MIN_CLASS_W = 120;

  // Compute class box width from the longest class name in a set of packages
  function classWidthForPackages(pkgList) {
    let maxLen = 0;
    pkgList.forEach(pkg => {
      pkg.classes.forEach(cls => { maxLen = Math.max(maxLen, cls.simpleName.length); });
    });
    return Math.max(MIN_CLASS_W, maxLen * CHAR_W + 16); // 16 for padding
  }
  const BOX_PAD = 16;
  // Mutable node positions — initialised from dagre, updated by drag/layout
  const nodePos      = {};
  // Live <g> element references — updated by drawNodes, used for animation
  const nodeElements = {};

  // Fast module lookup
  const moduleById = {};
  data.modules.forEach(m => { moduleById[m.id] = m; });

  // ── Context menu ──────────────────────────────────────────────────────────
  let contextMenu = null;
  let contextMenuOpenedAt = 0;

  function showContextMenu(x, y, items) {
    hideContextMenu();
    contextMenuOpenedAt = Date.now();
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

  // Ignore clicks within 300ms of opening (Mac two-finger click fires click right after contextmenu)
  document.addEventListener('click', () => {
    if (Date.now() - contextMenuOpenedAt > 300) hideContextMenu();
  });

  // ── Inspection / highlight logic ────────────────────────────────────────
  function cleanUpSubPositions() {
    Object.keys(nodePos).forEach(key => {
      if (key.startsWith('pkg:') || key.startsWith('class:')) {
        delete nodePos[key];
      }
    });
  }

  function enterInspection(moduleId) {
    if (!hasClassData || !data.classData[moduleId]) return;
    inspectedModuleId = moduleId;
    inspectionTargetId = null;
    expandedPackages.clear();
    highlightedClassId = null;
    rerender();
  }

  function exitInspection() {
    cleanUpSubPositions();
    inspectedModuleId = null;
    inspectionTargetId = null;
    expandedPackages.clear();
    highlightedClassId = null;
    rerender();
  }

  function setInspectionTarget(targetId) {
    if (targetId === inspectedModuleId) return;
    cleanUpSubPositions();
    inspectionTargetId = targetId;
    expandedPackages.clear();
    highlightedClassId = null;
    rerender();
  }

  function togglePackage(packageName) {
    if (!inspectedModuleId) return;
    const expanded = expandedPackages.get(inspectedModuleId) || new Set();
    if (expanded.has(packageName)) {
      expanded.delete(packageName);
      highlightedClassId = null;
    } else {
      expanded.add(packageName);
    }
    expandedPackages.set(inspectedModuleId, expanded);
    rerender();
  }

  function getRelationshipData(inspectedId, targetId) {
    if (!targetId) return null;

    // Collect ALL class edges between these two modules from BOTH sides
    const relevantEdges = [];

    const inspectedData = data.classData[inspectedId];
    if (inspectedData) {
      inspectedData.classEdges.forEach(ce => {
        if ((ce.fromModuleId === inspectedId && ce.toModuleId === targetId) ||
            (ce.fromModuleId === targetId && ce.toModuleId === inspectedId)) {
          relevantEdges.push(ce);
        }
      });
    }

    const targetData = data.classData[targetId];
    if (targetData) {
      targetData.classEdges.forEach(ce => {
        if ((ce.fromModuleId === targetId && ce.toModuleId === inspectedId) ||
            (ce.fromModuleId === inspectedId && ce.toModuleId === targetId)) {
          // Avoid duplicates
          const isDup = relevantEdges.some(e =>
            e.fromClassId === ce.fromClassId && e.toClassId === ce.toClassId &&
            e.fromModuleId === ce.fromModuleId && e.toModuleId === ce.toModuleId
          );
          if (!isDup) relevantEdges.push(ce);
        }
      });
    }

    if (relevantEdges.length === 0) return null;

    // Group by what the TARGET module provides/consumes
    // "USED FROM target": classes in TARGET that the inspected module references (outgoing from inspected)
    // "PROVIDES TO target": classes in INSPECTED that the target module references (incoming to inspected)
    const usedFromTarget = new Set();    // target class IDs that inspected uses
    const providedToTarget = new Set();  // inspected class IDs that target uses

    relevantEdges.forEach(ce => {
      if (ce.fromModuleId === inspectedId && ce.toModuleId === targetId) {
        usedFromTarget.add(ce.toClassId);
      }
      if (ce.fromModuleId === targetId && ce.toModuleId === inspectedId) {
        providedToTarget.add(ce.toClassId);
      }
    });

    // Build sections from the TARGET's packages (for "used from")
    const usedFromPackages = [];
    if (targetData && usedFromTarget.size > 0) {
      targetData.packages.forEach(pkg => {
        const matchingClasses = pkg.classes.filter(c => usedFromTarget.has(c.id));
        if (matchingClasses.length > 0) {
          usedFromPackages.push({ name: pkg.name, classes: matchingClasses });
        }
      });
      // Also check if target classes aren't in target's packages (boundary filtering)
      // Add any missing classes
      usedFromTarget.forEach(classId => {
        const alreadyIncluded = usedFromPackages.some(p => p.classes.some(c => c.id === classId));
        if (!alreadyIncluded) {
          const pkg = classId.substring(0, classId.lastIndexOf('.'));
          const simpleName = classId.substring(classId.lastIndexOf('.') + 1);
          const existing = usedFromPackages.find(p => p.name === pkg);
          if (existing) {
            existing.classes.push({ id: classId, simpleName });
          } else {
            usedFromPackages.push({ name: pkg, classes: [{ id: classId, simpleName }] });
          }
        }
      });
    }

    // Build sections from the INSPECTED's packages (for "provided to")
    const providedToPackages = [];
    if (inspectedData && providedToTarget.size > 0) {
      inspectedData.packages.forEach(pkg => {
        const matchingClasses = pkg.classes.filter(c => providedToTarget.has(c.id));
        if (matchingClasses.length > 0) {
          providedToPackages.push({ name: pkg.name, classes: matchingClasses });
        }
      });
      providedToTarget.forEach(classId => {
        const alreadyIncluded = providedToPackages.some(p => p.classes.some(c => c.id === classId));
        if (!alreadyIncluded) {
          const pkg = classId.substring(0, classId.lastIndexOf('.'));
          const simpleName = classId.substring(classId.lastIndexOf('.') + 1);
          const existing = providedToPackages.find(p => p.name === pkg);
          if (existing) {
            existing.classes.push({ id: classId, simpleName });
          } else {
            providedToPackages.push({ name: pkg, classes: [{ id: classId, simpleName }] });
          }
        }
      });
    }

    return {
      usedFromPackages,     // target's classes that inspected uses
      providedToPackages,   // inspected's classes that target uses
      classEdges: relevantEdges,
    };
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
    if (moduleId !== inspectedModuleId) return { width: NODE_W, height: NODE_H };

    const relData = inspectionTargetId ? getRelationshipData(inspectedModuleId, inspectionTargetId) : null;
    if (!relData || (relData.usedFromPackages.length === 0 && relData.providedToPackages.length === 0)) {
      return { width: 300, height: 80 };
    }

    const expanded = expandedPackages.get(moduleId) || new Set();
    const usedFromPkgs = relData.usedFromPackages;
    const providedToPkgs = relData.providedToPackages;
    const allPkgs = [...usedFromPkgs, ...providedToPkgs];
    const dynamicClassW = classWidthForPackages(allPkgs);

    const TITLE_H = 38;
    const ZONE_LABEL_H = 18;

    function zoneSize(pkgs) {
      const MAX_COLS = 8;
      let itemIndex = 0;
      let maxRowWidth = 0;

      pkgs.forEach(pkg => {
        if (expanded.has(pkg.name)) {
          if (itemIndex % MAX_COLS !== 0) itemIndex = Math.ceil(itemIndex / MAX_COLS) * MAX_COLS;
          itemIndex += MAX_COLS; // header row
          const classMaxCols = Math.min(pkg.classes.length, MAX_COLS);
          const classRows = Math.ceil(pkg.classes.length / classMaxCols);
          maxRowWidth = Math.max(maxRowWidth, classMaxCols * (dynamicClassW + 8));
          itemIndex += classRows * MAX_COLS;
        } else {
          itemIndex++;
        }
      });

      const totalRows = Math.ceil(itemIndex / MAX_COLS);
      const pillCols = Math.min(pkgs.filter(p => !expanded.has(p.name)).length, MAX_COLS);
      const pillRowW = pillCols * (PILL_W + 8);
      maxRowWidth = Math.max(maxRowWidth, pillRowW);

      return {
        width: maxRowWidth + BOX_PAD * 2,
        height: totalRows * (PILL_H + 6) + ZONE_LABEL_H,
      };
    }

    const usedFromSize = usedFromPkgs.length > 0 ? zoneSize(usedFromPkgs) : { width: 0, height: 0 };
    const providedToSize = providedToPkgs.length > 0 ? zoneSize(providedToPkgs) : { width: 0, height: 0 };

    const boxW = Math.max(350, usedFromSize.width, providedToSize.width, PILL_W + BOX_PAD * 2);
    const boxH = TITLE_H + usedFromSize.height + providedToSize.height + BOX_PAD * 2;

    return { width: boxW, height: Math.max(boxH, 80) };
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
      const unfoldSize = (m.id === inspectedModuleId) ? getUnfoldedBoxSize(m.id) : null;
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
    const hasUnfolded = [...visibleIds].some(id => id === inspectedModuleId);
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

    // Build result — visible nodes get their computed positions
    const result = {};
    visibleIds.forEach(id => {
      const l = layerOf[id] ?? 0;
      result[id] = { x: xOf[id] ?? vpCx, y: vpCy + l * LAYER_SEP };
    });

    // Push non-visible modules far below the subgraph so they don't overlap
    const maxY = Math.max(...Object.values(result).map(p => p.y));
    const OFFSCREEN_GAP = 600;
    let offIdx = 0;
    data.modules.forEach(m => {
      if (!visibleIds.has(m.id) && nodePos[m.id]) {
        result[m.id] = { x: vpCx + (offIdx - 3) * NODE_SEP * 0.6, y: maxY + OFFSCREEN_GAP + Math.floor(offIdx / 7) * 200 };
        offIdx++;
      }
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
  function nodeSizeFor(moduleId) {
    if (moduleId === inspectedModuleId) {
      const s = getUnfoldedBoxSize(moduleId);
      return { hw: s.width / 2, hh: s.height / 2 };
    }
    return { hw: NODE_W / 2, hh: NODE_H / 2 };
  }

  function nodeEdgePoint(cx, cy, tx, ty, gap, moduleId) {
    const dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return { x: cx, y: cy };
    const { hw, hh } = moduleId ? nodeSizeFor(moduleId) : { hw: NODE_W / 2, hh: NODE_H / 2 };
    const ux = dx / len, uy = dy / len;
    const tX = (hw + gap) / Math.abs(ux || 1e-9);
    const tY = (hh + gap) / Math.abs(uy || 1e-9);
    return { x: cx + ux * Math.min(tX, tY), y: cy + uy * Math.min(tX, tY) };
  }

  function buildStraightPath(sp, tp, srcGap, tgtGap, srcModuleId, tgtModuleId) {
    const src = nodeEdgePoint(sp.x, sp.y, tp.x, tp.y, srcGap, srcModuleId);
    const tgt = nodeEdgePoint(tp.x, tp.y, sp.x, sp.y, tgtGap, tgtModuleId);
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
      const isInspectionEdge = inspectedModuleId && inspectionTargetId &&
        ((e.from === inspectedModuleId && e.to === inspectionTargetId) ||
         (e.from === inspectionTargetId && e.to === inspectedModuleId));
      const isInspectionDimEdge = inspectedModuleId && inspectionTargetId && !isInspectionEdge;
      const srcGap = e.from === focusedId ? FOCUS_GAP : GAP;
      const tgtGap = e.to   === focusedId ? FOCUS_GAP : GAP;

      const pathD = edgeMode === 'orthogonal'
        ? buildEdgePath(sp, tp, portOffsets[i].src, portOffsets[i].tgt, srcGap, tgtGap)
        : buildStraightPath(sp, tp, srcGap, tgtGap, e.from, e.to);

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
        path.setAttribute('stroke', isLight() ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('opacity', opacity);
        path.setAttribute('marker-end', isLight() ? 'url(#arrow-rel-light)' : 'url(#arrow-rel)');
      }

      if (isInspectionDimEdge) {
        path.setAttribute('opacity', '0.05');
      } else if (isInspectionEdge) {
        path.setAttribute('stroke', '#66bb6a');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('opacity', '1');
        path.setAttribute('marker-end', 'url(#arrow-class-out)');
      }

      // When inter-deps mode is on, highlight all edges within the visible subgraph
      if (showInterDeps && focusedId && isInSubgraph && !isCycle && !isFocusEdge) {
        path.setAttribute('stroke', '#66bb6a');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('opacity', '0.6');
        path.setAttribute('marker-end', 'url(#arrow-class-out)');
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
          : buildStraightPath(sp, tp, GAP, GAP, fromId, toId);
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

  }

  // ── Draw nodes ─────────────────────────────────────────────────────────────
  function drawNodes(visibleIds) {
    const { modules } = data;
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const nodeGroup = document.getElementById('nodes');
    nodeGroup.innerHTML = '';

    modules.forEach(m => {
      if (m.id === inspectedModuleId) {
        drawUnfoldedModule(m, visibleIds);
        return;
      }

      const pos = nodePos[m.id];
      if (!pos) return;
      const isFocused   = m.id === focusedId;
      const isSelected  = selectedIds.has(m.id);
      const isDim       = focusedId && !visibleIds.has(m.id);
      const isInspectionDim = inspectedModuleId && inspectionTargetId &&
        m.id !== inspectedModuleId && m.id !== inspectionTargetId;
      const isCycleNode = cycleNodeIds.has(m.id);
      const color  = getNodeColors()[m.type]  || getNodeColors().unknown;
      const border = getNodeBorders()[m.type] || getNodeBorders().unknown;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      nodeElements[m.id] = g;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -hw); rect.setAttribute('y', -hh);
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', '5'); rect.setAttribute('fill', color);
      const isInspectionTarget = m.id === inspectionTargetId;
      const strokeColor = isInspectionTarget ? '#66bb6a' : isFocused ? '#f5a623' : isSelected ? '#4fc3f7' : isCycleNode ? '#e53935' : border;
      const strokeWidth = (isFocused || isSelected || isInspectionTarget) ? '2.5' : isCycleNode ? '2' : '1';
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('opacity', isDim ? '0.12' : isInspectionDim ? '0.25' : '1');

      const isLightTheme = document.documentElement.classList.contains('light');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 0); text.setAttribute('y', 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', isLightTheme ? '#333' : 'white');
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('opacity', isDim ? '0.12' : isInspectionDim ? '0.25' : '1');
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
        .filter(event => !event.ctrlKey && event.button === 0)
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

      function showNodeContextMenu(event) {
        event.preventDefault();
        event.stopPropagation();
        const items = [];
        if (hasClassData && data.classData[m.id] && data.classData[m.id].packages.length > 0 && m.id !== inspectedModuleId) {
          items.push({ label: 'Inspect', action: () => enterInspection(m.id) });
        }
        if (m.id === inspectedModuleId) {
          items.push({ label: 'Exit inspection', action: () => exitInspection() });
        }
        if (items.length > 0) showContextMenu(event.clientX, event.clientY, items);
      }

      // Native contextmenu (right-click on mouse)
      g.addEventListener('contextmenu', showNodeContextMenu);

      // Ctrl+click (Mac two-finger click triggers mousedown with ctrlKey+button 0)
      g.addEventListener('mousedown', function (event) {
        if (event.button === 0 && event.ctrlKey) {
          showNodeContextMenu(event);
        }
      });
    });
  }

  // ── Draw unfolded module ───────────────────────────────────────────────────
  function drawUnfoldedModule(m, visibleIds) {
    const pos = nodePos[m.id];
    if (!pos) return;
    const isDim = focusedId && !visibleIds.has(m.id);

    const nodeGroup = document.getElementById('nodes');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    nodeElements[m.id] = g;

    const boxSize = getUnfoldedBoxSize(m.id);
    const boxW = boxSize.width;
    const boxH = boxSize.height;

    // Dashed bounding box
    const border = getNodeBorders()[m.type] || getNodeBorders().unknown;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const isLightTheme = document.documentElement.classList.contains('light');
    rect.setAttribute('x', -boxW / 2); rect.setAttribute('y', -boxH / 2);
    rect.setAttribute('width', boxW); rect.setAttribute('height', boxH);
    rect.setAttribute('rx', '8'); rect.setAttribute('fill', isLightTheme ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,30,0.85)');
    rect.setAttribute('stroke', border); rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '6,3');
    rect.setAttribute('opacity', isDim ? '0.12' : '1');
    g.appendChild(rect);

    // Title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', 0); title.setAttribute('y', -boxH / 2 + 18);
    title.setAttribute('text-anchor', 'middle'); title.setAttribute('font-size', '10');
    title.setAttribute('font-family', 'monospace'); title.setAttribute('fill', isLightTheme ? '#444' : '#888');
    title.setAttribute('opacity', isDim ? '0.12' : '1');
    title.textContent = m.id;
    title.style.cursor = 'pointer';
    function showTitleContextMenu(event) {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Exit inspection', action: () => exitInspection() },
      ]);
    }
    title.addEventListener('contextmenu', showTitleContextMenu);
    title.addEventListener('mousedown', (event) => {
      if (event.button === 0 && event.ctrlKey) showTitleContextMenu(event);
    });
    g.appendChild(title);

    const relData = inspectionTargetId ? getRelationshipData(inspectedModuleId, inspectionTargetId) : null;

    if (!relData || (relData.usedFromPackages.length === 0 && relData.providedToPackages.length === 0)) {
      // Empty state — show hint message
      const msg = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      msg.setAttribute('x', 0); msg.setAttribute('y', 8);
      msg.setAttribute('text-anchor', 'middle'); msg.setAttribute('font-size', '9');
      msg.setAttribute('font-family', 'monospace'); msg.setAttribute('fill', '#555');
      msg.textContent = inspectionTargetId ? 'No class dependencies with this module' : 'Click a module to see class dependencies';
      g.appendChild(msg);
    } else {
      // Show target's classes grouped by zone
      const expanded = expandedPackages.get(m.id) || new Set();
      const usedFromPkgs = relData.usedFromPackages;
      const providedToPkgs = relData.providedToPackages;
      const dynClassW = classWidthForPackages([...usedFromPkgs, ...providedToPkgs]);

      // Subtitle showing which relationship
      const subtitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subtitle.setAttribute('x', 0); subtitle.setAttribute('y', -boxH / 2 + 30);
      subtitle.setAttribute('text-anchor', 'middle'); subtitle.setAttribute('font-size', '8');
      subtitle.setAttribute('font-family', 'monospace'); subtitle.setAttribute('fill', '#555');
      subtitle.textContent = '\u2194 ' + inspectionTargetId;
      g.appendChild(subtitle);

      function drawZone(pkgs, zoneLabel, zoneTop, zoneColor) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', -boxW / 2 + BOX_PAD); label.setAttribute('y', zoneTop + 12);
        label.setAttribute('font-size', '8'); label.setAttribute('font-family', 'monospace');
        label.setAttribute('fill', zoneColor); label.setAttribute('pointer-events', 'none');
        label.textContent = zoneLabel;
        g.appendChild(label);

        const yBase = zoneTop + 20;
        const MAX_COLS = 8;
        let itemIndex = 0;

        pkgs.forEach(pkg => {
          const color = zoneColor;

          if (expanded.has(pkg.name)) {
            // Start expanded package on a new row
            if (itemIndex % MAX_COLS !== 0) { itemIndex = Math.ceil(itemIndex / MAX_COLS) * MAX_COLS; }

            // Package header
            const headerRow = Math.floor(itemIndex / MAX_COLS);
            const headerY = yBase + headerRow * (PILL_H + 6);

            const header = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            header.setAttribute('x', -boxW / 2 + BOX_PAD); header.setAttribute('y', headerY + 12);
            header.setAttribute('font-size', '9'); header.setAttribute('font-family', 'monospace');
            header.setAttribute('fill', color); header.setAttribute('cursor', 'pointer');
            header.textContent = '\u25BE ' + pkg.name.split('.').slice(-2).join('.');
            header.addEventListener('click', () => togglePackage(pkg.name));
            g.appendChild(header);
            itemIndex = (headerRow + 1) * MAX_COLS; // move to next row for classes

            // Classes in a grid (max MAX_COLS columns)
            const classMaxCols = Math.min(pkg.classes.length, MAX_COLS);
            pkg.classes.forEach((cls, ci) => {
              const col = ci % classMaxCols;
              const row = Math.floor(ci / classMaxCols);
              const classRow = Math.floor(itemIndex / MAX_COLS) + row;
              const cx = -boxW / 2 + BOX_PAD + col * (dynClassW + 8) + dynClassW / 2;
              const cy = yBase + classRow * (PILL_H + 6) + (PILL_H - CLASS_H) / 2;

              const isHighlighted = highlightedClassId === cls.id;
              const clsRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              clsRect.setAttribute('x', cx - dynClassW / 2); clsRect.setAttribute('y', cy);
              clsRect.setAttribute('width', dynClassW); clsRect.setAttribute('height', CLASS_H);
              clsRect.setAttribute('rx', '3');
              clsRect.setAttribute('fill', isHighlighted ? '#333' : '#252525');
              clsRect.setAttribute('stroke', isHighlighted ? '#fff' : color);
              clsRect.setAttribute('stroke-width', isHighlighted ? '2' : '0.5');
              // Dashed border for inline-only dependencies
              const clsEdges = relData.classEdges.filter(ce => ce.fromClassId === cls.id || ce.toClassId === cls.id);
              const isInlineOnly = clsEdges.length > 0 && clsEdges.every(ce => ce.kind === 'INLINE');
              if (isInlineOnly) {
                clsRect.setAttribute('stroke-dasharray', '3,2');
              }
              clsRect.style.cursor = 'pointer';
              clsRect.addEventListener('click', (event) => {
                event.stopPropagation();
                highlightedClassId = highlightedClassId === cls.id ? null : cls.id;
                // Show usage details in the right panel
                const detail = document.getElementById('edge-detail');
                const usages = relData.classEdges.filter(ce =>
                  ce.fromClassId === cls.id || ce.toClassId === cls.id
                );
                const lines = usages.map(ce => {
                  const kindTag = ce.kind === 'INLINE' ? ' <span style="color:#ff9800;font-size:8px">(inline)</span>' : '';
                  if (ce.fromClassId === cls.id) {
                    return `<span style="color:#66bb6a">\u2192 uses</span> <span style="color:var(--detail-path)">${ce.toClassId}</span>${kindTag}`;
                  } else {
                    return `<span style="color:#42a5f5">\u2190 used by</span> <span style="color:var(--detail-path)">${ce.fromClassId}</span>${kindTag}`;
                  }
                });
                detail.innerHTML =
                  `<strong style="color:var(--detail-title)">${cls.simpleName}</strong>` +
                  `<div style="color:var(--detail-sub);font-size:9px;margin:2px 0">${cls.id}</div>` +
                  `<hr style="border-color:var(--detail-hr);margin:6px 0"/>` +
                  `<div style="line-height:1.8;font-size:10px">${lines.join('<br/>')}</div>`;
                rerender();
              });
              g.appendChild(clsRect);

              const clsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              clsText.setAttribute('x', cx); clsText.setAttribute('y', cy + 14);
              clsText.setAttribute('text-anchor', 'middle'); clsText.setAttribute('font-size', '9');
              clsText.setAttribute('font-family', 'monospace');
              clsText.setAttribute('fill', isHighlighted ? '#fff' : '#aaa');
              clsText.setAttribute('pointer-events', 'none');
              clsText.textContent = cls.simpleName;
              g.appendChild(clsText);

              nodePos['class:' + cls.id] = { x: pos.x + cx, y: pos.y + cy + CLASS_H / 2 };
            });

            const classRows = Math.ceil(pkg.classes.length / classMaxCols);
            itemIndex = (Math.floor(itemIndex / MAX_COLS) + classRows) * MAX_COLS;
          } else {
            // Collapsed pill in matrix position
            const col = itemIndex % MAX_COLS;
            const row = Math.floor(itemIndex / MAX_COLS);
            const pillX = -boxW / 2 + BOX_PAD + col * (PILL_W + 8);
            const pillY = yBase + row * (PILL_H + 6);

            const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pill.setAttribute('x', pillX); pill.setAttribute('y', pillY);
            pill.setAttribute('width', PILL_W); pill.setAttribute('height', PILL_H);
            pill.setAttribute('rx', PILL_H / 2); pill.setAttribute('fill', '#1a1a2e');
            pill.setAttribute('stroke', color); pill.setAttribute('stroke-width', '1');
            pill.style.cursor = 'pointer';
            pill.addEventListener('click', (event) => {
              event.stopPropagation();
              togglePackage(pkg.name);
            });
            g.appendChild(pill);

            const pillText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            pillText.setAttribute('x', pillX + PILL_W / 2); pillText.setAttribute('y', pillY + 15);
            pillText.setAttribute('text-anchor', 'middle'); pillText.setAttribute('font-size', '9');
            pillText.setAttribute('font-family', 'monospace'); pillText.setAttribute('fill', color);
            pillText.setAttribute('pointer-events', 'none');
            const shortPkg = pkg.name.split('.').slice(-2).join('.');
            pillText.textContent = shortPkg + ' (' + pkg.classes.length + ')';
            g.appendChild(pillText);

            nodePos['pkg:' + m.id + ':' + pkg.name] = { x: pos.x + pillX + PILL_W / 2, y: pos.y + pillY + PILL_H / 2 };
            itemIndex++;
          }
        });
      }

      const TITLE_H = 38;
      let zoneY = -boxH / 2 + TITLE_H;

      if (usedFromPkgs.length > 0) {
        drawZone(usedFromPkgs, '\u25BC USED FROM ' + inspectionTargetId, zoneY, '#66bb6a');
        const usedFromSize = getUnfoldedBoxSize(m.id);  // recalc not ideal but safe
        // Advance by the actual used-from zone height
        const expandedSet = expandedPackages.get(m.id) || new Set();
        let usedIdx = 0;
        usedFromPkgs.forEach(pkg => {
          if (expandedSet.has(pkg.name)) {
            if (usedIdx % 8 !== 0) usedIdx = Math.ceil(usedIdx / 8) * 8;
            usedIdx += 8;
            usedIdx += Math.ceil(pkg.classes.length / Math.min(pkg.classes.length, 8)) * 8;
          } else { usedIdx++; }
        });
        zoneY += Math.ceil(usedIdx / 8) * (PILL_H + 6) + 24;
      }

      if (usedFromPkgs.length > 0 && providedToPkgs.length > 0) {
        const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        divider.setAttribute('x1', -boxW / 2 + 8); divider.setAttribute('y1', zoneY - 4);
        divider.setAttribute('x2', boxW / 2 - 8); divider.setAttribute('y2', zoneY - 4);
        divider.setAttribute('stroke', '#444'); divider.setAttribute('stroke-width', '0.5');
        divider.setAttribute('stroke-dasharray', '3,3');
        g.appendChild(divider);
      }

      if (providedToPkgs.length > 0) {
        drawZone(providedToPkgs, '\u25B2 PROVIDED TO ' + inspectionTargetId, zoneY, '#42a5f5');
      }
    }

    nodeGroup.appendChild(g);

    // Make draggable
    const drag = d3.drag()
      .filter(event => !event.ctrlKey && event.button === 0)
      .on('start', function (event) { d3.select(this).raise(); })
      .on('drag', function (event) {
        nodePos[m.id].x += event.dx;
        nodePos[m.id].y += event.dy;
        rerender();
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
    // If in inspection mode, clicking another module shows its relationship
    if (inspectedModuleId && id !== inspectedModuleId) {
      setInspectionTarget(id);
      return;
    }

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
      return `<span style="color:var(${isEndpoint ? '--detail-title' : '--detail-path'})">${id}</span>`;
    }).join('<br/><span style="color:#c084fc;font-size:9px">↓ via</span><br/>');
    detail.innerHTML =
      `<span style="color:#c084fc;font-weight:bold">◈ Transitive</span>` +
      `<span style="color:var(--detail-sub);font-size:9px"> · ${hops} hop${hops !== 1 ? 's' : ''}</span>` +
      `<hr style="border-color:var(--detail-hr);margin:6px 0"/>` +
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

    // D3 zoom is used only as a transform store and for animated transitions (fit button).
    // All wheel/pan interactions are handled manually for full trackpad compatibility.
    const zoom = d3.zoom()
      .filter(() => false) // disable all d3 default interactions
      .scaleExtent([0.05, 4])
      .on('zoom', event => content.attr('transform', event.transform));

    svg.call(zoom).on('dblclick.zoom', null);

    function applyTransform(tf) {
      // Clamp scale
      const k = Math.max(0.05, Math.min(4, tf.k));
      const clamped = d3.zoomIdentity.translate(tf.x, tf.y).scale(k);
      svg.node().__zoom = clamped;
      content.attr('transform', clamped.toString());
    }

    // All wheel events: pinch (ctrlKey) = zoom, swipe (no ctrlKey) = pan
    svg.node().addEventListener('wheel', event => {
      event.preventDefault();
      const tf = d3.zoomTransform(svg.node());

      if (event.ctrlKey) {
        // Pinch-to-zoom (or ctrl+scroll): zoom centred on cursor
        const [mx, my] = d3.pointer(event, svg.node());
        const factor = Math.pow(2, -event.deltaY * 0.01);
        const k = Math.max(0.05, Math.min(4, tf.k * factor));
        const newX = mx - (mx - tf.x) * k / tf.k;
        const newY = my - (my - tf.y) * k / tf.k;
        applyTransform(d3.zoomIdentity.translate(newX, newY).scale(k));
      } else {
        // Two-finger swipe / scroll wheel: pan
        applyTransform(tf.translate(-event.deltaX / tf.k, -event.deltaY / tf.k));
      }
    }, { passive: false });

    // Prevent middle-click autoscroll cursor
    svg.node().addEventListener('mousedown', event => {
      if (event.button === 1) event.preventDefault();
    }, { passive: false });

    // ── Left drag on background = pan; Ctrl+left drag = lasso multi-select ───
    let panStart  = null;
    let panOrigin = null;
    let lassoStart = null;
    let lassoEl    = null;

    svg.on('mousedown.bg', function (event) {
      if (event.button !== 0) return;
      if (document.getElementById('nodes').contains(event.target)) return;

      if (event.metaKey) {
        // Cmd+click (Mac) / Meta+click: start lasso selection
        const tf = d3.zoomTransform(svg.node());
        const [mx, my] = tf.invert(d3.pointer(event, svg.node()));
        lassoStart = { x: mx, y: my };
        lassoEl = content.append('rect')
          .attr('x', mx).attr('y', my).attr('width', 0).attr('height', 0)
          .attr('fill', 'rgba(79,195,247,0.07)')
          .attr('stroke', '#4fc3f7').attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,2').attr('pointer-events', 'none');
      } else {
        // Normal click: start panning
        panOrigin = panStart = { x: event.clientX, y: event.clientY };
        svg.style('cursor', 'grabbing');
      }
    });

    svg.on('mousemove.bg', function (event) {
      if (lassoStart) {
        const tf = d3.zoomTransform(svg.node());
        const [mx, my] = tf.invert(d3.pointer(event, svg.node()));
        lassoEl
          .attr('x', Math.min(lassoStart.x, mx)).attr('y', Math.min(lassoStart.y, my))
          .attr('width', Math.abs(mx - lassoStart.x)).attr('height', Math.abs(my - lassoStart.y));
      } else if (panStart) {
        const dx = event.clientX - panStart.x;
        const dy = event.clientY - panStart.y;
        panStart = { x: event.clientX, y: event.clientY };
        const tf = d3.zoomTransform(svg.node());
        applyTransform(tf.translate(dx / tf.k, dy / tf.k));
      }
    });

    svg.on('mouseup.bg', function (event) {
      if (lassoStart) {
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
        }

        lassoEl?.remove();
        lassoStart = null;
        lassoEl    = null;
      } else if (panOrigin) {
        svg.style('cursor', null);
        const wasDrag = Math.abs(event.clientX - panOrigin.x) > 3 || Math.abs(event.clientY - panOrigin.y) > 3;
        panStart = panOrigin = null;
        if (!wasDrag && selectedIds.size > 0) {
          selectedIds = new Set();
          rerender();
        }
      }
    });

    svg.on('mouseleave.bg', function () {
      if (panStart) { svg.style('cursor', null); panStart = panOrigin = null; }
    });

    const btnTrans = document.createElement('button');
    btnTrans.className = 'tb-btn'; btnTrans.id = 'btn-transitive';
    btnTrans.textContent = 'Transitive Dependencies: Off';
    btnTrans.title = 'Show transitive dependency edges for the focused node';
    const depthCtrl = document.getElementById('depth-control');
    depthCtrl.parentNode.insertBefore(btnTrans, depthCtrl);
    btnTrans.addEventListener('click', () => {
      showTransitive = !showTransitive;
      btnTrans.textContent = `Transitive Dependencies: ${showTransitive ? 'On' : 'Off'}`;
      btnTrans.style.color = showTransitive ? '#c084fc' : '';
      rerender();
    });

    // ── Inter-dependencies toggle (next to transitive) ──────────────────────
    const btnInterDeps = document.createElement('button');
    btnInterDeps.className = 'tb-btn'; btnInterDeps.id = 'btn-interdeps';
    btnInterDeps.textContent = 'Inter-deps: Off';
    btnInterDeps.title = 'Highlight all edges between visible modules';
    depthCtrl.parentNode.insertBefore(btnInterDeps, depthCtrl);
    btnInterDeps.addEventListener('click', () => {
      showInterDeps = !showInterDeps;
      btnInterDeps.textContent = `Inter-deps: ${showInterDeps ? 'On' : 'Off'}`;
      btnInterDeps.style.color = showInterDeps ? '#66bb6a' : '';
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
    btnEdge.textContent = 'Arrow Style: Straight';
    btnEdge.title = 'Toggle straight / orthogonal edge routing';
    depthCtrl.parentNode.insertBefore(btnEdge, depthCtrl);
    btnEdge.addEventListener('click', () => {
      edgeMode = edgeMode === 'straight' ? 'orthogonal' : 'straight';
      btnEdge.textContent = edgeMode === 'straight' ? 'Arrow Style: Straight' : 'Arrow Style: Bent';
      rerender();
    });

    // ── Theme toggle ──────────────────────────────────────────────────────────
    const btnTheme = document.createElement('button');
    btnTheme.className = 'tb-btn'; btnTheme.id = 'btn-theme';
    btnTheme.textContent = '\u2600 Light';
    btnTheme.title = 'Toggle dark/light theme';
    depthCtrl.parentNode.insertBefore(btnTheme, depthCtrl);
    btnTheme.addEventListener('click', () => {
      document.documentElement.classList.toggle('light');
      const isLightNow = document.documentElement.classList.contains('light');
      btnTheme.textContent = isLightNow ? '\uD83C\uDF19 Dark' : '\u2600 Light';
      rerender();
    });

    // ── PNG export ──────────────────────────────────────────────────────────
    const btnExport = document.createElement('button');
    btnExport.className = 'tb-btn'; btnExport.id = 'btn-export';
    btnExport.textContent = '\uD83D\uDCF7 Export PNG';
    btnExport.title = 'Export current view as PNG';
    depthCtrl.parentNode.insertBefore(btnExport, depthCtrl);
    btnExport.addEventListener('click', () => {
      const svgEl = document.getElementById('graph-svg');
      const svgRect = svgEl.getBoundingClientRect();

      // Clone the SVG and inline styles
      const clone = svgEl.cloneNode(true);
      clone.setAttribute('width', svgRect.width);
      clone.setAttribute('height', svgRect.height);

      // Add background
      const isLight = document.documentElement.classList.contains('light');
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('width', '100%');
      bgRect.setAttribute('height', '100%');
      bgRect.setAttribute('fill', isLight ? '#f5f5f5' : '#121220');
      clone.insertBefore(bgRect, clone.firstChild);

      const svgData = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2; // retina
        canvas.width = svgRect.width * scale;
        canvas.height = svgRect.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, svgRect.width, svgRect.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          const moduleName = focusedId ? focusedId.replace(/^:/, '').replace(/:/g, '_') : null;
          const targetName = inspectionTargetId ? inspectionTargetId.replace(/^:/, '').replace(/:/g, '_') : null;
          const exportName = moduleName && targetName
            ? `${APP_NAME}'s graph - ${moduleName} -> ${targetName}.png`
            : moduleName
            ? `${APP_NAME}'s graph - ${moduleName}.png`
            : `${APP_NAME}'s dependency graph.png`;
          a.download = exportName;
          a.click();
          URL.revokeObjectURL(a.href);
        }, 'image/png');
      };
      img.src = url;
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
      inspectedModuleId = null;
      inspectionTargetId = null;
      expandedPackages.clear();
      highlightedClassId = null;
      showInterDeps = false;
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

    // ── Resizable detail pane ──────────────────────────────────────────────────
    const resizeHandle = document.getElementById('detail-resize');
    const detailPane = document.getElementById('detail');
    if (resizeHandle && detailPane) {
      let isResizing = false;
      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const mainEl = document.getElementById('main');
        const newWidth = mainEl.getBoundingClientRect().right - e.clientX;
        detailPane.style.width = Math.max(120, Math.min(600, newWidth)) + 'px';
      });
      document.addEventListener('mouseup', () => { isResizing = false; });
    }

    // Set app name in toolbar and page title
    const appTitleEl = document.getElementById('app-title');
    if (appTitleEl) appTitleEl.textContent = `◈ ${APP_NAME}`;
    document.title = `${APP_NAME} — Simple Dependency Analyser`;

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
