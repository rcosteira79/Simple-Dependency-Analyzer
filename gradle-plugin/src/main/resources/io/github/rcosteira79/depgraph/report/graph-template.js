(function () {
  const data = window.__GRAPH_DATA__;
  if (!data) { document.body.innerHTML = '<p style="color:red">No graph data found.</p>'; return; }

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 140, NODE_H = 32, GAP = 8, FOCUS_GAP = 10;
  const PORT_SPACING = 14;   // pixels between adjacent ports on the same side
  const CORNER_R = 6;        // orthogonal bend corner radius
  const LAYER_ORDER = ['app', 'feature', 'core', 'data', 'unknown'];
  const NODE_COLORS  = { app:'#7b1212', feature:'#0d3461', core:'#2d0d5e', data:'#0d3318', unknown:'#2a2a2a' };
  const NODE_BORDERS = { app:'#c62828', feature:'#1565c0', core:'#6a1fc2', data:'#2e7d32', unknown:'#555' };
  const OPPOSITE_SIDE = { bottom:'top', top:'bottom', right:'left', left:'right' };

  let focusedId = null;
  let depthValue = 2;

  // Mutable node positions — initialised from dagre, updated by drag
  const nodePos = {};

  // ── Layout (dagre) ─────────────────────────────────────────────────────────
  function computeLayout(modules, edges) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 80, marginy: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    modules.forEach(m => g.setNode(m.id, { width: NODE_W, height: NODE_H }));
    edges.forEach(e => g.setEdge(e.from, e.to));
    dagre.layout(g);
    modules.forEach(m => {
      const n = g.node(m.id);
      if (n) nodePos[m.id] = { x: n.x, y: n.y };
    });
  }

  // ── Visibility (focus + depth) ─────────────────────────────────────────────
  function getVisibleIds(focusId, depth, modules, edges) {
    if (!focusId) return new Set(modules.map(m => m.id));
    const visible = new Set([focusId]);
    let frontier = new Set([focusId]);
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

  // ── Orthogonal routing ─────────────────────────────────────────────────────

  // Which side of the source node an edge exits from, given source and target centres
  function exitSide(sp, tp) {
    const dx = tp.x - sp.x, dy = tp.y - sp.y;
    if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'bottom' : 'top';
    return dx > 0 ? 'right' : 'left';
  }

  // Compute per-edge port offsets so parallel edges on the same node side are spread out
  function computeEdgePorts(edges) {
    const sideEntries = {}; // `${nodeId}|${side}` → [{edgeIdx, isSource, otherPos}]

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
      const horizontal = side === 'top' || side === 'bottom';
      // Sort so adjacent ports go to nearby targets (reduces crossings)
      entries.sort((a, b) => horizontal
        ? a.otherPos.x - b.otherPos.x
        : a.otherPos.y - b.otherPos.y);
      const n = entries.length;
      const maxSpread = horizontal ? NODE_W * 0.65 : NODE_H * 0.65;
      const spacing = Math.min(PORT_SPACING, maxSpread / Math.max(n - 1, 1));
      entries.forEach(({ edgeIdx, isSource }, i) => {
        const offset = (i - (n - 1) / 2) * spacing;
        if (isSource) portOffset[edgeIdx].src = offset;
        else          portOffset[edgeIdx].tgt = offset;
      });
    });

    return portOffset;
  }

  // Build the SVG path string for a single orthogonal edge with rounded corners
  function buildEdgePath(sp, tp, srcOff, tgtOff, srcGap, tgtGap) {
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const side = exitSide(sp, tp);
    let p1, p2, p3, p4;

    if (side === 'bottom') {
      p1 = { x: sp.x + srcOff, y: sp.y + hh + srcGap };
      p4 = { x: tp.x + tgtOff, y: tp.y - hh - tgtGap };
      const midY = (p1.y + p4.y) / 2;
      p2 = { x: p1.x, y: midY };
      p3 = { x: p4.x, y: midY };
    } else if (side === 'top') {
      p1 = { x: sp.x + srcOff, y: sp.y - hh - srcGap };
      p4 = { x: tp.x + tgtOff, y: tp.y + hh + tgtGap };
      const midY = (p1.y + p4.y) / 2;
      p2 = { x: p1.x, y: midY };
      p3 = { x: p4.x, y: midY };
    } else if (side === 'right') {
      p1 = { x: sp.x + hw + srcGap, y: sp.y + srcOff };
      p4 = { x: tp.x - hw - tgtGap, y: tp.y + tgtOff };
      const midX = (p1.x + p4.x) / 2;
      p2 = { x: midX, y: p1.y };
      p3 = { x: midX, y: p4.y };
    } else { // left
      p1 = { x: sp.x - hw - srcGap, y: sp.y + srcOff };
      p4 = { x: tp.x + hw + tgtGap, y: tp.y + tgtOff };
      const midX = (p1.x + p4.x) / 2;
      p2 = { x: midX, y: p1.y };
      p3 = { x: midX, y: p4.y };
    }

    return roundedPolyPath([p1, p2, p3, p4], CORNER_R);
  }

  // Polyline with quadratic-Bezier rounded corners
  function roundedPolyPath(pts, r) {
    // Drop consecutive duplicates to avoid degenerate segments
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
    const portOffsets = computeEdgePorts(edges);
    const edgeGroup = document.getElementById('edges');
    edgeGroup.innerHTML = '';

    edges.forEach((e, i) => {
      const sp = nodePos[e.from], tp = nodePos[e.to];
      if (!sp || !tp) return;
      const isFocusedEdge = focusedId && (e.from === focusedId || e.to === focusedId);
      const isVisible = !focusedId || (visibleIds.has(e.from) && visibleIds.has(e.to));
      const srcGap = e.from === focusedId ? FOCUS_GAP : GAP;
      const tgtGap = e.to   === focusedId ? FOCUS_GAP : GAP;
      const { src: srcOff, tgt: tgtOff } = portOffsets[i];

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', buildEdgePath(sp, tp, srcOff, tgtOff, srcGap, tgtGap));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', isFocusedEdge ? '#f5a623' : 'rgba(255,255,255,0.3)');
      path.setAttribute('stroke-width', isFocusedEdge ? '2' : '1.2');
      path.setAttribute('opacity', isVisible ? '1' : '0.08');
      path.setAttribute('marker-end', isFocusedEdge ? 'url(#arrow-lit)' : 'url(#arrow-rel)');
      path.dataset.from = e.from; path.dataset.to = e.to;
      path.style.cursor = 'pointer';
      path.addEventListener('click', () => onEdgeClick(e.from, e.to));
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
      const isFocused = m.id === focusedId;
      const isDim    = focusedId && !visibleIds.has(m.id);
      const color  = NODE_COLORS[m.type]  || NODE_COLORS.unknown;
      const border = NODE_BORDERS[m.type] || NODE_BORDERS.unknown;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -hw); rect.setAttribute('y', -hh);
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', '5'); rect.setAttribute('fill', color);
      rect.setAttribute('stroke', isFocused ? '#f5a623' : border);
      rect.setAttribute('stroke-width', isFocused ? '2.5' : '1');
      rect.setAttribute('opacity', isDim ? '0.15' : '1');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 0); text.setAttribute('y', 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', 'white');
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('opacity', isDim ? '0.15' : '1');
      text.textContent = m.id;

      g.appendChild(rect);
      g.appendChild(text);
      nodeGroup.appendChild(g);

      // D3 drag — distinguishes click (no movement) from drag
      let dragMoved = false;
      const drag = d3.drag()
        .on('start', function () {
          dragMoved = false;
          d3.select(this).raise();
        })
        .on('drag', function (event) {
          dragMoved = true;
          nodePos[m.id].x = event.x;
          nodePos[m.id].y = event.y;
          d3.select(this).attr('transform', `translate(${event.x},${event.y})`);
          drawEdges(getVisibleIds(focusedId, depthValue, data.modules, data.edges));
        })
        .on('end', function () {
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
    focusedId = focusedId === id ? null : id;
    updateExplorer();
    rerender();
  }

  function onEdgeClick(from, to) {
    const detail = document.getElementById('edge-detail');
    detail.innerHTML = `<strong>Edge: ${from} → ${to}</strong><br/><em>Class-level inspection available in the IDE plugin.</em>`;
  }

  // ── Explorer panel ─────────────────────────────────────────────────────────
  let explorerMode = 'type';

  function updateExplorer() {
    const list = document.getElementById('explorer-list');
    const filterVal = document.getElementById('explorer-filter').value.toLowerCase();
    const filtered = data.modules.filter(m => m.id.toLowerCase().includes(filterVal));
    list.innerHTML = '';

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
        const key = parts.length > 1 ? parts[0] : '_root';
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

    const zoom = d3.zoom()
      .scaleExtent([0.05, 4])
      .on('zoom', event => content.attr('transform', event.transform));

    svg.call(zoom).on('dblclick.zoom', null);

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
      rerender();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      focusedId = null;
      updateExplorer();
      rerender();
    });
    document.getElementById('btn-fit').addEventListener('click', () => {
      const { width: svgW, height: svgH } = document.getElementById('graph-svg').getBoundingClientRect();
      const positions = Object.values(nodePos);
      if (positions.length === 0) return;
      const hw = NODE_W / 2, hh = NODE_H / 2;
      const minX = Math.min(...positions.map(p => p.x)) - hw;
      const maxX = Math.max(...positions.map(p => p.x)) + hw;
      const minY = Math.min(...positions.map(p => p.y)) - hh;
      const maxY = Math.max(...positions.map(p => p.y)) + hh;
      const pad = 40;
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
