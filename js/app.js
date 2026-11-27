/* Taiwan county lottery.
   Boundaries: Ministry of the Interior via taiwan-atlas counties-10t.json.
   d3 and topojson-client are vendored; this page has no runtime CDN use. */
(function () {
  "use strict";

  const OFFICIAL = [
    "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣",
    "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市",
    "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣",
    "臺東縣", "澎湖縣", "金門縣", "連江縣",
  ];

  const COLORS = {
    基隆市: "#3aa0b8",
    臺北市: "#e0b15a",
    新北市: "#2c4f86",
    桃園市: "#2f9a78",
    新竹市: "#e08a45",
    新竹縣: "#6d5cb0",
    苗栗縣: "#3e9a55",
    臺中市: "#3d74d0",
    彰化縣: "#c4844a",
    南投縣: "#2f8f6a",
    雲林縣: "#8a5a92",
    嘉義市: "#e0a04a",
    嘉義縣: "#3d8eaa",
    臺南市: "#5d8a48",
    高雄市: "#b25a78",
    屏東縣: "#3e7a9a",
    宜蘭縣: "#8aaa48",
    花蓮縣: "#7a6a9e",
    臺東縣: "#6a9470",
    澎湖縣: "#2a9aaa",
    金門縣: "#d4a15a",
    連江縣: "#7a8ec4",
    小琉球: "#d9893a",
    綠島: "#2fbfa0",
    蘭嶼: "#d06a8a",
  };

  /* Nudges in a 760px-tall map; scaled with the island and kept only if still on land. */
  const NUDGE = {
    新竹縣: [10, 14],
    嘉義縣: [16, 8],
    彰化縣: [-8, 6],
    雲林縣: [-4, 10],
    高雄市: [-6, 6],
    臺東縣: [8, 4],
  };

  /* Dwell on each county, in ms, before the next hop. Always used,
     including when the OS asks for reduced motion. The steps grow
     so the slowdown is visible the whole way, and none is under a frame. */
  const HOP_GAPS = [
    70, 94, 120, 148, 178, 210, 244, 280, 318, 358, 400, 445,
    492, 542, 595, 651, 710, 772, 838, 908, 982, 1060, 1144,
  ];

  const mapEl = document.getElementById("map");
  const donateEl = document.getElementById("donate");
  const statusEl = document.getElementById("status");
  const banner = document.getElementById("banner");
  const bannerText = document.getElementById("banner-text");
  const fx = document.getElementById("fx");
  const drawBtn = document.getElementById("draw");
  const resetBtn = document.getElementById("reset");
  const norepeat = document.getElementById("norepeat");
  const hint = document.getElementById("hint");
  const historyEl = document.getElementById("history");
  const eventsEl = document.getElementById("events");
  const eventsTitle = document.getElementById("events-title");
  const eventsRange = document.getElementById("events-range");
  const eventsTabs = document.getElementById("events-tabs");
  const eventsList = document.getElementById("events-list");
  const eventsEmpty = document.getElementById("events-empty");
  const eventsCredit = document.getElementById("events-credit");
  const lookupEl = document.getElementById("lookup");
  const paneEvents = document.getElementById("pane-events");
  const paneSpots = document.getElementById("pane-spots");
  const paneStay = document.getElementById("pane-stay");
  const placeTabs = document.getElementById("place-tabs");
  const spotsList = document.getElementById("spots-list");
  const spotsMore = document.getElementById("spots-more");
  const spotsEmpty = document.getElementById("spots-empty");
  const spotsCredit = document.getElementById("spots-credit");
  const stayLinks = document.getElementById("stay-links");

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function applyDonateLink() {
    const raw = typeof DONATE_URL === "string" ? DONATE_URL.trim() : "";
    if (!/^https?:\/\//i.test(raw)) {
      donateEl.hidden = true;
      donateEl.removeAttribute("href");
      return;
    }
    donateEl.href = raw;
    donateEl.hidden = false;
  }

  applyDonateLink();

  const state = {
    counties: [],
    history: [],
    spinning: false,
    winnerId: null,
    frameId: null,
    width: 0,
    height: 0,
    svg: null,
    spots: null,
    spotIndex: 0,
    renderDeferred: false,
    nodes: new Map(),
    renderQueued: false,
    paths: null,
    eventsData: null,
    eventsFailed: false,
    eventsCounty: "",
    eventsTab: "全部",
    eventsPromise: null,
    spotData: null,
    spotFailed: false,
    spotPromise: null,
    placePane: "events",
    spotsExpanded: false,
  };

  function officialName(raw) {
    return String(raw).replaceAll("台", "臺");
  }

  function randomIndex(n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      crypto.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % n;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function mixWhite(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * amount);
    return "rgb(" + mix((n >> 16) & 255) + ", " + mix((n >> 8) & 255) + ", " + mix(n & 255) + ")";
  }

  function polygonsOf(feature) {
    const geometry = feature.geometry;
    if (!geometry) return [];
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
  }

  function ringArea(ring) {
    let area = 0;
    for (let i = 0, n = ring.length - 1; i < n; i += 1) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area) / 2;
  }

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const hit = (yi > y) !== (yj > y) &&
        x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  function pointInFeature(x, y, feature) {
    return polygonsOf(feature).some((polygon) => {
      if (!pointInRing(x, y, polygon[0])) return false;
      for (let hole = 1; hole < polygon.length; hole += 1) {
        if (pointInRing(x, y, polygon[hole])) return false;
      }
      return true;
    });
  }

  function distToSeg(px, py, ax, ay, bx, by, kx) {
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : (((px - ax) * kx) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + ((bx - ax) * t);
    const qy = ay + (by - ay) * t;
    return Math.hypot((px - qx) * kx, py - qy);
  }

  function clearance(x, y, polygon, kx) {
    let best = Infinity;
    for (let r = 0; r < polygon.length; r += 1) {
      const ring = polygon[r];
      for (let i = 0, n = ring.length - 1; i < n; i += 1) {
        const d = distToSeg(x, y, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], kx);
        if (d < best) best = d;
      }
    }
    return best;
  }

  function interiorPoint(polygon) {
    const outer = polygon[0];
    const holes = polygon.slice(1);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outer.length; i += 1) {
      const x = outer[i][0];
      const y = outer[i][1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
    const steps = 30;
    let best = null;
    let bestD = -1;
    for (let iy = 0; iy <= steps; iy += 1) {
      const y = minY + ((maxY - minY) * iy) / steps;
      for (let ix = 0; ix <= steps; ix += 1) {
        const x = minX + ((maxX - minX) * ix) / steps;
        if (!pointInRing(x, y, outer)) continue;
        let inHole = false;
        for (let h = 0; h < holes.length; h += 1) {
          if (pointInRing(x, y, holes[h])) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
        const d = clearance(x, y, polygon, kx);
        if (d > bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < outer.length; i += 1) {
      sx += outer[i][0];
      sy += outer[i][1];
    }
    return [sx / outer.length, sy / outer.length];
  }

  function ringCentroid(ring) {
    let x = 0;
    let y = 0;
    let area = 0;
    for (let i = 0, n = ring.length - 1; i < n; i += 1) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      area += cross;
      x += (ring[i][0] + ring[i + 1][0]) * cross;
      y += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    if (Math.abs(area) < 1e-14) {
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < ring.length; i += 1) {
        sx += ring[i][0];
        sy += ring[i][1];
      }
      return [sx / ring.length, sy / ring.length];
    }
    return [x / (3 * area), y / (3 * area)];
  }

  function classify(lon, lat) {
    if (lat >= 25.75) return "lienchiang";
    if (lon <= 118.95 && lat >= 24.25 && lat <= 24.7) return "kinmen";
    if (lon >= 119.25 && lon <= 119.7 && lat >= 24.8 && lat <= 25.2) return "wuqiu";
    if (lon <= 119.95 && lat >= 23.05 && lat <= 23.95) return "penghu";
    return "main";
  }

  function splitLienchiang(polygons) {
    const main = [];
    const dongyin = [];
    const liang = [];
    const juguang = [];
    polygons.forEach((polygon) => {
      const centroid = ringCentroid(polygon[0]);
      if (centroid[0] >= 120.35) dongyin.push(polygon);
      else if (centroid[0] >= 120.15) liang.push(polygon);
      else if (centroid[1] < 26.08) juguang.push(polygon);
      else main.push(polygon);
    });
    return { main, dongyin, liang, juguang };
  }

  function asFeature(polygons) {
    if (!polygons.length) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
    };
  }

  function largestPolygon(polygons) {
    let best = polygons[0];
    let bestArea = -1;
    polygons.forEach((polygon) => {
      const area = ringArea(polygon[0]);
      if (area > bestArea) {
        bestArea = area;
        best = polygon;
      }
    });
    return best;
  }

  function entryFromPolygons(id, name, polygons, buckets, callout) {
    const labelPolygon = largestPolygon(polygons);
    const color = COLORS[name] || "#4d6a88";
    return {
      id,
      name,
      color,
      warm: mixWhite(color, 0.3),
      hot: mixWhite(color, 0.52),
      buckets,
      callout,
      calloutPolygons: callout ? polygons : null,
      labelPolygon,
      anchor: interiorPoint(labelPolygon),
      area: polygons.reduce((sum, polygon) => sum + ringArea(polygon[0]), 0),
      d: "",
    };
  }

  function buildCounties(topo, islands) {
    const islandFeatures = islands.features || [];
    const onIsland = (polygon) => {
      const centroid = ringCentroid(polygon[0]);
      return islandFeatures.some((feature) => pointInFeature(centroid[0], centroid[1], feature));
    };
    const collection = topojson.feature(topo, topo.objects.counties);
    const counties = collection.features.map((feature) => {
      const name = officialName(feature.properties.COUNTYNAME);
      const buckets = { main: [], penghu: [], kinmen: [], wuqiu: [], lienchiang: [] };
      polygonsOf(feature).forEach((polygon) => {
        if (onIsland(polygon)) return;
        const centroid = ringCentroid(polygon[0]);
        buckets[classify(centroid[0], centroid[1])].push(polygon);
      });
      let labelPolygons = buckets.main;
      if (name === "金門縣") labelPolygons = buckets.kinmen;
      else if (name === "澎湖縣") labelPolygons = buckets.penghu;
      else if (name === "連江縣") {
        const parts = splitLienchiang(buckets.lienchiang);
        labelPolygons = parts.main.length ? parts.main : buckets.lienchiang;
      }
      const all = buckets.main.concat(buckets.penghu, buckets.kinmen, buckets.wuqiu, buckets.lienchiang);
      const entry = entryFromPolygons(
        String(feature.properties.COUNTYCODE),
        name,
        labelPolygons.length ? labelPolygons : all,
        buckets,
        null,
      );
      entry.area = all.reduce((sum, polygon) => sum + ringArea(polygon[0]), 0);
      return entry;
    });

    islandFeatures.forEach((feature) => {
      const polygons = polygonsOf(feature);
      const empty = { main: [], penghu: [], kinmen: [], wuqiu: [], lienchiang: [] };
      counties.push(entryFromPolygons(feature.properties.id, feature.properties.name, polygons, empty, feature.properties.id));
    });

    const names = counties.map((county) => county.name).sort();
    const expected = OFFICIAL.concat(islandFeatures.map((feature) => feature.properties.name)).sort();
    if (names.length !== 25 || names.some((name, index) => name !== expected[index])) {
      throw new Error("抽獎名單與二十五個地區不符：" + names.join("、"));
    }
    const kept = (name) => {
      const county = counties.find((item) => item.name === name);
      return county.buckets.main.length + county.buckets.penghu.length + county.buckets.kinmen.length + county.buckets.wuqiu.length + county.buckets.lienchiang.length;
    };
    if (kept("屏東縣") !== 1 || kept("臺東縣") !== 1) {
      throw new Error("小琉球、綠島、蘭嶼沒有從屏東縣與臺東縣拆開");
    }
    return counties;
  }

  function computeLayout(width, height) {
    const gap = Math.max(8, Math.round(Math.min(width, height) * 0.016));
    const wide = width / height > 0.98 && height >= 640;
    if (wide) {
      const insetW = Math.round(Math.min(width * 0.24, Math.max(168, height * 0.34)));
      const innerH = height - gap * 2;
      const islandH = Math.round(Math.min(Math.max(118, innerH * 0.18), 150));
      const boxH = (innerH - islandH - gap * 3) / 3;
      return {
        wide: true,
        main: {
          x: gap * 2 + insetW,
          y: gap,
          w: width - insetW - gap * 3,
          h: height - gap * 2,
        },
        insets: [
          { key: "lienchiang", name: "連江縣", x: gap, y: gap, w: insetW, h: boxH },
          { key: "kinmen", name: "金門縣", x: gap, y: gap + boxH + gap, w: insetW, h: boxH },
          { key: "penghu", name: "澎湖縣", x: gap, y: gap + (boxH + gap) * 2, w: insetW, h: boxH },
        ],
        islands: { x: gap, y: gap + (boxH + gap) * 3, w: insetW, h: islandH },
      };
    }
    const insetW = Math.round(Math.min(112, Math.max(84, width * 0.24)));
    const innerH = height - gap * 2;
    const band = (innerH - gap * 5) / 6;
    const stack = [
      { key: "penghu", name: "澎湖縣" },
      { key: "kinmen", name: "金門縣" },
      { key: "lienchiang", name: "連江縣" },
    ];
    return {
      wide: false,
      main: {
        x: gap * 2 + insetW,
        y: gap,
        w: Math.max(40, width - insetW - gap * 3),
        h: height - gap * 2,
      },
      insets: stack.map((item, index) => ({
        key: item.key,
        name: item.name,
        x: gap,
        y: gap + (band + gap) * index,
        w: insetW,
        h: band,
      })),
      islands: {
        x: gap,
        y: gap + (band + gap) * 3,
        w: insetW,
        h: band * 3 + gap * 2,
      },
    };
  }

  function splitCallout(polygons) {
    const body = largestPolygon(polygons);
    const center = ringCentroid(body[0]);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    body[0].forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const near = [];
    const far = [];
    polygons.forEach((polygon) => {
      const point = ringCentroid(polygon[0]);
      const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
      if (polygon !== body && distance > span * 0.75) far.push(polygon);
      else near.push(polygon);
    });
    return { near, far };
  }

  function islandCells(box) {
    const specs = [
      { key: "liuqiu", name: "小琉球" },
      { key: "ludao", name: "綠島" },
      { key: "lanyu", name: "蘭嶼" },
    ];
    const vertical = box.h > box.w * 1.15;
    const gap = Math.max(4, Math.min(8, Math.min(box.w, box.h) * 0.03));
    if (vertical) {
      const cellH = (box.h - gap * (specs.length - 1)) / specs.length;
      return specs.map((spec, index) => ({
        key: spec.key,
        name: spec.name,
        x: box.x,
        y: box.y + index * (cellH + gap),
        w: box.w,
        h: cellH,
      }));
    }
    const cellW = (box.w - gap * (specs.length - 1)) / specs.length;
    return specs.map((spec, index) => ({
      key: spec.key,
      name: spec.name,
      x: box.x + index * (cellW + gap),
      y: box.y,
      w: cellW,
      h: box.h,
    }));
  }

  function contentOf(box) {
    const header = box.h < 64
      ? Math.max(9, Math.min(12, box.h * 0.34))
      : Math.min(22, Math.max(16, box.h * 0.14));
    const padX = Math.min(10, Math.max(4, box.w * 0.045));
    const padB = Math.min(8, Math.max(3, box.h * 0.04));
    return {
      header,
      inner: {
        x: box.x + padX,
        y: box.y + header + 3,
        w: Math.max(12, box.w - padX * 2),
        h: Math.max(12, box.h - header - padB - 3),
      },
    };
  }

  function fitPath(features, x0, y0, x1, y1) {
    if (!features.length) return null;
    if (x1 < x0) { const swap = x0; x0 = x1; x1 = swap; }
    if (y1 < y0) { const swap = y0; y0 = y1; y1 = swap; }
    if (x1 - x0 < 8) {
      const mid = (x0 + x1) / 2;
      x0 = mid - 4;
      x1 = mid + 4;
    }
    if (y1 - y0 < 8) {
      const mid = (y0 + y1) / 2;
      y0 = mid - 4;
      y1 = mid + 4;
    }
    const projection = d3.geoMercator().fitExtent(
      [[x0, y0], [x1, y1]],
      { type: "FeatureCollection", features },
    );
    return d3.geoPath(projection);
  }

  function fontSize(bounds, name, inset, mapH) {
    const w = Math.max(0, bounds[1][0] - bounds[0][0]);
    const h = Math.max(0, bounds[1][1] - bounds[0][1]);
    const size = Math.min((w * 0.82) / name.length, h * 0.55);
    const cap = Math.min(inset ? 16 : 16.5, Math.max(11, mapH / 50));
    const min = inset ? 10.5 : 8;
    if (!Number.isFinite(size)) return min;
    return Math.max(min, Math.min(cap, size));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        node.setAttribute(key, attrs[key]);
      });
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function render() {
    const width = state.width;
    const height = state.height;
    const layout = computeLayout(width, height);
    const byKey = {};
    layout.insets.forEach((box) => {
      byKey[box.key] = box;
    });

    const mainFeatures = [];
    const penghuFeatures = [];
    const kinmenFeatures = [];
    const wuqiuFeatures = [];
    state.counties.forEach((county) => {
      const main = asFeature(county.buckets.main);
      const penghu = asFeature(county.buckets.penghu);
      const kinmen = asFeature(county.buckets.kinmen);
      const wuqiu = asFeature(county.buckets.wuqiu);
      if (main) mainFeatures.push(main);
      if (penghu) penghuFeatures.push(penghu);
      if (kinmen) kinmenFeatures.push(kinmen);
      if (wuqiu) wuqiuFeatures.push(wuqiu);
    });

    const mainPad = Math.max(12, Math.min(26, Math.min(layout.main.w, layout.main.h) * 0.035));
    const pathMain = fitPath(
      mainFeatures,
      layout.main.x + mainPad,
      layout.main.y + mainPad,
      layout.main.x + layout.main.w - mainPad,
      layout.main.y + layout.main.h - mainPad,
    );

    const penghuBox = contentOf(byKey.penghu).inner;
    const lienchiangBox = contentOf(byKey.lienchiang).inner;
    const lienSide = Math.min(lienchiangBox.w * 0.32, 78);
    const lienMainBox = {
      x: lienchiangBox.x,
      y: lienchiangBox.y,
      w: Math.max(12, lienchiangBox.w - lienSide - 6),
      h: lienchiangBox.h,
    };
    const dongyinBox = {
      x: lienchiangBox.x + lienchiangBox.w - lienSide,
      y: lienchiangBox.y,
      w: lienSide,
      h: lienchiangBox.h * 0.48,
    };
    const juguangBox = {
      x: dongyinBox.x,
      y: lienchiangBox.y + lienchiangBox.h * 0.52,
      w: lienSide,
      h: lienchiangBox.h * 0.48,
    };
    const kinmenContent = contentOf(byKey.kinmen);
    const kinmenInner = kinmenContent.inner;
    const wuW = Math.min(kinmenInner.w * 0.34, 92);
    const wuH = Math.min(kinmenInner.h * 0.38, 78);
    const wuqiuBox = {
      x: kinmenInner.x + kinmenInner.w - wuW,
      y: kinmenInner.y,
      w: wuW,
      h: wuH,
    };
    const kinmenBox = {
      x: kinmenInner.x,
      y: kinmenInner.y,
      w: Math.max(12, kinmenInner.w - wuW - 8),
      h: kinmenInner.h,
    };

    const pad = (box, ratio) => Math.max(4, Math.min(box.w, box.h) * ratio);
    const pathPenghu = fitPath(
      penghuFeatures,
      penghuBox.x + pad(penghuBox, 0.06),
      penghuBox.y + pad(penghuBox, 0.06),
      penghuBox.x + penghuBox.w - pad(penghuBox, 0.06),
      penghuBox.y + penghuBox.h - pad(penghuBox, 0.06),
    );
    const lienMainPolys = [];
    const lienDongPolys = [];
    const lienLiangPolys = [];
    const lienJuPolys = [];
    state.counties.forEach((county) => {
      const parts = splitLienchiang(county.buckets.lienchiang);
      lienMainPolys.push(...parts.main);
      lienDongPolys.push(...parts.dongyin);
      lienLiangPolys.push(...parts.liang);
      lienJuPolys.push(...parts.juguang);
    });
    const pathLienchiang = fitPath(
      [asFeature(lienMainPolys)].filter(Boolean),
      lienMainBox.x + 4,
      lienMainBox.y + 4,
      lienMainBox.x + lienMainBox.w - 4,
      lienMainBox.y + lienMainBox.h - 4,
    );
    const dongTop = lienLiangPolys.length ? dongyinBox.h * 0.62 : dongyinBox.h;
    const pathDongyin = fitPath(
      [asFeature(lienDongPolys)].filter(Boolean),
      dongyinBox.x + 4,
      dongyinBox.y + 14,
      dongyinBox.x + dongyinBox.w - 4,
      dongyinBox.y + dongTop - 2,
    );
    const pathLiang = fitPath(
      [asFeature(lienLiangPolys)].filter(Boolean),
      dongyinBox.x + 6,
      dongyinBox.y + dongTop + 2,
      dongyinBox.x + dongyinBox.w - 6,
      dongyinBox.y + dongyinBox.h - 4,
    );
    const pathJuguang = fitPath(
      [asFeature(lienJuPolys)].filter(Boolean),
      juguangBox.x + 4,
      juguangBox.y + 14,
      juguangBox.x + juguangBox.w - 4,
      juguangBox.y + juguangBox.h - 4,
    );
    const pathKinmen = fitPath(
      kinmenFeatures,
      kinmenBox.x + 4,
      kinmenBox.y + 4,
      kinmenBox.x + kinmenBox.w - 4,
      kinmenBox.y + kinmenBox.h - 4,
    );
    const pathWuqiu = fitPath(
      wuqiuFeatures,
      wuqiuBox.x + 5,
      wuqiuBox.y + 16,
      wuqiuBox.x + wuqiuBox.w - 5,
      wuqiuBox.y + wuqiuBox.h - 5,
    );

    const paths = {
      main: pathMain,
      penghu: pathPenghu,
      kinmen: pathKinmen,
      wuqiu: pathWuqiu,
      lienchiang: pathLienchiang,
      dongyin: pathDongyin,
      liang: pathLiang,
      juguang: pathJuguang,
    };
    state.paths = paths;

    const svg = el("svg", {
      class: "map-svg",
      viewBox: "0 0 " + width + " " + height,
      width: String(width),
      height: String(height),
      role: "img",
      "aria-label": "臺灣二十五個地區地圖",
    });
    if (state.spinning) svg.classList.add("is-spinning");

    const defs = el("defs", null, svg);
    const gradient = el("radialGradient", {
      id: "sea",
      cx: layout.wide ? "68%" : "50%",
      cy: layout.wide ? "46%" : "38%",
      r: "78%",
    }, defs);
    el("stop", { offset: "0%", "stop-color": "#17324c" }, gradient);
    el("stop", { offset: "50%", "stop-color": "#0d1b2c" }, gradient);
    el("stop", { offset: "100%", "stop-color": "#070e18" }, gradient);
    el("rect", { class: "sea", x: 0, y: 0, width, height, fill: "url(#sea)" }, svg);

    layout.insets.forEach((box) => {
      const piece = contentOf(box);
      el("rect", {
        class: "inset-frame",
        "data-inset": box.key,
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        rx: 14,
      }, svg);
      const caption = el("text", {
        class: "inset-caption",
        x: box.x + 12,
        y: box.y + piece.header * 0.72,
        "font-size": "12",
      }, svg);
      caption.textContent = box.name;
    });

    el("rect", {
      class: "wuqiu-frame",
      x: wuqiuBox.x,
      y: wuqiuBox.y,
      width: wuqiuBox.w,
      height: wuqiuBox.h,
      rx: 8,
    }, svg);
    const wuqiuLabel = el("text", {
      class: "wuqiu-caption",
      x: wuqiuBox.x + wuqiuBox.w / 2,
      y: wuqiuBox.y + 11,
      "text-anchor": "middle",
      "font-size": "10",
    }, svg);
    wuqiuLabel.textContent = "烏坵";

    const cells = islandCells(layout.islands);
    const cellByKey = {};
    cells.forEach((cell) => {
      cellByKey[cell.key] = cell;
      el("rect", {
        class: "inset-frame",
        "data-inset": cell.key,
        x: cell.x,
        y: cell.y,
        width: cell.w,
        height: cell.h,
        rx: 12,
      }, svg);
    });
    const calloutPaths = {};
    state.counties.forEach((county) => {
      if (!county.callout) return;
      const cell = cellByKey[county.callout];
      const parts = splitCallout(county.calloutPolygons);
      const sat = parts.far.length ? Math.min(36, cell.w * 0.46, cell.h * 0.34) : 0;
      calloutPaths[county.callout] = {
        near: fitPath(
          [asFeature(parts.near)].filter(Boolean),
          cell.x + 7,
          cell.y + 20,
          cell.x + cell.w - 7 - (sat ? sat * 0.15 : 0),
          cell.y + cell.h - 7,
        ),
        far: sat ? fitPath(
          [asFeature(parts.far)].filter(Boolean),
          cell.x + cell.w - sat - 4,
          cell.y + cell.h - sat - 4,
          cell.x + cell.w - 4,
          cell.y + cell.h - 4,
        ) : null,
        nearPolys: parts.near,
        farPolys: parts.far,
      };
    });

    [[dongyinBox, "東引"], [juguangBox, "莒光"]].forEach(([box, caption]) => {
      el("rect", {
        class: "wuqiu-frame",
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        rx: 8,
      }, svg);
      const text = el("text", {
        class: "wuqiu-caption",
        x: box.x + box.w / 2,
        y: box.y + 11,
        "text-anchor": "middle",
        "font-size": "10",
      }, svg);
      text.textContent = caption;
    });

    const layer = el("g", { class: "counties" }, svg);
    const nodes = new Map();
    const ordered = state.counties.slice().sort((a, b) => b.area - a.area);
    ordered.forEach((county) => {
      let d = "";
      if (county.callout) {
        const drawn = calloutPaths[county.callout];
        const near = asFeature(drawn.nearPolys);
        const far = asFeature(drawn.farPolys);
        if (near && drawn.near) d += drawn.near(near) || "";
        if (far && drawn.far) d += drawn.far(far) || "";
      }
      ["main", "penghu", "kinmen", "wuqiu"].forEach((key) => {
        const feature = asFeature(county.buckets[key]);
        if (!feature || !paths[key]) return;
        d += paths[key](feature) || "";
      });
      const lienParts = splitLienchiang(county.buckets.lienchiang);
      [["main", "lienchiang"], ["dongyin", "dongyin"], ["liang", "liang"], ["juguang", "juguang"]].forEach(([part, key]) => {
        const feature = asFeature(lienParts[part]);
        if (!feature || !paths[key]) return;
        d += paths[key](feature) || "";
      });
      county.d = d;
      const path = el("path", {
        class: "county",
        "data-id": county.id,
        "data-name": county.name,
        d: d,
        fill: county.color,
      }, layer);
      const title = el("title", null, path);
      title.textContent = county.name;
      nodes.set(county.id, { path, label: null });
    });

    state.counties.forEach((county) => {
      if (county.callout) {
        const cell = cellByKey[county.callout];
        const label = el("text", {
          class: "county-label",
          "data-name": county.name,
          x: (cell.x + cell.w / 2).toFixed(1),
          y: (cell.y + 13).toFixed(1),
          "text-anchor": "middle",
          "font-size": "11",
        }, svg);
        label.textContent = county.name;
        nodes.get(county.id).label = label;
        return;
      }
      const region = county.buckets.main.length
        ? "main"
        : county.buckets.kinmen.length
          ? "kinmen"
          : county.buckets.penghu.length
            ? "penghu"
            : "lienchiang";
      const pathGen = paths[region];
      if (!pathGen) {
        const box = region === "main" ? layout.main : byKey[region];
        const label = el("text", {
          class: "county-label",
          "data-name": county.name,
          x: (box.x + box.w / 2).toFixed(1),
          y: (box.y + box.h / 2).toFixed(1),
          "text-anchor": "middle",
          "font-size": "11",
        }, svg);
        label.textContent = county.name;
        nodes.get(county.id).label = label;
        return;
      }
      const projected = pathGen.projection()(county.anchor);
      const bounds = pathGen.bounds(asFeature([county.labelPolygon]));
      const inset = region !== "main";
      const box = region === "main" ? layout.main : byKey[region];
      const nudge = NUDGE[county.name] || [0, 0];
      const nudgeScale = layout.main.h / 760;
      let x = projected[0];
      let y = projected[1];
      const movedX = x + nudge[0] * nudgeScale;
      const movedY = y + nudge[1] * nudgeScale;
      const probe = svg.createSVGPoint();
      probe.x = movedX;
      probe.y = movedY;
      if (nodes.get(county.id).path.isPointInFill(probe)) {
        x = movedX;
        y = movedY;
      }
      const margin = inset ? 14 : 6;
      const clampedX = clamp(x, box.x + margin, box.x + box.w - margin);
      const clampedY = clamp(y, box.y + (inset ? 22 : margin), box.y + box.h - margin);
      probe.x = clampedX;
      probe.y = clampedY;
      if (nodes.get(county.id).path.isPointInFill(probe)) {
        x = clampedX;
        y = clampedY;
      }
      const size = fontSize(bounds, county.name, inset, layout.main.h);
      const label = el("text", {
        class: "county-label",
        "data-name": county.name,
        x: x.toFixed(1),
        y: y.toFixed(1),
        "font-size": size.toFixed(1),
      }, svg);
      label.textContent = county.name;
      nodes.get(county.id).label = label;
    });

    state.spots = [createSpot(svg), createSpot(svg)];
    state.spotIndex = 0;

    mapEl.replaceChildren(svg);
    state.svg = svg;
    state.nodes = nodes;
    applyCountyStyles();
    if (state.frameId) paintFrame(state.frameId, 0);
  }

  function createSpot(parent) {
    const g = el("g", { class: "spotlight no-fade" }, parent);
    const glow = el("path", { class: "spot-glow" }, g);
    const core = el("path", { class: "spot-core" }, g);
    return { g, glow, core };
  }

  function paintFrame(id, fadeMs) {
    if (!state.spots) return;
    const county = id ? state.counties.find((item) => item.id === id) : null;
    const d = county && county.d ? county.d : "";
    if (!d) {
      state.spots.forEach((spot) => {
        spot.g.classList.remove("is-shown");
        spot.glow.setAttribute("d", "");
        spot.core.setAttribute("d", "");
      });
      return;
    }
    const nextIndex = state.spotIndex ^ 1;
    const next = state.spots[nextIndex];
    const prev = state.spots[state.spotIndex];
    next.glow.setAttribute("d", d);
    next.core.setAttribute("d", d);
    const fade = fadeMs > 0;
    if (!fade) {
      next.g.classList.add("no-fade");
      prev.g.classList.add("no-fade");
      next.g.style.transitionDuration = "0ms";
      prev.g.style.transitionDuration = "0ms";
      next.g.classList.add("is-shown");
      prev.g.classList.remove("is-shown");
    } else {
      next.g.classList.add("no-fade");
      next.g.classList.remove("is-shown");
      next.g.style.transitionDuration = "0ms";
      void next.core.getBoundingClientRect();
      next.g.style.transitionDuration = fadeMs + "ms";
      prev.g.style.transitionDuration = fadeMs + "ms";
      next.g.classList.remove("no-fade");
      prev.g.classList.remove("no-fade");
      next.g.classList.add("is-shown");
      prev.g.classList.remove("is-shown");
    }
    state.spotIndex = nextIndex;
  }

  function scheduleRender() {
    if (state.spinning) {
      state.renderDeferred = true;
      return;
    }
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      if (state.spinning) {
        state.renderDeferred = true;
        return;
      }
      const rect = mapEl.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 40 || height < 40) return;
      if (width === state.width && height === state.height && state.svg) return;
      state.width = width;
      state.height = height;
      render();
    });
  }

  function eligibleCounties() {
    if (!norepeat.checked) return state.counties.slice();
    const drawn = new Set(state.history.map((item) => item.id));
    return state.counties.filter((county) => !drawn.has(county.id));
  }

  function applyCountyStyles() {
    const drawn = new Set(state.history.map((item) => item.id));
    state.counties.forEach((county) => {
      const node = state.nodes.get(county.id);
      if (!node) return;
      const isWinner = state.winnerId === county.id;
      const spent = norepeat.checked && drawn.has(county.id) && !isWinner;
      node.path.classList.toggle("is-winner", isWinner);
      node.path.classList.toggle("is-spent", spent);
      node.label.classList.toggle("is-spent", spent);
      node.path.setAttribute("fill", isWinner ? county.hot : county.color);
    });
    if (state.svg) state.svg.classList.toggle("is-spinning", state.spinning);
  }

  function setDrawFace(face) {
    drawBtn.querySelectorAll(".draw-face").forEach((el) => {
      const on = el.getAttribute("data-face") === face;
      el.classList.toggle("is-on", on);
      el.toggleAttribute("aria-hidden", !on);
    });
  }

  function syncControls() {
    const eligible = eligibleCounties();
    const blocked = state.spinning || eligible.length === 0;
    drawBtn.disabled = blocked || !state.counties.length;
    resetBtn.disabled = state.spinning || state.history.length === 0;
    norepeat.disabled = state.spinning;
    lookupEl.disabled = state.spinning;
    if (state.spinning) setDrawFace("spin");
    else if (eligible.length === 0) setDrawFace("done");
    else if (state.history.length) setDrawFace("again");
    else setDrawFace("idle");
    if (norepeat.checked && eligible.length === 0) {
      hint.textContent = "二十五個地區都已抽出";
    } else if (norepeat.checked) {
      hint.textContent = "已抽出的地區不會再被抽到";
    } else {
      hint.textContent = "每一輪都從全部地區抽出";
    }
  }

  function renderHistory() {
    historyEl.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "尚無抽獎紀錄";
      historyEl.appendChild(empty);
      return;
    }
    for (let i = state.history.length - 1; i >= 0; i -= 1) {
      const item = state.history[i];
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = "第 " + (i + 1) + " 次";
      const name = document.createElement("span");
      name.className = "name";
      const swatch = document.createElement("i");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      name.append(swatch, document.createTextNode(item.name));
      li.append(n, name);
      historyEl.appendChild(li);
    }
  }

  function hideBanner() {
    banner.classList.remove("is-on");
    bannerText.textContent = "";
    fx.classList.remove("go");
    fx.replaceChildren();
  }

  function showBanner(name) {
    bannerText.textContent = "抽中：" + name;
    banner.classList.add("is-on");
  }

  function celebrate() {
    if (motionQuery.matches) return;
    fx.replaceChildren();
    const colors = ["#ffffff", "#ffe7a8", "#b9dcff", "#ffd5e4", "#fff4cc"];
    const count = 28;
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("i");
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 70 + Math.random() * 90;
      piece.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      piece.style.setProperty("--dy", Math.sin(angle) * dist * 0.72 + "px");
      piece.style.setProperty("--rot", (Math.random() * 240 - 120) + "deg");
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 40) + "ms";
      fx.appendChild(piece);
    }
    fx.classList.remove("go");
    void fx.offsetWidth;
    fx.classList.add("go");
  }

  function fadeForGap(gap) {
    if (gap < 280) return 0;
    return Math.min(180, Math.round(gap * 0.16));
  }

  function buildHops(eligible, winner) {
    const hops = [];
    let previous = null;
    HOP_GAPS.forEach((gap, index) => {
      const beforeLand = index === HOP_GAPS.length - 1;
      let id = winner.id;
      if (eligible.length > 1) {
        let guard = 0;
        do {
          id = eligible[randomIndex(eligible.length)].id;
          guard += 1;
        } while (guard < 16 && (id === previous || (beforeLand && id === winner.id)));
      }
      hops.push({
        id,
        gap,
        fade: index === 0 ? 0 : fadeForGap(gap),
      });
      previous = id;
    });
    hops.push({
      id: winner.id,
      gap: 0,
      fade: fadeForGap(HOP_GAPS[HOP_GAPS.length - 1]),
    });
    return hops;
  }

  async function spin() {
    if (state.spinning) return;
    const eligible = eligibleCounties();
    if (!eligible.length) return;
    if (!window.crypto || !crypto.getRandomValues) {
      hint.textContent = "這個瀏覽器無法提供公平的亂數";
      return;
    }
    state.spinning = true;
    state.winnerId = null;
    applyCountyStyles();
    syncControls();
    hideBanner();
    const winner = eligible[randomIndex(eligible.length)];
    const hops = buildHops(eligible, winner);
    for (let i = 0; i < hops.length; i += 1) {
      state.frameId = hops[i].id;
      paintFrame(hops[i].id, hops[i].fade);
      if (hops[i].gap > 0) await sleep(hops[i].gap);
    }
    state.spinning = false;
    state.winnerId = winner.id;
    state.frameId = winner.id;
    state.history.push({ id: winner.id, name: winner.name, color: winner.color });
    applyCountyStyles();
    showBanner(winner.name);
    celebrate();
    renderHistory();
    syncControls();
    if (state.renderDeferred) {
      state.renderDeferred = false;
      scheduleRender();
    }
    showPlace(winner.name);
  }

  const PLACE_QUERY = {
    基隆市: "基隆",
    臺北市: "台北",
    新北市: "新北市板橋",
    桃園市: "桃園",
    新竹市: "新竹市",
    新竹縣: "新竹",
    苗栗縣: "苗栗",
    臺中市: "台中",
    彰化縣: "彰化",
    南投縣: "南投",
    雲林縣: "雲林",
    嘉義市: "嘉義",
    嘉義縣: "嘉義",
    臺南市: "台南",
    高雄市: "高雄",
    屏東縣: "屏東",
    宜蘭縣: "宜蘭",
    花蓮縣: "花蓮",
    臺東縣: "台東",
    澎湖縣: "澎湖",
    金門縣: "金門",
    連江縣: "馬祖",
    小琉球: "小琉球",
    綠島: "綠島",
    蘭嶼: "蘭嶼",
  };

  /* Agoda place ids checked against Taiwan suggestions. Areas use area=, cities use city=. */
  const AGODA_PLACE = {
    基隆市: ["city", 17048],
    臺北市: ["city", 4951],
    新北市: ["area", 80303],
    桃園市: ["city", 8453],
    新竹市: ["city", 24517],
    新竹縣: ["city", 12711],
    苗栗縣: ["city", 287008],
    臺中市: ["city", 12080],
    彰化縣: ["city", 18341],
    南投縣: ["city", 18346],
    雲林縣: ["city", 18352],
    嘉義市: ["city", 11977],
    嘉義縣: ["city", 11977],
    臺南市: ["city", 18347],
    高雄市: ["city", 756],
    屏東縣: ["city", 11459],
    宜蘭縣: ["city", 88773],
    花蓮縣: ["city", 23127],
    臺東縣: ["city", 4740],
    澎湖縣: ["city", 106001],
    金門縣: ["city", 286060],
    連江縣: ["city", 702190],
    小琉球: ["city", 702189],
    綠島: ["city", 702188],
    蘭嶼: ["area", 595069],
  };

  function taipeiISODate(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function shiftISO(iso, days) {
    const parts = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return dt.toISOString().slice(0, 10);
  }

  function currentWeek(date) {
    const today = taipeiISODate(date || new Date());
    const parts = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = shiftISO(today, mondayOffset);
    return { start: start, end: shiftISO(start, 6) };
  }

  function formatDay(iso) {
    return String(iso || "").replaceAll("-", "/");
  }

  function formatSpan(start, end) {
    if (!end || start === end) return formatDay(start);
    if (start.slice(0, 4) === end.slice(0, 4)) {
      return formatDay(start) + "–" + end.slice(5).replaceAll("-", "/");
    }
    return formatDay(start) + "–" + formatDay(end);
  }

  function formatUpdated(stamp) {
    const match = String(stamp || "").match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return "";
    return match[1] + "/" + match[2] + "/" + match[3] + " " + match[4] + ":" + match[5];
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch (error) {
      return "";
    }
    return "";
  }

  function culturePage(uid) {
    const id = String(uid || "").trim();
    if (!id || /[\s<>]/.test(id)) return "";
    return "https://cloud.culture.tw/frontsite/inquiry/eventInquiryAction.do?method=doEventDetail&uid=" + encodeURIComponent(id);
  }

  function eventHref(row) {
    const official = safeUrl(row.sourceWebPromote) || safeUrl(row.webSales);
    if (official) return official;
    const culture = culturePage(row.uid);
    if (culture) return culture;
    const stored = safeUrl(row.url);
    if (stored && stored.indexOf("method=doFindById") === -1) return stored;
    const query = [row.title, row.county].filter(Boolean).join(" ");
    return "https://www.google.com/search?q=" + encodeURIComponent(query);
  }

  function eventCard(row) {
    const card = document.createElement("a");
    card.className = "event";
    card.href = eventHref(row);
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const heading = document.createElement("h3");
    heading.textContent = row.title;
    const meta = document.createElement("p");
    const venue = row.venue ? " · " + row.venue : "";
    meta.textContent = formatSpan(row.start, row.end) + venue;
    card.append(heading, meta);
    if (row.address) {
      const place = document.createElement("p");
      place.textContent = row.address;
      card.appendChild(place);
    }
    const go = document.createElement("span");
    go.className = "event-go";
    go.textContent = "查看活動 ↗";
    card.appendChild(go);
    return card;
  }

  function creditLine(data) {
    if (!data) return "活動資料暫時無法載入";
    const names = (data.sources || []).map((source) => source.name).filter(Boolean);
    const source = names.length ? names.join("、") : "文化部藝文活動開放資料";
    const when = formatUpdated(data.updated);
    return "資料來源：" + source + (when ? " · 更新於 " + when : "");
  }

  function renderEvents(county) {
    const data = state.eventsData;
    const week = currentWeek();
    const categories = (data && data.categories) || [];
    const rows = ((data && data.events) || []).filter((event) =>
      event.county === county && event.start <= week.end && (event.end || event.start) >= week.start
    );
    rows.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "zh-Hant"));
    const groups = new Map();
    rows.forEach((row) => {
      const category = categories.indexOf(row.category) >= 0 ? row.category : "其他";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(row);
    });

    eventsEl.hidden = false;
    eventsTitle.textContent = county + "・這週活動";
    eventsRange.textContent = formatDay(week.start) + "–" + formatDay(week.end) + "（週一至週日）";
    eventsCredit.textContent = creditLine(data);

    const tabs = [];
    if (rows.length) tabs.push(["全部", rows.length]);
    categories.forEach((category) => {
      if (groups.has(category)) tabs.push([category, groups.get(category).length]);
    });
    if (!tabs.some((tab) => tab[0] === state.eventsTab)) state.eventsTab = "全部";

    eventsTabs.replaceChildren();
    tabs.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "events-tab" + (tab[0] === state.eventsTab ? " is-on" : "");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", tab[0] === state.eventsTab ? "true" : "false");
      button.textContent = tab[0] + " " + tab[1];
      button.addEventListener("click", () => {
        if (state.spinning || state.eventsCounty !== county) return;
        state.eventsTab = tab[0];
        renderEvents(county);
      });
      eventsTabs.appendChild(button);
    });

    eventsList.replaceChildren();
    const empty = rows.length === 0;
    eventsEmpty.hidden = !empty;
    eventsEmpty.textContent = "這週暫無活動資料";
    eventsTabs.hidden = empty;
    if (!empty && state.eventsTab === "全部") {
      categories.forEach((category) => {
        const groupRows = groups.get(category);
        if (!groupRows) return;
        const section = document.createElement("section");
        section.className = "event-group";
        const title = document.createElement("h3");
        title.className = "event-group-title";
        title.textContent = category + " " + groupRows.length;
        const cards = document.createElement("div");
        cards.className = "event-cards";
        groupRows.forEach((row) => cards.appendChild(eventCard(row)));
        section.append(title, cards);
        eventsList.appendChild(section);
      });
    } else if (!empty) {
      const cards = document.createElement("div");
      cards.className = "event-cards";
      (groups.get(state.eventsTab) || []).forEach((row) => cards.appendChild(eventCard(row)));
      eventsList.appendChild(cards);
    }
  }

  function placeQuery(county) {
    return PLACE_QUERY[county] || county;
  }

  function withParams(base, params) {
    const url = new URL(base);
    Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
    return url.href;
  }

  function stayLinksFor(county) {
    const query = placeQuery(county);
    const start = taipeiISODate(new Date());
    const end = shiftISO(start, 1);
    const agoda = AGODA_PLACE[county] || ["city", ""];
    const agodaParams = {
      checkIn: start,
      checkOut: end,
      los: "1",
      rooms: "1",
      adults: "2",
      children: "0",
    };
    agodaParams[agoda[0]] = String(agoda[1]);
    return [
      ["Trip.com 住宿", withParams("https://tw.trip.com/hotels/list", {
        locale: "zh-TW",
        curr: "TWD",
        checkin: start,
        checkout: end,
        crn: "1",
        adult: "2",
        children: "0",
        searchWord: query,
        searchType: "CT",
      })],
      ["Booking.com", withParams("https://www.booking.com/searchresults.zh-tw.html", {
        ss: query,
        checkin: start,
        checkout: end,
        group_adults: "2",
        no_rooms: "1",
        group_children: "0",
        lang: "zh-tw",
      })],
      ["Agoda", withParams("https://www.agoda.com/zh-tw/search", agodaParams)],
      ["Trip.com 租車", withParams("https://tw.trip.com/carhire/", {
        locale: "zh-TW",
        keyword: query,
      })],
      ["和運租車", "https://www.easyrent.com.tw/rent-service.html"],
    ];
  }

  function renderStay(county) {
    stayLinks.replaceChildren();
    stayLinksFor(county).forEach((item) => {
      const link = document.createElement("a");
      link.className = "stay-link";
      link.href = item[1];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const hint = document.createElement("span");
      hint.textContent = "↗";
      link.replaceChildren(document.createTextNode(item[0]), hint);
      stayLinks.appendChild(link);
    });
  }

  function spotCard(row) {
    const href = safeUrl(row.website) || safeUrl(row.map);
    const card = document.createElement("a");
    card.className = "event spot-card";
    card.href = href || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(row.name + " " + (row.address || "")));
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    if (safeUrl(row.picture)) {
      const img = document.createElement("img");
      img.src = safeUrl(row.picture);
      img.alt = "";
      card.appendChild(img);
    }
    const heading = document.createElement("h3");
    heading.textContent = row.name;
    const meta = document.createElement("p");
    meta.textContent = row.address || row.town || "";
    card.append(heading, meta);
    if (row.description) {
      const about = document.createElement("p");
      about.textContent = row.description;
      card.appendChild(about);
    }
    const go = document.createElement("span");
    go.className = "event-go";
    go.textContent = safeUrl(row.website) ? "查看景點 ↗" : "地圖 ↗";
    card.appendChild(go);
    return card;
  }

  function renderSpots(county) {
    const data = state.spotData;
    const rows = ((data && data.spots) || []).filter((spot) => spot.county === county);
    const visible = state.spotsExpanded ? rows : rows.slice(0, 12);
    spotsList.replaceChildren();
    visible.forEach((row) => spotsList.appendChild(spotCard(row)));
    const empty = !rows.length;
    spotsEmpty.hidden = !empty;
    spotsEmpty.textContent = data || state.spotFailed ? "暫無景點資料" : "景點資料載入中";
    spotsList.hidden = empty;
    spotsMore.hidden = empty || rows.length <= 12 || state.spotsExpanded;
    spotsMore.textContent = "顯示更多（" + rows.length + "）";
    if (!data) {
      spotsCredit.textContent = state.spotFailed ? "景點資料暫時無法載入" : "";
      return;
    }
    const when = formatUpdated(data.updated);
    const source = (data.source && data.source.name) || "交通部觀光署景點開放資料";
    spotsCredit.textContent = "資料來源：" + source + (when ? " · 更新於 " + when : "");
  }

  function setPlacePane(name) {
    state.placePane = name;
    paneEvents.hidden = name !== "events";
    paneSpots.hidden = name !== "spots";
    paneStay.hidden = name !== "stay";
    placeTabs.querySelectorAll("[data-pane]").forEach((button) => {
      const on = button.getAttribute("data-pane") === name;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function showPlace(county) {
    if (!county || state.spinning) return;
    if (state.eventsCounty !== county) {
      state.eventsTab = "全部";
      state.spotsExpanded = false;
    }
    state.eventsCounty = county;
    if (lookupEl.value !== county) lookupEl.value = county;
    const paint = () => {
      if (state.spinning || state.eventsCounty !== county) return;
      eventsEl.hidden = false;
      renderEvents(county);
      renderSpots(county);
      renderStay(county);
    };
    if ((state.eventsData || state.eventsFailed) && (state.spotData || state.spotFailed)) {
      paint();
      return;
    }
    eventsEl.hidden = false;
    eventsTitle.textContent = county;
    eventsRange.textContent = "";
    if (!state.eventsData && !state.eventsFailed) {
      eventsTabs.replaceChildren();
      eventsList.replaceChildren();
      eventsEmpty.hidden = false;
      eventsEmpty.textContent = "活動資料載入中";
      eventsCredit.textContent = "";
    }
    if (!state.spotData && !state.spotFailed) {
      spotsList.replaceChildren();
      spotsEmpty.hidden = false;
      spotsEmpty.textContent = "景點資料載入中";
    }
    Promise.all([state.eventsPromise, state.spotPromise]).then(paint);
  }

  function hideEvents() {
    state.eventsCounty = "";
    state.spotsExpanded = false;
    eventsEl.hidden = true;
    if (lookupEl.value) lookupEl.value = "";
  }

  function resetAll() {
    if (state.spinning) return;
    state.history = [];
    state.winnerId = null;
    state.frameId = null;
    hideBanner();
    paintFrame(null, 0);
    applyCountyStyles();
    renderHistory();
    syncControls();
    hideEvents();
  }

  async function init() {
    if (!window.d3 || !window.topojson) {
      statusEl.textContent = "地圖載入失敗，請重新整理";
      return;
    }
    const [response, islandResponse] = await Promise.all([
      fetch("./data/counties-10t.json"),
      fetch("./data/islands.json"),
    ]);
    if (!response.ok) throw new Error("map data " + response.status);
    if (!islandResponse.ok) throw new Error("island data " + islandResponse.status);
    const topo = await response.json();
    const islands = await islandResponse.json();
    state.counties = buildCounties(topo, islands);
    statusEl.remove();
    syncControls();
    scheduleRender();
    state.eventsPromise = fetch("./data/events.json?v=11", { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        state.eventsData = data && Array.isArray(data.events) ? data : null;
        state.eventsFailed = !state.eventsData;
        return state.eventsData;
      })
      .catch(() => {
        state.eventsData = null;
        state.eventsFailed = true;
        return null;
      });
    state.spotPromise = fetch("./data/spots.json?v=11", { cache: "no-cache" })
      .then((spotResponse) => (spotResponse.ok ? spotResponse.json() : null))
      .then((data) => {
        state.spotData = data && Array.isArray(data.spots) ? data : null;
        state.spotFailed = !state.spotData;
        return state.spotData;
      })
      .catch(() => {
        state.spotData = null;
        state.spotFailed = true;
        return null;
      });
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(mapEl);
    window.addEventListener("resize", scheduleRender);
  }

  drawBtn.addEventListener("click", () => {
    spin().catch((error) => {
      console.error(error);
      state.spinning = false;
      applyCountyStyles();
      syncControls();
      hint.textContent = "抽獎沒有完成，請再試一次";
    });
  });
  lookupEl.addEventListener("change", () => {
    if (state.spinning) return;
    if (!lookupEl.value) {
      hideEvents();
      return;
    }
    showPlace(lookupEl.value);
  });
  placeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pane]");
    if (!button) return;
    setPlacePane(button.getAttribute("data-pane"));
  });
  spotsMore.addEventListener("click", () => {
    state.spotsExpanded = true;
    if (state.eventsCounty) renderSpots(state.eventsCounty);
  });
  mapEl.addEventListener("click", (event) => {
    if (state.spinning) return;
    const node = event.target.closest("[data-name]");
    if (!node || !mapEl.contains(node)) return;
    const name = node.getAttribute("data-name");
    if (!name || ![...lookupEl.options].some((option) => option.value === name)) return;
    showPlace(name);
  });
  resetBtn.addEventListener("click", resetAll);
  norepeat.addEventListener("change", () => {
    applyCountyStyles();
    syncControls();
  });

  init().catch((error) => {
    console.error(error);
    statusEl.textContent = "地圖載入失敗，請重新整理";
  });
}());
