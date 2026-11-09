"use strict";

/* ---------------- state ---------------- */
const $ = id => document.getElementById(id);
const GB_SHA = "9469f09";
const state = {
  iso: null,
  adm: "ADM1",
  geo: null,
  layer: null,
  labelLayer: null,
  dataMap: null,       // normalized name -> number
  matched: 0,
  values: [],
  breaks: null,
  basemap: null,
};

const map = L.map("map", { attributionControl: true }).setView([20, 10], 2);
L.control.attribution({ prefix: false }).addTo(map).addAttribution("Boundaries: <a href='https://www.geoboundaries.org' target='_blank'>geoBoundaries</a> (CC BY 4.0)");

/* ---------------- helpers ---------------- */
function normName(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}
function fmt(v) {
  if (!isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e4) return (v / 1e3).toFixed(0) + "k";
  return Number(v.toFixed(2)).toString();
}
function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  const c = x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const seg = Math.min(n - 1, Math.floor(t * n));
  const lt = t * n - seg;
  const a = hexToRgb(stops[seg]), b = hexToRgb(stops[seg + 1]);
  return rgbToHex(a[0] + (b[0] - a[0]) * lt, a[1] + (b[1] - a[1]) * lt, a[2] + (b[2] - a[2]) * lt);
}
const PALETTES = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  blues:   ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  greens:  ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"],
  orrd:    ["#fff7ec", "#fee8c8", "#fdbb84", "#e34a33", "#7f0000"],
  ryb:     ["#d7191c", "#fdae61", "#ffffbf", "#abd9e9", "#2c7bb6"],
};
function paletteStops() {
  if ($("palette").value === "custom") return [$("cMin").value, $("cMax").value];
  return PALETTES[$("palette").value] || PALETTES.viridis;
}
function classColors() {
  const k = Math.max(2, Math.min(9, +$("classes").value || 5));
  const stops = paletteStops();
  return Array.from({ length: k }, (_, i) => rampColor(stops, k === 1 ? 0 : i / (k - 1)));
}
function computeBreaks(values, k, method) {
  if (!values.length || method === "continuous") return null;
  const v = [...values].sort((a, b) => a - b);
  if (method === "equal") {
    const min = v[0], max = v[v.length - 1];
    return Array.from({ length: k - 1 }, (_, i) => min + (max - min) * (i + 1) / k);
  }
  const breaks = [];
  for (let i = 1; i < k; i++) {
    const q = v[Math.min(v.length - 1, Math.floor(v.length * i / k))];
    if (!breaks.length || breaks[breaks.length - 1] !== q) breaks.push(q);
  }
  return breaks;
}
function featureValue(props) {
  if (!state.dataMap) return undefined;
  const key = normName(props.shapeName);
  return Object.prototype.hasOwnProperty.call(state.dataMap, key) ? state.dataMap[key] : undefined;
}
function colorFor(value) {
  if (value === undefined || !isFinite(value)) return $("noDataColor").value;
  const stops = paletteStops();
  const values = state.values;
  if (!values.length) return rampColor(stops, 0);
  const min = Math.min(...values), max = Math.max(...values);
  if (state.breaks === null) return rampColor(stops, max === min ? 1 : (value - min) / (max - min));
  const cols = classColors();
  for (let i = 0; i < state.breaks.length; i++) if (value <= state.breaks[i]) return cols[i];
  return cols[cols.length - 1];
}

/* ---------------- boundary loading ---------------- */
async function fetchGeoJSON(iso, adm) {
  const file = `geoBoundaries-${iso}-${adm}_simplified.geojson`;
  const dir = `https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${GB_SHA}/releaseData/gbOpen/${iso}/${adm}`;
  const candidates = [];
  try {
    const meta = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`).then(r => { if (!r.ok) throw 0; return r.json(); });
    if (meta && meta.simplifiedGeometryGeoJSON) candidates.push(meta.simplifiedGeometryGeoJSON);
  } catch (e) { /* API unreachable — fall through to pinned URLs */ }
  candidates.push(`${dir}/${file}`);
  candidates.push(dir.replace("raw.githubusercontent.com", "media.githubusercontent.com/media") + "/" + file);
  candidates.push(`https://github.com/wmgeolab/geoBoundaries/raw/${GB_SHA}/releaseData/gbOpen/${iso}/${adm}/${file}`);
  for (const url of candidates) {
    try {
      const txt = await fetch(url).then(r => { if (!r.ok) throw 0; return r.text(); });
      const t = txt.trimStart();
      if (!t.startsWith("{") && !t.startsWith("[")) continue; // LFS pointer / HTML
      const gj = JSON.parse(t);
      if (gj && gj.features && gj.features.length) return gj;
    } catch (e) { /* try next candidate */ }
  }
  throw new Error("not available");
}

async function loadBoundary() {
  const iso = $("country").value;
  const adm = $("adm").value;
  if (!iso) return;
  state.iso = iso; state.adm = adm;
  $("loading").classList.remove("hidden");
  setBoundaryStatus("Loading " + iso + " " + adm + "…");
  try {
    const gj = await fetchGeoJSON(iso, adm);
    state.geo = gj;
    applyData(true);
    const b = L.geoJSON(gj).getBounds();
    map.fitBounds(b, { padding: [20, 20] });
    setBoundaryStatus(`${gj.features.length} units · ${COUNTRIES[iso]} ${adm.replace("ADM", "level ")}`, "ok");
  } catch (e) {
    state.geo = null;
    setBoundaryStatus(`${adm} boundaries unavailable for ${COUNTRIES[iso]} — try another level.`, "err");
  } finally {
    $("loading").classList.add("hidden");
  }
}
function setBoundaryStatus(txt, cls) {
  const el = $("boundaryStatus");
  el.textContent = txt;
  el.className = "status " + (cls || "");
}

/* ---------------- data ---------------- */
function parseCSV(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*"?([^",]+?)"?\s*,\s*(-?[\d.,]+)\s*$/);
    if (!m) continue;
    const key = normName(m[1]);
    const val = parseFloat(m[2].replace(/,/g, ""));
    if (key && isFinite(val)) map[key] = val;
  }
  return map;
}
function applyData(silent) {
  if (!state.geo) return;
  const txt = $("csv").value.trim();
  state.dataMap = txt ? parseCSV(txt) : null;
  state.matched = 0;
  state.values = [];
  for (const f of state.geo.features) {
    const v = featureValue(f.properties);
    if (v !== undefined) { state.matched++; state.values.push(v); }
  }
  const method = $("classification").value;
  const k = Math.max(2, Math.min(9, +$("classes").value || 5));
  state.breaks = state.values.length >= 4 ? computeBreaks(state.values, k, method) : null;
  renderLayer();
  renderLegend();
  if (!silent) {
    const total = state.geo.features.length;
    $("matchStatus").textContent = state.dataMap
      ? `${state.matched}/${total} boundaries matched`
      : "No data yet — paste values or use random demo data.";
    $("matchStatus").className = "status " + (state.dataMap && state.matched ? "ok" : "");
  }
}
function renderLayer() {
  if (state.layer) { map.removeLayer(state.layer); state.layer = null; }
  if (state.labelLayer) { map.removeLayer(state.labelLayer); state.labelLayer = null; }
  if (!state.geo) return;
  const stroke = $("strokeColor").value;
  const w = +$("strokeWidth").value;
  const op = +$("fillOpacity").value;
  state.layer = L.geoJSON(state.geo, {
    style: f => ({
      color: stroke, weight: w, opacity: 1,
      fillColor: colorFor(featureValue(f.properties)), fillOpacity: op,
    }),
    onEachFeature: (f, lyr) => {
      const v = featureValue(f.properties);
      lyr.bindTooltip(
        `<b>${f.properties.shapeName}</b>` + (v !== undefined ? `<br>${fmt(v)}` : ""),
        { sticky: true, direction: "top" });
    },
  }).addTo(map);
  if ($("showLabels").checked) {
    state.labelLayer = L.layerGroup().addTo(map);
    for (const f of state.geo.features) {
      const b = L.geoJSON(f).getBounds();
      const c = b.getCenter();
      L.tooltip({ permanent: true, direction: "center", className: "area-label", opacity: 0.9 })
        .setLatLng(c).setContent(f.properties.shapeName).addTo(state.labelLayer);
    }
  }
}

/* ---------------- legend ---------------- */
const legendCtl = L.Control.extend({
  onAdd() { this.div = L.DomUtil.create("div", "legend"); return this.div; },
});
const legend = new legendCtl({ position: "bottomright" });
function renderLegend() {
  if (!$("legendOn").checked) { if (legend._map) map.removeControl(legend); return; }
  legend.setPosition($("legendPos").value);
  if (!legend._map) map.addControl(legend);
  const title = $("legendTitle").value || "Legend";
  let html = `<div class="legend-title">${escapeHtml(title)}</div>`;
  const hasNoData = state.dataMap && state.matched < state.geo.features.length;
  if (!state.values.length) {
    html += `<div class="row"><span class="swatch" style="background:${$("noDataColor").value}"></span>no data</div>`;
  } else if (state.breaks === null) {
    const stops = paletteStops();
    const grad = stops.map((s, i) => `${s} ${Math.round(i / (stops.length - 1) * 100)}%`).join(",");
    const min = Math.min(...state.values), max = Math.max(...state.values);
    html += `<div class="grad" style="background:linear-gradient(to right,${grad})"></div>`;
    html += `<div class="row" style="justify-content:space-between"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>`;
  } else {
    const cols = classColors();
    const min = Math.min(...state.values), max = Math.max(...state.values);
    const bounds = [min, ...state.breaks, max];
    for (let i = 0; i < cols.length; i++) {
      html += `<div class="row"><span class="swatch" style="background:${cols[i]}"></span>${fmt(bounds[i])} – ${fmt(bounds[i + 1])}</div>`;
    }
  }
  if (hasNoData) html += `<div class="row"><span class="swatch" style="background:${$("noDataColor").value}"></span>no data</div>`;
  legend.div.innerHTML = html;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- north arrow ---------------- */
const NORTH_SVGS = {
  arrow: (c, s) => `<svg width="${s}" height="${s}" viewBox="0 0 100 100">
    <polygon points="50,6 70,88 50,72 30,88" fill="${c}"/>
    <text x="50" y="100" text-anchor="middle" font-size="22" font-weight="bold" fill="${c}">N</text></svg>`,
  compass: (c, s) => `<svg width="${s}" height="${s}" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,.85)" stroke="${c}" stroke-width="3"/>
    <polygon points="50,10 58,50 50,58 42,50" fill="${c}"/>
    <polygon points="50,90 58,50 50,42 42,50" fill="${c}" opacity=".45"/>
    <text x="50" y="24" text-anchor="middle" font-size="16" font-weight="bold" fill="${c}">N</text></svg>`,
  needle: (c, s) => `<svg width="${s}" height="${s}" viewBox="0 0 100 100">
    <polygon points="50,8 62,60 50,52" fill="${c}"/>
    <polygon points="50,8 38,60 50,52" fill="${c}" opacity=".4"/>
    <circle cx="50" cy="60" r="5" fill="${c}"/>
    <text x="50" y="100" text-anchor="middle" font-size="20" font-weight="bold" fill="${c}">N</text></svg>`,
};
const northCtl = L.Control.extend({
  onAdd() { this.div = L.DomUtil.create("div", "north-control"); return this.div; },
});
const north = new northCtl({ position: "topright" });
function renderNorth() {
  if (!$("northOn").checked) { if (north._map) map.removeControl(north); return; }
  north.setPosition($("northPos").value);
  if (!north._map) map.addControl(north);
  north.div.innerHTML = NORTH_SVGS[$("northStyle").value]($("northColor").value, +$("northSize").value);
}

/* ---------------- scale ---------------- */
let scaleCtl = null;
function renderScale() {
  if (scaleCtl) { map.removeControl(scaleCtl); scaleCtl = null; }
  if (!$("scaleOn").checked) return;
  scaleCtl = L.control.scale({
    position: $("scalePos").value,
    metric: $("scaleMetric").checked,
    imperial: $("scaleImperial").checked,
  }).addTo(map);
}

/* ---------------- title ---------------- */
const titleCtl = L.Control.extend({
  onAdd() { this.div = L.DomUtil.create("div", "map-title"); return this.div; },
});
const title = new titleCtl({ position: "topleft" });
function renderTitle() {
  const t = $("mapTitle").value, s = $("mapSubtitle").value;
  if (!t && !s) { if (title._map) map.removeControl(title); return; }
  if (!title._map) map.addControl(title);
  const size = +$("titleSize").value;
  title.div.innerHTML =
    (t ? `<div class="t" style="font-size:${size}px">${escapeHtml(t)}</div>` : "") +
    (s ? `<div class="s">${escapeHtml(s)}</div>` : "");
}

/* ---------------- background ---------------- */
function renderBackground() {
  if (state.basemap) { map.removeLayer(state.basemap); state.basemap = null; }
  if ($("background").value === "osm") {
    state.basemap = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    state.basemap.bringToBack();
  }
}

/* ---------------- PNG export ---------------- */
function drawFeature(ctx, geometry, project) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  if (!polys.length) return null;
  const path = new Path2D();
  for (const poly of polys) for (const ring of poly) {
    ring.forEach((c, i) => {
      const p = project(L.latLng(c[1], c[0]));
      i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y);
    });
    path.closePath();
  }
  return path;
}
function niceScale(metersPerPx) {
  const targets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
    10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
  let best = targets[0];
  for (const t of targets) if (t / metersPerPx >= 70) { best = t; break; }
  return best;
}
function exportPNG() {
  if (!state.geo) { alert("Load boundaries first."); return; }
  const dpr = 2;
  const size = map.getSize();
  const canvas = document.createElement("canvas");
  canvas.width = size.x * dpr; canvas.height = size.y * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.x, size.y);

  const project = ll => map.latLngToContainerPoint(ll);
  const stroke = $("strokeColor").value, w = +$("strokeWidth").value, op = +$("fillOpacity").value;
  for (const f of state.geo.features) {
    const path = drawFeature(ctx, f.geometry, project);
    if (!path) continue;
    ctx.fillStyle = colorFor(featureValue(f.properties));
    ctx.globalAlpha = op; ctx.fill(path); ctx.globalAlpha = 1;
    if (w > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(path); }
  }

  // title
  const t = $("mapTitle").value, s = $("mapSubtitle").value;
  if (t || s) {
    ctx.fillStyle = "#ffffff"; ctx.globalAlpha = .92;
    ctx.fillRect(12, 12, 260, 18 + (+$("titleSize").value) + (s ? 18 : 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1d2733";
    if (t) { ctx.font = `bold ${+$("titleSize").value}px system-ui, sans-serif`; ctx.fillText(t, 22, 12 + +$("titleSize").value); }
    if (s) { ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#67788c"; ctx.fillText(s, 22, 30 + +$("titleSize").value); }
  }

  // legend
  if ($("legendOn").checked && state.values.length) {
    const pos = $("legendPos").value;
    const lw = 170, lh = 30 + 20 * (state.breaks ? state.breaks.length + 1 : 2);
    let x = pos.includes("right") ? size.x - lw - 12 : 12;
    let y = pos.includes("top") ? 12 : size.y - lh - 26;
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(x, y, lw, lh);
    ctx.strokeStyle = "#d9dee6"; ctx.strokeRect(x, y, lw, lh);
    ctx.fillStyle = "#1d2733"; ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText($("legendTitle").value || "Legend", x + 10, y + 18);
    let ly = y + 34;
    if (state.breaks === null) {
      const stops = paletteStops();
      const grad = ctx.createLinearGradient(x + 10, 0, x + lw - 10, 0);
      stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
      ctx.fillStyle = grad; ctx.fillRect(x + 10, ly, lw - 20, 10);
      ctx.fillStyle = "#333"; ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(fmt(Math.min(...state.values)), x + 10, ly + 22);
      ctx.fillText(fmt(Math.max(...state.values)), x + lw - 10 - ctx.measureText(fmt(Math.max(...state.values))).width, ly + 22);
    } else {
      const cols = classColors();
      const min = Math.min(...state.values), max = Math.max(...state.values);
      const bounds = [min, ...state.breaks, max];
      for (let i = 0; i < cols.length; i++) {
        ctx.fillStyle = cols[i]; ctx.fillRect(x + 10, ly, 16, 13);
        ctx.strokeStyle = "#999"; ctx.strokeRect(x + 10, ly, 16, 13);
        ctx.fillStyle = "#333"; ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(`${fmt(bounds[i])} – ${fmt(bounds[i + 1])}`, x + 32, ly + 11);
        ly += 20;
      }
    }
  }

  // north arrow (canvas version)
  if ($("northOn").checked) {
    const pos = $("northPos").value;
    const s2 = +$("northSize").value;
    const x = pos.includes("right") ? size.x - s2 - 30 : 30;
    const y = pos.includes("top") ? (t || s ? 80 : 20) : size.y - s2 - 60;
    const c = $("northColor").value;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s2 / 2, 0); ctx.lineTo(s2 * 0.68, s2 * 0.82); ctx.lineTo(s2 / 2, s2 * 0.66); ctx.lineTo(s2 * 0.32, s2 * 0.82);
    ctx.closePath(); ctx.fill();
    ctx.font = `bold ${Math.round(s2 * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("N", s2 / 2, s2 * 1.02);
    ctx.restore();
  }

  // scale bar
  if ($("scaleOn").checked && ($("scaleMetric").checked || $("scaleImperial").checked)) {
    const c0 = map.getCenter();
    const p1 = map.latLngToContainerPoint(c0);
    const p2 = L.point(p1.x + 100, p1.y);
    const metersPerPx = map.distance(c0, map.containerPointToLatLng(p2)) / 100;
    const m = niceScale(metersPerPx);
    const px = m / metersPerPx;
    const pos = $("scalePos").value;
    const bx = pos.includes("right") ? size.x - px - 30 : 30;
    const by = size.y - 34;
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(bx - 6, by - 14, px + 12, 30);
    ctx.strokeStyle = "#333"; ctx.fillStyle = "#333"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + px, by - 4); ctx.lineTo(bx + px, by + 4); ctx.stroke();
    ctx.font = "11px system-ui, sans-serif";
    const label = m >= 1000 ? (m / 1000) + " km" : m + " m";
    ctx.fillText(label, bx + px / 2 - ctx.measureText(label).width / 2, by - 7);
  }

  // attribution
  ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#67788c";
  ctx.fillText("Boundaries: geoBoundaries (CC BY 4.0)", size.x - 190, size.y - 6);

  const a = document.createElement("a");
  a.download = `automap-${state.iso}-${state.adm}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

/* ---------------- wiring ---------------- */
function populateCountries() {
  const sel = $("country");
  sel.innerHTML = '<option value="">— select a country —</option>';
  Object.entries(COUNTRIES).sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([iso, name]) => sel.add(new Option(`${name} (${iso})`, iso)));
}
function randomData() {
  if (!state.geo) { alert("Load boundaries first."); return; }
  $("csv").value = state.geo.features
    .map(f => `${f.properties.shapeName},${Math.round(Math.random() * 1000)}`)
    .join("\n");
  applyData();
}
function refreshStyle() { renderLayer(); renderLegend(); }

function init() {
  populateCountries();
  renderNorth(); renderScale(); renderTitle(); renderBackground();

  $("country").addEventListener("change", loadBoundary);
  $("adm").addEventListener("change", loadBoundary);
  $("btnApply").addEventListener("click", () => applyData());
  $("btnRandom").addEventListener("click", randomData);
  $("btnExport").addEventListener("click", exportPNG);

  const restyle = ["palette", "classification", "classes", "noDataColor", "cMin", "cMax",
    "strokeColor", "strokeWidth", "fillOpacity", "showLabels"];
  restyle.forEach(id => $(id).addEventListener("change", refreshStyle));
  $("palette").addEventListener("change", () =>
    $("customColors").classList.toggle("hidden", $("palette").value !== "custom"));

  $("legendOn").addEventListener("change", renderLegend);
  $("legendPos").addEventListener("change", renderLegend);
  $("legendTitle").addEventListener("input", renderLegend);
  $("northOn").addEventListener("change", renderNorth);
  $("northPos").addEventListener("change", renderNorth);
  $("northStyle").addEventListener("change", renderNorth);
  $("northColor").addEventListener("change", renderNorth);
  $("northSize").addEventListener("input", renderNorth);
  ["scaleOn", "scalePos", "scaleMetric", "scaleImperial"].forEach(id => $(id).addEventListener("change", renderScale));
  ["mapTitle", "mapSubtitle", "titleSize"].forEach(id => $(id).addEventListener("input", renderTitle));
  $("background").addEventListener("change", renderBackground);
}
init();
