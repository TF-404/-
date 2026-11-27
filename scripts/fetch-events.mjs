#!/usr/bin/env node
/**
 * Pull public Ministry of Culture show listings and write data/events.json.
 * No API key. Dates are Asia/Taipei. The file keeps shows that overlap
 * this week and the next (about two weeks). The page filters to the
 * current Monday–Sunday itself, so a stale file still shows the right week.
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");

const SOURCE = {
  name: "文化部藝文活動開放資料",
  url: "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=all",
};

const CATEGORY_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "11", "13", "15", "17", "19"];

const CATEGORIES = [
  "展覽",
  "音樂/表演",
  "戲劇/舞蹈",
  "市集/活動",
  "親子",
  "節慶/傳統",
  "講座/研習",
  "運動/戶外",
  "其他",
];

const BY_CODE = {
  1: "音樂/表演",
  2: "戲劇/舞蹈",
  3: "戲劇/舞蹈",
  4: "親子",
  5: "音樂/表演",
  6: "展覽",
  7: "講座/研習",
  8: "其他",
  11: "音樂/表演",
  13: "其他",
  14: "其他",
  15: "其他",
  17: "音樂/表演",
  19: "講座/研習",
};

const KEYWORD_RULES = [
  ["節慶/傳統", ["節慶", "廟會", "迎神", "繞境", "祭典", "媽祖", "王爺", "元宵", "端午", "中秋"]],
  ["市集/活動", ["市集", "手作市", "園遊會", "嘉年華", "快閃"]],
  ["運動/戶外", ["馬拉松", "路跑", "健行", "登山", "單車", "鐵人", "運動會"]],
];

/* Islands before the county that contains them. 新竹市 / 嘉義市 before the county. */
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

function taipeiToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function dataWindow(date = new Date()) {
  const today = taipeiToday(date);
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const from = shiftISO(today, mondayOffset);
  const to = shiftISO(from, 13);
  return { from, to };
}

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

function parseDate(value) {
  const match = String(value || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function overlaps(start, end, from, to) {
  if (!start) return false;
  const finish = end || start;
  return start <= to && finish >= from;
}

function locate(text) {
  const haystack = norm(text);
  if (!haystack) return "";
  for (const [name, keys] of PLACES) {
    if (keys.some((key) => haystack.includes(norm(key)))) return name;
  }
  return "";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categorize(code, text) {
  for (const [category, words] of KEYWORD_RULES) {
    if (words.some((word) => text.includes(word))) return category;
  }
  return BY_CODE[String(code)] || "其他";
}

function safeHttp(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

async function fetchCategory(id) {
  const url = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=" + id;
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "taiwan-map-lottery-events" },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("category " + id + " HTTP " + response.status);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("category " + id + " was not a list");
  return data;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function collect(shows, window) {
  const events = [];
  let skipped = 0;
  for (const show of shows) {
    const title = String(show.title || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const showStart = parseDate(show.startDate);
    const showEnd = parseDate(show.endDate) || showStart;
    const infos = Array.isArray(show.showInfo) && show.showInfo.length ? show.showInfo : [null];
    const description = stripHtml(show.descriptionFilterHtml).slice(0, 400);
    const page = safeHttp(show.sourceWebPromote)
      || (show.UID
        ? "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindById&UID=" + encodeURIComponent(show.UID)
        : SOURCE.url);
    for (const info of infos) {
      const start = parseDate(info && info.time) || showStart;
      const end = parseDate(info && info.endTime) || showEnd || start;
      if (!overlaps(start, end, window.from, window.to)) continue;
      const placeText = [
        info && info.location,
        info && info.locationName,
        show.showUnit,
        title,
      ].filter(Boolean).join(" ");
      const county = locate(placeText);
      if (!county) {
        skipped += 1;
        continue;
      }
      const venue = String((info && info.locationName) || show.showUnit || "").replace(/\s+/g, " ").trim();
      const address = String((info && info.location) || "").replace(/\s+/g, " ").trim();
      const category = categorize(show.category, title + venue + description);
      events.push({
        title,
        start,
        end: end || start,
        venue,
        address,
        county,
        category,
        url: page,
      });
    }
  }
  return { events, skipped };
}

function dedupe(events) {
  const seen = new Map();
  for (const event of events) {
    const key = [event.county, event.title, event.start, event.end, event.venue].join("|");
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, event);
      continue;
    }
    if (prev.category === "其他" && event.category !== "其他") seen.set(key, event);
  }
  return [...seen.values()].sort((a, b) =>
    a.county.localeCompare(b.county, "zh-Hant")
    || a.start.localeCompare(b.start)
    || a.title.localeCompare(b.title, "zh-Hant"));
}

async function main() {
  const window = dataWindow();
  const batches = await mapPool(CATEGORY_IDS, 4, async (id) => {
    const shows = await fetchCategory(id);
    console.log("category " + id + ": " + shows.length + " shows");
    return shows;
  });
  const merged = [];
  const seenUid = new Set();
  for (const shows of batches) {
    for (const show of shows) {
      const uid = String(show.UID || "");
      if (uid && seenUid.has(uid)) continue;
      if (uid) seenUid.add(uid);
      merged.push(show);
    }
  }
  const { events, skipped } = collect(merged, window);
  const unique = dedupe(events);
  if (!unique.length) {
    throw new Error("no events overlapped " + window.from + ".." + window.to);
  }
  const payload = {
    updated: taipeiStamp(),
    timezone: "Asia/Taipei",
    window,
    sources: [SOURCE],
    categories: CATEGORIES,
    events: unique,
  };
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
  const counts = {};
  for (const event of unique) counts[event.county] = (counts[event.county] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log("window " + window.from + " .. " + window.to);
  console.log("kept " + unique.length + ", unmapped showings " + skipped);
  console.log("counties " + ranked.map(([name, n]) => name + " " + n).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
