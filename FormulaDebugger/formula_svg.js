import FormulaEngine from './formula_engine.js';

const DEFAULTS = {
  horizontalSpacing: 56,
  verticalSpacing: 64,
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
  const levelHeights = [];
  let nextX = 0;
  let minX = Infinity;
  let maxX = -Infinity;

  const layout = (node, depth = 0) => {
    if (!node) return null;

    const children = getChildren(node)
      .map(child => layout(child, depth + 1))
      .filter(Boolean);
    const info = computeNodeInfo(node, settings);

    let x;
    if (children.length === 0) {
      x = nextX + info.width / 2;
      nextX += info.width + settings.horizontalSpacing;
    } else {
      const first = children[0];
      const last = children[children.length - 1];
      x = (first.x + last.x) / 2;
    }

    const item = { node, children, info, depth, x };
    layoutNodes.push(item);

    minX = Math.min(minX, x - info.width / 2);
    maxX = Math.max(maxX, x + info.width / 2);
    levelHeights[depth] = Math.max(levelHeights[depth] || 0, info.height);

    return item;
  };

  const root = layout(ast, 0);
  if (!root || !layoutNodes.length) throw new Error('Unable to layout AST');

  // Convert per-depth heights into cumulative offsets.
  const levelOffsets = [];
  let accumulated = 0;
  for (let i = 0; i < levelHeights.length; i++) {
    levelOffsets[i] = accumulated;
    accumulated += levelHeights[i] + settings.verticalSpacing;
  }
  if (levelHeights.length > 0) {
    accumulated -= settings.verticalSpacing; // remove final extra spacing
  }

  const contentWidth = Math.max(0, maxX - minX);
  const contentHeight = Math.max(0, accumulated);
  const svgWidth = Math.ceil(contentWidth + paddingX * 2);
  const svgHeight = Math.ceil(contentHeight + paddingY * 2);
  const offsetX = paddingX - minX;
  const offsetY = paddingY;

  // Assign y positions now that level offsets are known.
  for (const item of layoutNodes) {
    item.y = levelOffsets[item.depth] ?? 0;
  }

  const edges = [];
  for (const item of layoutNodes) {
    const baseX = item.x + offsetX;
    const top = item.y + offsetY;
    const bottom = top + item.info.height;
    for (const child of item.children) {
      const childX = child.x + offsetX;
      const childTop = (child.y ?? 0) + offsetY;
      edges.push({
        x1: baseX,
        y1: bottom,
        x2: childX,
        y2: childTop,
      });
    }
  }

  const nodeElements = layoutNodes.map(item => {
    const top = item.y + offsetY;
    const left = item.x + offsetX - item.info.width / 2;
    const centerX = item.x + offsetX;

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
    const midY = (edge.y1 + edge.y2) / 2;
    return `<path d="M ${edge.x1} ${edge.y1} C ${edge.x1} ${midY}, ${edge.x2} ${midY}, ${edge.x2} ${edge.y2}" fill="none" stroke="#94a3b8" stroke-width="1.5" />`;
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
    header button, header a { appearance: none; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; cursor: pointer; text-decoration: none; }
    header button { background: #3b82f6; color: white; }
    header a { background: #1f2937; color: #f9fafb; border: 1px solid #374151; }
    main { overflow: auto; height: calc(100vh - 48px); background: #f9fafb; }
    main svg { display: block; margin: 0 auto; }
  </style>
</head>
<body>
  <header>
    <button id="downloadBtn">Download SVG</button>
    <a id="rawBtn" href="${url}" target="_blank" rel="noopener">Open Raw SVG</a>
    <span>Size: ${Math.ceil(width)} × ${Math.ceil(height)} px</span>
  </header>
  <main>
    ${svg}
  </main>
  <script>
    (function() {
      const downloadBtn = document.getElementById('downloadBtn');
      const objectUrl = '${url}';
      downloadBtn.addEventListener('click', function() {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'formula-diagram.svg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
      window.addEventListener('unload', function() { URL.revokeObjectURL(objectUrl); });
    })();
  </script>
</body>
</html>`);
  win.document.close();

  return { svg, width, height };
}
