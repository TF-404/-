#!/usr/bin/env node
/**
 * Pull Tourism Administration scenic spots and write data/spots.json.
 * No API key. The zip is the public data.gov.tw dataset 7777 download.
 * Islands are matched by township before the parent county.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadTownIndex, matchTown, normPlace } from "./towns.mjs";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "spots.json");
const ZIP_URL = "https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip";
const SOURCE = {
  name: "交通部觀光署景點開放資料",
  url: "https://data.gov.tw/dataset/7777",
  download: ZIP_URL,
};
const PER_COUNTY = 36;

const PLACES = [
  ["小琉球", ["小琉球", "琉球鄉"]],
  ["綠島", ["綠島"]],
  ["蘭嶼", ["蘭嶼"]],
  ["基隆市", ["基隆市", "基隆"]],
  ["臺北市", ["臺北市", "臺北"]],
  ["新北市", ["新北市", "新北"]],
  ["桃園市", ["桃園市", "桃園"]],
  ["新竹市", ["新竹市"]],
  ["新竹縣", ["新竹縣"]],
  ["苗栗縣", ["苗栗縣", "苗栗"]],
  ["臺中市", ["臺中市", "臺中"]],
  ["彰化縣", ["彰化縣", "彰化"]],
  ["南投縣", ["南投縣", "南投"]],
  ["雲林縣", ["雲林縣", "雲林"]],
  ["嘉義市", ["嘉義市"]],
  ["嘉義縣", ["嘉義縣"]],
  ["臺南市", ["臺南市", "臺南"]],
  ["高雄市", ["高雄市", "高雄"]],
  ["屏東縣", ["屏東縣", "屏東"]],
  ["宜蘭縣", ["宜蘭縣", "宜蘭"]],
  ["花蓮縣", ["花蓮縣", "花蓮"]],
  ["臺東縣", ["臺東縣", "臺東"]],
  ["澎湖縣", ["澎湖縣", "澎湖"]],
  ["金門縣", ["金門縣", "金門"]],
  ["連江縣", ["連江縣", "馬祖"]],
];

function taipeiStamp(date = new Date()) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return formatted.replace(" ", "T") + "+08:00";
}

function norm(value) {
  return String(value || "").replaceAll("台", "臺").replace(/\s+/g, "");
}

function locate(text) {
  const haystack = norm(text);
  if (!haystack) return "";
  for (const [name, keys] of PLACES) {
    if (keys.some((key) => haystack.includes(norm(key)))) return name;
  }
  return "";
}

function safeHttp(value) {
  const raw = String(value || "").trim();
  const found = raw.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = found ? found[0].replace(/[),.;]+$/, "") : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

function shortText(value) {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= 90) return text;
  return text.slice(0, 89) + "…";
}

function picturePair(url) {
  if (!url) return { picture: "", pictureSm: "", pictureW: 0 };
  const imagePath = url.match(/^(https?:\/\/[^/?#]+)\/image\/(\d+)\/\d+x\d+\/?$/);
  if (imagePath) {
    return {
      picture: imagePath[1] + "/image/" + imagePath[2] + "/1024x768",
      pictureSm: imagePath[1] + "/image/" + imagePath[2] + "/640x480",
      pictureW: 1024,
    };
  }
  if (url.includes("/640x480_")) {
    return {
      picture: url.replace("/640x480_", "/1920x1080_"),
      pictureSm: url,
      pictureW: 1600,
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return { picture: url, pictureSm: "", pictureW: 0 };
  }
  if (parsed.searchParams.has("sizetype")) {
    const large = new URL(url);
    const small = new URL(url);
    large.searchParams.set("sizetype", "3");
    small.searchParams.set("sizetype", "2");
    return { picture: large.href, pictureSm: small.href, pictureW: 1024 };
  }
  if (parsed.searchParams.has("w")) {
    const current = Number(parsed.searchParams.get("w"));
    if (Number.isFinite(current) && current < 1200) {
      const large = new URL(url);
      const small = new URL(url);
      large.searchParams.set("w", "1600");
      if (!(current >= 480)) small.searchParams.set("w", "640");
      return { picture: large.href, pictureSm: small.href, pictureW: 1200 };
    }
  }
  return { picture: url, pictureSm: "", pictureW: 0 };
}

function mapLink(name, address, lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (latitude > 21 && latitude < 27 && longitude > 118 && longitude < 123) {
    return "https://www.google.com/maps/search/?api=1&query=" + latitude + "," + longitude;
  }
  const query = [name, address].filter(Boolean).join(" ");
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

async function downloadJson() {
  const response = await fetch(ZIP_URL, {
    headers: { "User-Agent": "taiwan-map-lottery-spots" },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("scenic zip HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "spots-"));
  const zipPath = join(dir, "attraction.zip");
  try {
    await writeFile(zipPath, bytes);
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath, "AttractionList.json"], {
      maxBuffer: 40 * 1024 * 1024,
      encoding: "buffer",
    });
    var text = stdout.toString("utf8").replace(/^\uFEFF/, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.Attractions)) throw new Error("scenic JSON has no Attractions");
  return data;
}

function collect(data, towns) {
  const grouped = new Map();
  let skipped = 0;
  for (const item of data.Attractions) {
    if (String(item.ServiceStatus) !== "1") continue;
    if (String(item.IsPublicAccess) === "0") continue;
    const name = String(item.AttractionName || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const addressInfo = item.PostalAddress || {};
    const city = String(addressInfo.City || "");
    const town = String(addressInfo.Town || "");
    const street = String(addressInfo.StreetAddress || "").replace(/\s+/g, " ").trim();
    const address = [city, town, street].filter(Boolean).join("");
    const county = locate([town, city, street, name].join(" "));
    if (!county) {
      skipped += 1;
      continue;
    }
    const images = Array.isArray(item.Images) ? item.Images : [];
    const rawPicture = images.map((image) => safeHttp(image && image.URL)).find(Boolean) || "";
    const photo = picturePair(rawPicture);
    const website = safeHttp(item.WebsiteURL);
    const canonical = matchTown([town, address, name].join(" "), county, towns) || normPlace(town);
    const spot = {
      name,
      description: shortText(item.Description),
      town: canonical,
      address,
      picture: photo.picture,
      website,
      map: mapLink(name, address, item.PositionLat, item.PositionLon),
    };
    if (photo.pictureSm && photo.pictureSm !== photo.picture) {
      spot.pictureSm = photo.pictureSm;
      spot.pictureW = photo.pictureW;
    }
    if (!grouped.has(county)) grouped.set(county, []);
    grouped.get(county).push(spot);
  }
  const spots = [];
  for (const [county, rows] of grouped) {
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      const key = row.name + "|" + row.address;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
    unique.sort((a, b) =>
      Number(!a.picture) - Number(!b.picture)
      || Number(!a.website) - Number(!b.website)
      || a.name.localeCompare(b.name, "zh-Hant"));
    unique.slice(0, PER_COUNTY).forEach((row) => spots.push({ county, ...row }));
  }
  spots.sort((a, b) => a.county.localeCompare(b.county, "zh-Hant") || a.name.localeCompare(b.name, "zh-Hant"));
  return { spots, skipped };
}

async function main() {
  const data = await downloadJson();
  const towns = loadTownIndex();
  const { spots, skipped } = collect(data, towns);
  if (spots.length < 100) throw new Error("only " + spots.length + " scenic spots");
  const payload = {
    updated: taipeiStamp(),
    source: SOURCE,
    spots,
  };
  await writeFile(OUT, JSON.stringify(payload) + "\n");
  const counts = {};
  for (const spot of spots) counts[spot.county] = (counts[spot.county] || 0) + 1;
  const withTown = spots.filter((spot) => spot.town).length;
  const withPicture = spots.filter((spot) => spot.picture).length;
  const withVariant = spots.filter((spot) => spot.pictureSm).length;
  console.log("source spots " + data.Attractions.length + ", kept " + spots.length + ", unmapped " + skipped);
  console.log("town matched " + withTown + " / " + spots.length);
  console.log("picture variants " + withVariant + " / " + withPicture);
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => name + " " + n).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
