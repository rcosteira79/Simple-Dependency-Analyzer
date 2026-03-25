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
  let depthValue  = 2;
  let edgeMode    = 'straight'; // 'straight' | 'orthogonal'
  let selectedIds = new Set();
  let isAnimating = false;

  // Mutable node positions — initialised from dagre, updated by drag/layout
  const nodePos      = {};
  // Live <g> element references — updated by drawNodes, used for animation
  const nodeElements = {};

  // Fast module lookup
  const moduleById = {};
  data.modules.forEach(m => { moduleById[m.id] = m; });

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
      const attrs = { width: NODE_W, height: NODE_H };
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

  // Run dagre on the visible subgraph and return new positions anchored so
  // the focused node stays at its current screen location.
  function computeSubgraphLayout(focusId, visibleIds) {
    const visMods  = data.modules.filter(m => visibleIds.has(m.id));
    const visEdges = data.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

    const g = buildDagreGraph(visMods, visEdges, { nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 });

    const newPos = {};
    visMods.forEach(m => {
      const n = g.node(m.id);
      if (n) newPos[m.id] = { x: n.x, y: n.y };
    });

    const curFocus = nodePos[focusId];
    const newFocus = newPos[focusId];
    if (!curFocus || !newFocus) return {};

    // Translate entire subgraph so the focused node doesn't jump
    const offX = curFocus.x - newFocus.x;
    const offY = curFocus.y - newFocus.y;
    const result = {};
    Object.entries(newPos).forEach(([id, p]) => {
      result[id] = { x: p.x + offX, y: p.y + offY };
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
      startPos[id] = { x: nodePos[id].x, y: nodePos[id].y };
    });

    const t0 = performance.now();
    isAnimating  = true;
    const visIds = getVisibleIds(focusedId, depthValue, data.modules, data.edges);

    function tick(now) {
      const raw = Math.min((now - t0) / duration, 1);
      const t   = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw; // ease-in-out

      Object.entries(targetPos).forEach(([id, tgt]) => {
        const s = startPos[id];
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

    edges.forEach((e, i) => {
      const sp = nodePos[e.from], tp = nodePos[e.to];
      if (!sp || !tp) return;

      const isCycle       = cycleEdgeKeys.has(`${e.from}|${e.to}`);
      const isFocusEdge   = focusedId && (e.from === focusedId || e.to === focusedId);
      const isInSubgraph  = !focusedId || (visibleIds.has(e.from) && visibleIds.has(e.to));
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
  }

  // ── Draw nodes ─────────────────────────────────────────────────────────────
  function drawNodes(visibleIds) {
    const { modules } = data;
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const nodeGroup = document.getElementById('nodes');
    nodeGroup.innerHTML = '';

    modules.forEach(m => {
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

      const drag = d3.drag()
        .on('start', function (event) {
          dragMoved   = false;
          prevDragPos = { x: event.x, y: event.y };
          d3.select(this).raise();
        })
        .on('drag', function (event) {
          dragMoved = true;
          const dx = event.x - prevDragPos.x;
          const dy = event.y - prevDragPos.y;
          prevDragPos = { x: event.x, y: event.y };

          const idsToMove = selectedIds.has(m.id) ? selectedIds : new Set([m.id]);
          idsToMove.forEach(id => {
            nodePos[id].x += dx;
            nodePos[id].y += dy;
            if (nodeElements[id]) {
              d3.select(nodeElements[id]).attr('transform', `translate(${nodePos[id].x},${nodePos[id].y})`);
            }
          });
          drawEdges(getVisibleIds(focusedId, depthValue, data.modules, data.edges));
        })
        .on('end', function () {
          prevDragPos = null;
          if (!dragMoved) onNodeClick(m.id);
        });

      d3.select(g).call(drag).style('cursor', 'grab');
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    computeLayout(data.modules, data.edges);
    rerender();
  }

  function rerender() {
    const visibleIds = getVisibleIds(focusedId, depthValue, data.modules, data.edges);
    drawEdges(visibleIds);
    drawNodes(visibleIds);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function onNodeClick(id) {
    const wasFocused = focusedId === id;
    focusedId = wasFocused ? null : id;
    updateExplorer();

    if (focusedId) {
      // Re-run dagre on the visible subgraph to minimise edge crossings,
      // then animate nodes to their new positions.
      const visibleIds = getVisibleIds(focusedId, depthValue, data.modules, data.edges);
      const targetPos  = computeSubgraphLayout(focusedId, visibleIds);
      // Draw at current positions first so nodeElements is populated
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

    // Scroll wheel = zoom; middle mouse drag = pan
    const zoom = d3.zoom()
      .filter(event => event.type === 'wheel' || event.button === 1)
      .scaleExtent([0.05, 4])
      .on('zoom', event => content.attr('transform', event.transform));

    svg.call(zoom).on('dblclick.zoom', null);

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

    // ── Edge mode toggle ──────────────────────────────────────────────────────
    const btnEdge = document.createElement('button');
    btnEdge.className = 'tb-btn'; btnEdge.id = 'btn-edge-mode';
    btnEdge.textContent = '⤡ Bent';
    btnEdge.title = 'Toggle straight / orthogonal edge routing';
    const depthCtrl = document.getElementById('depth-control');
    depthCtrl.parentNode.insertBefore(btnEdge, depthCtrl);
    btnEdge.addEventListener('click', () => {
      edgeMode = edgeMode === 'straight' ? 'orthogonal' : 'straight';
      btnEdge.textContent = edgeMode === 'straight' ? '⤡ Bent' : '⟶ Straight';
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
        const visibleIds = getVisibleIds(focusedId, depthValue, data.modules, data.edges);
        const targetPos  = computeSubgraphLayout(focusedId, visibleIds);
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
    setTimeout(() => document.getElementById('btn-fit').click(), 50);
  });
})();
