/**
 * Township names from the vendored taiwan-atlas towns-10t.json.
 * Matching prefers a full 鄉鎮市區 name, then disambiguates duplicates
 * (東區, 大安區, …) with the county already found in the text.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "towns-10t.json");

const ALIASES = [
  ["琉球鄉", ["小琉球", "琉球鄉", "琉球嶼"], ["屏東縣", "小琉球"]],
  ["綠島鄉", ["綠島鄉", "綠島"], ["臺東縣", "綠島"]],
  ["蘭嶼鄉", ["蘭嶼鄉", "蘭嶼"], ["臺東縣", "蘭嶼"]],
];

export function normPlace(value) {
  return String(value || "").replaceAll("台", "臺").replace(/\s+/g, "");
}

export function loadTownIndex() {
  const topo = JSON.parse(readFileSync(FILE, "utf8"));
  const geometries = topo.objects.towns.geometries;
  const towns = geometries.map((geometry) => ({
    name: normPlace(geometry.properties.TOWNNAME),
    county: normPlace(geometry.properties.COUNTYNAME),
  }));
  const counts = new Map();
  towns.forEach((town) => counts.set(town.name, (counts.get(town.name) || 0) + 1));
  return { towns, counts };
}

export function matchTown(text, countyGuess, index) {
  const hay = normPlace(text);
  const county = normPlace(countyGuess);
  if (!hay) return "";
  for (const [name, keys, counties] of ALIASES) {
    if (!keys.some((key) => hay.includes(normPlace(key)))) continue;
    if (!county || counties.includes(county) || hay.includes(normPlace(counties[0]))) return name;
  }
  const hits = index.towns.filter((town) => hay.includes(town.name));
  if (!hits.length) return "";
  hits.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, "zh-Hant"));
  const top = hits.filter((town) => town.name.length === hits[0].name.length);
  if (top.length === 1) return top[0].name;
  const scoped = top.filter((town) => town.county === county || hay.includes(town.county));
  if (scoped.length === 1) return scoped[0].name;
  return "";
}

/* Used when a public card only names the city, and the title still
   contains one township of that city without the 區鄉鎮市 suffix. */
export function matchTownLoose(text, countyGuess, index) {
  const exact = matchTown(text, countyGuess, index);
  if (exact) return exact;
  const hay = normPlace(text);
  const county = normPlace(countyGuess);
  if (!hay || !county) return "";
  const hits = index.towns.filter((town) => {
    if (town.county !== county) return false;
    const short = town.name.replace(/(區|鄉|鎮|市)$/, "");
    return short.length >= 2 && hay.includes(short);
  });
  if (hits.length === 1) return hits[0].name;
  return "";
}
