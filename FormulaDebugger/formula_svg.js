import FormulaEngine from './formula_engine.js';

const DEFAULTS = {
  horizontalSpacing: 72,
  verticalSpacing: 48,
  paddingX: 48,
  paddingY: 48,
  cornerRadius: 12,
  fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 14,
  lineHeight: 18,
  charWidth: 7.2,
  textPaddingX: 18,
  textPaddingTop: 20,
  textPaddingBottom: 20,
  minNodeWidth: 160,
  minNodeHeight: 72,
  maxLineCharacters: Infinity,
  maxNodeWidthFactor: 2.5,
};

function resolveSpacing(settings, key, fallback) {
  if (settings[key] != null) return settings[key];
  if (settings.padding != null) return settings.padding;
  return fallback;
}

function getChildren(node) {
  if (!node) return [];
  if (node.type === 'Function') return [...(node.arguments || [])];
  if (node.type === 'Operator') return [node.left, node.right].filter(Boolean);
  return [];
}

function formatLabelLines(node) {
  if (!node) return ['(empty)'];
  const typeLine = `Type: ${node.resultType || 'Unknown'}`;
  switch (node.type) {
    case 'Function': {
      const expr = safeExpression(node);
      return [`Function: ${node.name || '(anonymous)'}`, expr, typeLine];
    }
    case 'Operator': {
      const expr = safeExpression(node);
      return [`Operator: ${node.operator || '?'}`, expr, typeLine];
    }
    case 'Field':
      return [`Field: ${node.name}`, typeLine];
    case 'Literal':
      return ['Literal', `Value: ${stringifyLiteral(node.value)}`, typeLine];
    default:
      return [safeExpression(node), typeLine];
  }
}

function safeExpression(node) {
  try {
    return FormulaEngine.rebuild(node);
  } catch (_) {
    return '[unrenderable]';
  }
}

function stringifyLiteral(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return value.length > 64 ? `${value.slice(0, 61)}…` : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value % 1 === 0 ? String(value) : value.toFixed(6);
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function wrapLines(lines, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return lines.map(line => String(line ?? '').trim());
  }

  const wrapped = [];
  for (const raw of lines) {
    const text = String(raw ?? '').trim();
    if (!text) {
      wrapped.push('');
      continue;
    }
    if (text.length <= maxChars) {
      wrapped.push(text);
      continue;
    }

    const tokens = text.split(/\s+/);
    let current = '';
    for (const token of tokens) {
      const tentative = current ? `${current} ${token}` : token;
      if (tentative.length <= maxChars) {
        current = tentative;
      } else {
        if (current) wrapped.push(current);
        if (token.length > maxChars) {
          wrapped.push(token.slice(0, maxChars - 1) + '…');
          current = '';
        } else {
          current = token;
        }
      }
    }
    if (current) wrapped.push(current);
  }
  return wrapped.length ? wrapped : [''];
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function computeNodeInfo(node, settings) {
  if (!node) {
    return {
      lines: ['(empty)'],
      width: settings.minNodeWidth,
      height: settings.minNodeHeight,
    };
  }

  const maxNodeWidth = Math.ceil(
    settings.maxNodeWidth != null
      ? settings.maxNodeWidth
      : settings.minNodeWidth * (settings.maxNodeWidthFactor || 1)
  );

  const effectiveMaxWidth = Math.max(settings.minNodeWidth, maxNodeWidth);
  const availableTextWidth = Math.max(
    1,
    effectiveMaxWidth - settings.textPaddingX * 2
  );

  const baseLines = formatLabelLines(node);
  const widthBasedChars = Math.max(
    1,
    Math.floor(availableTextWidth / settings.charWidth)
  );
  const maxChars = Number.isFinite(settings.maxLineCharacters)
    ? Math.min(widthBasedChars, settings.maxLineCharacters)
    : widthBasedChars;

  const lines = wrapLines(baseLines, maxChars).filter(Boolean);
  if (lines.length === 0) lines.push('');

  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const textWidth = longest * settings.charWidth;
  const unclampedWidth = Math.ceil(textWidth + settings.textPaddingX * 2);
  const width = Math.min(
    effectiveMaxWidth,
    Math.max(settings.minNodeWidth, unclampedWidth)
  );

  const textBlockHeight = lines.length
    ? settings.fontSize + (lines.length - 1) * settings.lineHeight
    : 0;
  const height = Math.max(
    settings.minNodeHeight,
    Math.ceil(settings.textPaddingTop + settings.textPaddingBottom + textBlockHeight)
  );

  return { lines, width, height };
}

export function generateSvgDiagram(ast, options = {}) {
  if (!ast) throw new Error('AST is required to generate SVG');

  const settings = { ...DEFAULTS, ...options };
  const paddingX = resolveSpacing(settings, 'paddingX', 32);
  const paddingY = resolveSpacing(settings, 'paddingY', 32);

  const layoutNodes = [];
  const columnWidths = [];
  let nextY = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  const layout = (node, depth = 0) => {
    if (!node) return null;

    const children = getChildren(node)
      .map(child => layout(child, depth + 1))
      .filter(Boolean);
    const info = computeNodeInfo(node, settings);

    let y;
    if (children.length === 0) {
      y = nextY + info.height / 2;
      nextY += info.height + settings.verticalSpacing;
    } else {
      const first = children[0];
      const last = children[children.length - 1];
      y = (first.y + last.y) / 2;
    }

    const item = { node, children, info, depth, y };
    layoutNodes.push(item);

    minY = Math.min(minY, y - info.height / 2);
    maxY = Math.max(maxY, y + info.height / 2);
    columnWidths[depth] = Math.max(columnWidths[depth] || 0, info.width);

    return item;
  };

  const root = layout(ast, 0);
  if (!root || !layoutNodes.length) throw new Error('Unable to layout AST');

  // Convert per-depth widths into cumulative offsets for left-to-right layout.
  const columnOffsets = [];
  let accumulatedWidth = 0;
  for (let i = 0; i < columnWidths.length; i++) {
    columnOffsets[i] = accumulatedWidth;
    accumulatedWidth += columnWidths[i] + settings.horizontalSpacing;
  }
  if (columnWidths.length > 0) {
    accumulatedWidth -= settings.horizontalSpacing; // remove trailing spacing
  }

  const contentWidth = Math.max(0, accumulatedWidth);
  const contentHeight = Math.max(0, maxY - minY);
  const svgWidth = Math.ceil(contentWidth + paddingX * 2);
  const svgHeight = Math.ceil(contentHeight + paddingY * 2);
  const offsetX = paddingX;
  const offsetY = paddingY - minY;

  // Assign x positions from column offsets now that widths are known.
  for (const item of layoutNodes) {
    const columnOffset = columnOffsets[item.depth] ?? 0;
    item.x = columnOffset + item.info.width / 2;
  }

  const edges = [];
  for (const item of layoutNodes) {
    const centerX = item.x + offsetX;
    const centerY = item.y + offsetY;
    const rightX = centerX + item.info.width / 2;
    for (const child of item.children) {
      const childCenterX = child.x + offsetX;
      const childCenterY = child.y + offsetY;
      const leftX = childCenterX - child.info.width / 2;
      edges.push({
        x1: rightX,
        y1: centerY,
        x2: leftX,
        y2: childCenterY,
      });
    }
  }

  const nodeElements = layoutNodes.map(item => {
    const centerX = item.x + offsetX;
    const centerY = item.y + offsetY;
    const top = centerY - item.info.height / 2;
    const left = centerX - item.info.width / 2;

    const textLines = item.info.lines.map((line, idx) => {
      const baseline = top + settings.textPaddingTop + settings.fontSize + idx * settings.lineHeight;
      return `<tspan x="${centerX}" y="${baseline}">${escapeXml(line)}</tspan>`;
    }).join('');

    return `
      <g>
        <rect x="${left}" y="${top}" rx="${settings.cornerRadius}" ry="${settings.cornerRadius}" width="${item.info.width}" height="${item.info.height}" fill="#f9fafb" stroke="#d0d7de" stroke-width="1.5" />
        <text font-family="${escapeXml(settings.fontFamily)}" font-size="${settings.fontSize}" text-anchor="middle" fill="#1f2933">${textLines}</text>
      </g>`;
  }).join('\n');

  const edgeElements = edges.map(edge => {
    const midX = (edge.x1 + edge.x2) / 2;
    return `<path d="M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}" fill="none" stroke="#94a3b8" stroke-width="1.5" />`;
  }).join('\n');

  const svgParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background:#ffffff;width:100%;height:100%;">`,
    '<defs>',
    '<style>text { font-family: ' + escapeXml(settings.fontFamily) + '; }</style>',
    '</defs>',
    edgeElements,
    nodeElements,
    '</svg>'
  ];

  const svg = svgParts.join('\n');
  return { svg, width: svgWidth, height: svgHeight, nodes: layoutNodes };
}

export function openSvgDiagram(ast, options = {}) {
  const { svg, width, height } = generateSvgDiagram(ast, options);

  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    console.log(svg);
    return { svg, width, height };
  }

  const win = window.open('', '_blank');
  if (!win) {
    console.warn('Popup was blocked; SVG output follows:\n', svg);
    return { svg, width, height };
  }

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    win.opener = null; // guard against reverse tabnabbing
  } catch (_) {}

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Formula Diagram (SVG)</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #111827; color: #f9fafb; }
    header { padding: 12px 16px; display: flex; gap: 12px; align-items: center; background: rgba(17, 24, 39, 0.92); }
    header button, header a, header input[type="range"] {
      appearance: none;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    header button, header a { padding: 8px 12px; text-decoration: none; }
    header button { background: #3b82f6; color: white; }
    header a { background: #1f2937; color: #f9fafb; border: 1px solid #374151; }
    header label { display: flex; align-items: center; gap: 8px; color: #d1d5db; font-size: 13px; }
    header input[type="range"] {
      width: 140px;
      background: transparent;
    }
    main { height: calc(100vh - 48px); background: #0f172a; padding: 16px; box-sizing: border-box; }
    #viewport { width: 100%; height: 100%; background: #f9fafb; border-radius: 8px; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.08); overflow: auto; }
    #canvas { transform-origin: top left; }
    #canvas svg { display: block; }
  </style>
</head>
<body>
  <header>
    <button id="downloadBtn">Download SVG</button>
    <a id="rawBtn" href="${url}" target="_blank" rel="noopener">Open Raw SVG</a>
    <label>Zoom <input id="zoomSlider" type="range" min="0.25" max="2.5" step="0.05" value="1" /> <span id="zoomLabel">100%</span></label>
    <span>Size: ${Math.ceil(width)} × ${Math.ceil(height)} px</span>
  </header>
  <main>
    <div id="viewport">
      <div id="canvas">
        ${svg}
      </div>
    </div>
  </main>
  <script>
    (function() {
      const downloadBtn = document.getElementById('downloadBtn');
      const zoomSlider = document.getElementById('zoomSlider');
      const zoomLabel = document.getElementById('zoomLabel');
      const canvas = document.getElementById('canvas');
      const objectUrl = '${url}';

      function applyZoom(value) {
        const factor = Math.max(0.1, parseFloat(value) || 1);
        canvas.style.transform = 'scale(' + factor + ')';
        zoomLabel.textContent = Math.round(factor * 100) + '%';
      }

      downloadBtn.addEventListener('click', function() {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'formula-diagram.svg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });

      zoomSlider.addEventListener('input', function() {
        applyZoom(this.value);
      });

      applyZoom(zoomSlider.value);

      window.addEventListener('unload', function() { URL.revokeObjectURL(objectUrl); });
    })();
  </script>
</body>
</html>`);
  win.document.close();

  return { svg, width, height };
}
