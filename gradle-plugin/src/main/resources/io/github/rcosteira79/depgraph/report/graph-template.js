(function () {
  const data = window.__GRAPH_DATA__;
  if (!data) { document.body.innerHTML = '<p style="color:red">No graph data found.</p>'; return; }

  // ── Constants ──────────────────────────────────────────────────────────────
  const NODE_W = 140, NODE_H = 32, GAP = 8, FOCUS_GAP = 10;
  const LAYER_ORDER = ['app', 'feature', 'core', 'data', 'unknown'];
  const NODE_COLORS = { app:'#7b1212', feature:'#0d3461', core:'#2d0d5e', data:'#0d3318', unknown:'#2a2a2a' };
  const NODE_BORDERS = { app:'#c62828', feature:'#1565c0', core:'#6a1fc2', data:'#2e7d32', unknown:'#555' };

  let focusedId = null;
  let depthValue = 2;

  // Mutable node positions — initialised from dagre, updated by drag
  const nodePos = {};

  // ── Layout (dagre) ─────────────────────────────────────────────────────────
  function computeLayout(modules, edges) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 80, marginy: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    modules.forEach(m => g.setNode(m.id, { width: NODE_W, height: NODE_H, label: m.id }));
    edges.forEach(e => g.setEdge(e.from, e.to));
    dagre.layout(g);
    // Store positions — only initialise; drag updates them in place
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
          if (e.from === id && !visible.has(e.to)) { visible.add(e.to); next.add(e.to); }
          if (e.to === id && !visible.has(e.from)) { visible.add(e.from); next.add(e.from); }
        });
      });
      frontier = next;
    }
    return visible;
  }

  // ── Edge endpoint (border intersection, pulled back by gap) ───────────────
  function edgeEndpoint(cx1, cy1, cx2, cy2, hw, hh, gap) {
    const dx = cx2 - cx1, dy = cy2 - cy1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [cx1, cy1];
    const ratio = Math.abs(dy / dx);
    const threshold = hh / hw;
    let bx, by;
    if (ratio <= threshold) {
      const sx = dx > 0 ? hw : -hw;
      bx = cx1 + sx;
      by = cy1 + dy * Math.abs(sx) / Math.abs(dx);
    } else {
      const sy = dy > 0 ? hh : -hh;
      by = cy1 + sy;
      bx = cx1 + dx * Math.abs(sy) / Math.abs(dy);
    }
    const ux = dx / len, uy = dy / len;
    return [bx + ux * gap, by + uy * gap];
  }

  // ── Draw edges ─────────────────────────────────────────────────────────────
  function drawEdges(visibleIds) {
    const { edges } = data;
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const edgeGroup = document.getElementById('edges');
    edgeGroup.innerHTML = '';
    edges.forEach(e => {
      const sp = nodePos[e.from], tp = nodePos[e.to];
      if (!sp || !tp) return;
      const isFocusedEdge = focusedId && (e.from === focusedId || e.to === focusedId);
      const isVisible = !focusedId || (visibleIds.has(e.from) && visibleIds.has(e.to));
      const srcGap = e.from === focusedId ? FOCUS_GAP : GAP;
      const tgtGap = e.to === focusedId ? FOCUS_GAP : GAP;
      const [x1, y1] = edgeEndpoint(sp.x, sp.y, tp.x, tp.y, hw, hh, srcGap);
      const [x2, y2] = edgeEndpoint(tp.x, tp.y, sp.x, sp.y, hw, hh, tgtGap);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', isFocusedEdge ? '#f5a623' : 'rgba(255,255,255,0.3)');
      line.setAttribute('stroke-width', isFocusedEdge ? '2' : '1.2');
      line.setAttribute('opacity', isVisible ? '1' : '0.08');
      line.setAttribute('marker-end', isFocusedEdge ? 'url(#arrow-lit)' : 'url(#arrow-rel)');
      line.dataset.from = e.from; line.dataset.to = e.to;
      line.style.cursor = 'pointer';
      line.addEventListener('click', () => onEdgeClick(e.from, e.to));
      edgeGroup.appendChild(line);
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
      const isDim = focusedId && !visibleIds.has(m.id);
      const color = NODE_COLORS[m.type] || NODE_COLORS.unknown;
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
          // Redraw edges live; nodes stay in place via their transforms
          drawEdges(getVisibleIds(focusedId, depthValue, data.modules, data.edges));
        })
        .on('end', function () {
          if (!dragMoved) onNodeClick(m.id);
        });

      d3.select(g).call(drag).style('cursor', 'grab');
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // Full render: recompute dagre layout then draw
  function render() {
    const { modules, edges } = data;
    computeLayout(modules, edges);
    const visibleIds = getVisibleIds(focusedId, depthValue, modules, edges);
    drawEdges(visibleIds);
    drawNodes(visibleIds);
  }

  // Rerender: draw using current nodePos (preserves drag positions)
  function rerender() {
    const { modules, edges } = data;
    const visibleIds = getVisibleIds(focusedId, depthValue, modules, edges);
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
  let explorerMode = 'type'; // 'type' | 'path'

  function updateExplorer() {
    const list = document.getElementById('explorer-list');
    const filterVal = document.getElementById('explorer-filter').value.toLowerCase();
    const { modules } = data;
    const filtered = modules.filter(m => m.id.toLowerCase().includes(filterVal));
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
      // path hierarchy — group by first path segment
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
    // Pan/zoom: D3 zoom on the SVG, transform applied to #graph-content
    const svg = d3.select('#graph-svg');
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

    // Auto-fit after initial render
    setTimeout(() => document.getElementById('btn-fit').click(), 50);
  });
})();
