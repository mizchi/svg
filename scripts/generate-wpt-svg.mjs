#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wptRoot = path.join(repoRoot, 'wpt');
const svgRoot = path.join(wptRoot, 'svg');
const outDir = path.join(repoRoot, 'src', 'cmd', 'wpt-svg');
const outPath = path.join(outDir, 'wpt_cases.mbt');

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const patternArg = args.find((a) => a.startsWith('--pattern='));
const scopesArg = args.find((a) => a.startsWith('--scopes='));
const skipArg = args.find((a) => a.startsWith('--skip='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
const pattern = patternArg ? patternArg.split('=')[1] : null;
const scopes = scopesArg
  ? scopesArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  : ['embedded', 'painting', 'pservers', 'struct', 'styling', 'coordinate-systems'];
const allowedPrefixes = scopes.map((s) => (s.endsWith('/') ? s : `${s}/`));
const skipPatterns = skipArg
  ? skipArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  : [
      'paint-context',
      'viewref',
      'use-same-origin',
      'nested-svg-through-display-contents',
      'pattern-text',
      'nested-svg-sizing',
      'marker-003',
      'marker-005',
      'marker-008',
      'markers-orient-002',
      'marker-external-reference',
      'marker-path-001',
      'marker-path-011',
      'marker-units',
      'paint-order-002',
    ];

if (!fs.existsSync(svgRoot)) {
  console.error('[wpt-svg] Missing WPT submodule. Run: git submodule update --init --depth 1 wpt');
  process.exit(1);
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function isStaticSvg(content) {
  const lower = content.toLowerCase();
  const skipPatterns = [
    '<script',
    '<style',
    'onload=',
    'onbegin=',
    'onend=',
    'onrepeat=',
    '<foreignobject',
    '<animate',
    '<animatemotion',
    '<animatetransform',
    '<set',
  ];
  for (const pat of skipPatterns) {
    if (lower.includes(pat)) return false;
  }
  const withoutLinks = lower.replace(/<(?:\w+:)?link\b[^>]*>/g, '');
  if (withoutLinks.includes('href="http') || withoutLinks.includes("href='http")) return false;
  if (withoutLinks.includes('xlink:href="http') || withoutLinks.includes("xlink:href='http")) return false;
  return true;
}

function parseSvgSize(content) {
  const svgTag = content.match(/<svg\b[^>]*>/i);
  if (!svgTag) return null;
  const tag = svgTag[0];
  const attr = (name) => {
    const re = new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const m = tag.match(re);
    if (!m) return null;
    let v = m[1];
    if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1, -1);
    return v;
  };
  const widthRaw = attr('width');
  const heightRaw = attr('height');
  const viewBoxRaw = attr('viewbox');
  const parseLen = (v) => {
    if (!v) return null;
    const m = v.match(/^[0-9.]+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  };
  let width = parseLen(widthRaw);
  let height = parseLen(heightRaw);
  if ((width === null || height === null) && viewBoxRaw) {
    const parts = viewBoxRaw.trim().split(/[\s,]+/).map((p) => Number(p));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      if (width === null) width = parts[2];
      if (height === null) height = parts[3];
    }
  }
  if (width === null && height !== null) width = height;
  if (height === null && width !== null) height = width;
  if (width === null || height === null) return null;
  return { width, height };
}

function clampSize(size) {
  const max = 512;
  const min = 1;
  const w = Math.max(min, Math.min(max, Math.round(size.width)));
  const h = Math.max(min, Math.min(max, Math.round(size.height)));
  return { width: w, height: h };
}

function resolveHref(baseFile, href) {
  if (!href) return null;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('http:') || clean.startsWith('https:')) return null;
  if (clean.startsWith('/')) {
    return path.join(wptRoot, clean);
  }
  return path.resolve(path.dirname(baseFile), clean);
}

function extractMatches(svgContent) {
  const matches = [];
  const re = /<(?:\w+:)?link\b[^>]*\brel\s*=\s*("match"|'match'|match)[^>]*\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi;
  let m;
  while ((m = re.exec(svgContent)) !== null) {
    let href = m[2];
    if (href.startsWith('"') || href.startsWith("'")) href = href.slice(1, -1);
    matches.push(href);
  }
  return matches;
}

function extractSvgInner(content) {
  const m = content.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!m) return null;
  return m[1].trim();
}

function extractFuzzy(content) {
  const metaRe =
    /<(?:\w+:)?meta\b[^>]*\bname\s*=\s*("fuzzy"|'fuzzy'|fuzzy)[^>]*>/gi;
  const match = metaRe.exec(content);
  if (!match) return null;
  const tag = match[0];
  const contentMatch = tag.match(
    /\bcontent\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/i,
  );
  if (!contentMatch) return null;
  let raw = contentMatch[2] ?? contentMatch[3] ?? contentMatch[1] ?? '';
  if (raw.startsWith('"') || raw.startsWith("'")) raw = raw.slice(1, -1);
  const parts = raw
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let maxDiff = null;
  let maxPixels = null;
  for (const part of parts) {
    const [keyRaw, valueRaw] = part.includes('=')
      ? part.split('=')
      : [null, part];
    const value = valueRaw.trim();
    const range = value.split('-').map((v) => v.trim());
    const upper = Number(range[range.length - 1]);
    if (!Number.isFinite(upper)) continue;
    const key = keyRaw ? keyRaw.trim().toLowerCase() : '';
    if (key === 'maxdifference' || (!key && maxDiff === null)) {
      maxDiff = upper;
    } else if (key === 'totalpixels' || (!key && maxPixels === null)) {
      maxPixels = upper;
    }
  }
  if (maxDiff == null && maxPixels == null) return null;
  return { maxDiff, maxPixels };
}

function extractExternalSvgRefs(content, baseFile) {
  const refs = new Map();
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[2].trim();
    const hashIndex = raw.indexOf('#');
    if (hashIndex < 0) continue;
    const pathPart = raw.slice(0, hashIndex);
    if (!pathPart || !pathPart.endsWith('.svg')) continue;
    const resolved = resolveHref(baseFile, pathPart);
    if (!resolved) continue;
    refs.set(resolved, true);
  }
  return [...refs.keys()];
}

function rewriteExternalUrls(content, baseFile, externalFiles) {
  if (externalFiles.length === 0) return content;
  const externalSet = new Set(externalFiles.map((f) => path.resolve(f)));
  return content.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, _q, url) => {
    const raw = url.trim();
    const hashIndex = raw.indexOf('#');
    if (hashIndex < 0) return m;
    const pathPart = raw.slice(0, hashIndex);
    const frag = raw.slice(hashIndex + 1);
    if (!pathPart || !pathPart.endsWith('.svg')) return m;
    const resolved = resolveHref(baseFile, pathPart);
    if (!resolved || !externalSet.has(path.resolve(resolved))) return m;
    return `url(#${frag})`;
  });
}

function injectDefs(content, defs) {
  if (!defs || defs.length === 0) return content;
  const m = content.match(/<svg\b[^>]*>/i);
  if (!m || m.index == null) return content;
  const insertAt = m.index + m[0].length;
  const injection = `\n<defs>\n${defs}\n</defs>`;
  return content.slice(0, insertAt) + injection + content.slice(insertAt);
}

function inlineExternalResources(content, baseFile) {
  const externalFiles = extractExternalSvgRefs(content, baseFile);
  if (externalFiles.length === 0) return content;
  const defs = [];
  for (const file of externalFiles) {
    if (!fs.existsSync(file)) continue;
    const extContent = readText(file);
    if (!isStaticSvg(extContent)) continue;
    const inner = extractSvgInner(extContent);
    if (!inner) continue;
    defs.push(inner);
  }
  if (defs.length === 0) return content;
  const rewritten = rewriteExternalUrls(content, baseFile, externalFiles);
  return injectDefs(rewritten, defs.join('\n'));
}

const svgFiles = [];
walk(svgRoot, svgFiles);
svgFiles.sort();
const cases = [];
const skipped = [];

for (const file of svgFiles) {
  if (!file.endsWith('.svg')) continue;
  const rel = path.relative(svgRoot, file);
  if (!allowedPrefixes.some((prefix) => rel.startsWith(prefix))) continue;
  if (pattern && !rel.includes(pattern)) continue;
  if (skipPatterns.some((pat) => rel.includes(pat))) {
    skipped.push({ file: rel, reason: 'skip-pattern' });
    continue;
  }
  const content = readText(file);
  const testContent = inlineExternalResources(content, file);
  const hrefs = extractMatches(content);
  if (hrefs.length === 0) continue;
  if (!isStaticSvg(testContent)) {
    skipped.push({ file: rel, reason: 'non-static' });
    continue;
  }
  for (const href of hrefs) {
    const refPath = resolveHref(file, href);
    if (!refPath || !refPath.endsWith('.svg')) {
      skipped.push({ file: rel, reason: 'non-svg-ref' });
      continue;
    }
    if (!fs.existsSync(refPath)) {
      skipped.push({ file: rel, reason: 'missing-ref' });
      continue;
    }
    const rawRefContent = readText(refPath);
    const refContent = inlineExternalResources(rawRefContent, refPath);
    if (!isStaticSvg(refContent)) {
      skipped.push({ file: rel, reason: 'ref-non-static' });
      continue;
    }
    const size =
      parseSvgSize(testContent) || parseSvgSize(refContent) || { width: 300, height: 150 };
    const fuzzy = extractFuzzy(testContent) || extractFuzzy(refContent);
    const maxDiff = fuzzy?.maxDiff ?? -1;
    const maxPixels = fuzzy?.maxPixels ?? -1;
    const clamped = clampSize(size);
    cases.push({
      testPath: file,
      refPath,
      rel,
      width: clamped.width,
      height: clamped.height,
      testContent,
      refContent,
      maxDiff,
      maxPixels,
    });
    if (limit !== null && cases.length >= limit) break;
  }
  if (limit !== null && cases.length >= limit) break;
}

function toRawString(value, indent) {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const prefix = ' '.repeat(indent);
  return lines.map((line) => `${prefix}#|${line}`).join('\n');
}

function escapeString(value) {
  return JSON.stringify(value);
}

const header = [
  '///|',
  '/// Generated from WPT SVG reftests (static only)',
  '/// Run: node scripts/generate-wpt-svg.mjs',
  '',
  '///|',
  'struct WptCase {',
  '  name : String',
  '  test_svg : String',
  '  ref_svg : String',
  '  width : Int',
  '  height : Int',
  '  max_diff : Int',
  '  max_pixels : Int',
  '}',
  '',
  '///|',
  'fn wpt_svg_cases() -> Array[WptCase] {',
  '  [',
].join('\n');

const body = cases
  .map((c) => {
    return [
      '    case(',
      `      ${escapeString(c.rel)},`,
      '      (',
      toRawString(c.testContent, 6),
      '      ),',
      '      (',
      toRawString(c.refContent, 6),
      '      ),',
      `      ${c.width},`,
      `      ${c.height},`,
      `      ${c.maxDiff},`,
      `      ${c.maxPixels},`,
      '    ),',
    ].join('\n');
  })
  .join('\n');

const footer = [
  '  ]',
  '}',
  '',
  '///|',
  'fn case(',
  '  name : String,',
  '  test_svg : String,',
  '  ref_svg : String,',
  '  width : Int,',
  '  height : Int,',
  '  max_diff : Int,',
  '  max_pixels : Int,',
  ') -> WptCase {',
  '  { name, test_svg, ref_svg, width, height, max_diff, max_pixels }',
  '}',
  '',
].join('\n');

const output = header + (body ? '\n' + body + '\n' : '\n') + footer;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');

console.log(`[wpt-svg] Generated ${cases.length} tests -> ${path.relative(repoRoot, outPath)}`);
console.log(`[wpt-svg] Skipped: ${skipped.length}`);
