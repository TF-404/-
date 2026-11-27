/**
 * Extra public event pages. No keys and no login.
 * A handful of GET requests, with a short pause between Accupass pages.
 * If a site answers with a block or a challenge, that source is skipped.
 */

const USER_AGENT = "taiwan-map-lottery/1.0 (+https://github.com/TF-404/taiwan-map-lottery)";

const ACCUPASS_PAGES = [
  "https://www.accupass.com/?area=north&channel=0",
  "https://www.accupass.com/?area=center&channel=0",
  "https://www.accupass.com/?area=south&channel=0",
  "https://www.accupass.com/search",
];

const CITY = new Map([
  ["taipei city", "臺北市"],
  ["new taipei city", "新北市"],
  ["taoyuan city", "桃園市"],
  ["taichung city", "臺中市"],
  ["tainan city", "臺南市"],
  ["kaohsiung city", "高雄市"],
  ["keelung city", "基隆市"],
  ["hsinchu city", "新竹市"],
  ["hsinchu county", "新竹縣"],
  ["miaoli county", "苗栗縣"],
  ["changhua county", "彰化縣"],
  ["nantou county", "南投縣"],
  ["yunlin county", "雲林縣"],
  ["chiayi city", "嘉義市"],
  ["chiayi county", "嘉義縣"],
  ["pingtung county", "屏東縣"],
  ["yilan county", "宜蘭縣"],
  ["hualien county", "花蓮縣"],
  ["taitung county", "臺東縣"],
  ["penghu county", "澎湖縣"],
  ["kinmen county", "金門縣"],
  ["lienchiang county", "連江縣"],
  ["matsu", "連江縣"],
  ["xiaoliuqiu", "小琉球"],
  ["liuqiu township", "小琉球"],
  ["green island", "綠島"],
  ["ludao", "綠島"],
  ["lanyu", "蘭嶼"],
  ["orchid island", "蘭嶼"],
]);

const PUBLIC_KEYWORDS = [
  ["節慶/傳統", ["節慶", "廟會", "迎神", "繞境", "祭典", "媽祖"]],
  ["市集/活動", ["市集", "手作市", "園遊會", "嘉年華", "快閃"]],
  ["運動/戶外", ["路跑", "馬拉松", "健行", "登山", "單車", "鐵人", "跑步"]],
  ["講座/研習", ["工作坊", "講座", "研習", "課程", "營隊", "夏令營", "冬令營", "寒令營", "手作"]],
  ["展覽", ["展覽", "博覽", "個展", "聯展"]],
  ["音樂/表演", ["音樂會", "演唱會", "演奏", "演出"]],
  ["戲劇/舞蹈", ["戲劇", "舞蹈", "劇場"]],
  ["親子", ["親子"]],
];

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function iso(year, month, day) {
  return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function parseAccuWhen(text) {
  const full = text.match(/(\d{4})\.(\d{2})\.(\d{2})[\s\S]*?-\s*(\d{4})\.(\d{2})\.(\d{2})/);
  if (full) return [iso(full[1], full[2], full[3]), iso(full[4], full[5], full[6])];
  const sameYear = text.match(/(\d{4})\.(\d{2})\.(\d{2})[\s\S]*?-\s*(\d{2})\.(\d{2})/);
  if (sameYear) {
    const start = iso(sameYear[1], sameYear[2], sameYear[3]);
    let end = iso(sameYear[1], sameYear[4], sameYear[5]);
    if (end < start) end = iso(String(Number(sameYear[1]) + 1), sameYear[4], sameYear[5]);
    return [start, end];
  }
  const day = text.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!day) return ["", ""];
  const start = iso(day[1], day[2], day[3]);
  return [start, start];
}

function categorizePublic(text) {
  for (const [category, words] of PUBLIC_KEYWORDS) {
    if (words.some((word) => text.includes(word))) return category;
  }
  return "其他";
}

function onlineOnly(title, place, kind) {
  if (kind === "online") return true;
  if (/online event/i.test(place)) return true;
  const text = title + place;
  const saysOnline = /線上|直播|視訊|zoom|google meet/i.test(text);
  const saysPlace = CITY.has(place.trim().toLowerCase()) || /[市縣區鄉鎮]/.test(place);
  return saysOnline && !saysPlace;
}

function blocked(status, body) {
  if (status === 401 || status === 403 || status === 429) return true;
  return /Just a moment|Attention Required|cf-mitigated|challenge-platform|cf-browser-verification/i.test(body.slice(0, 2500));
}

async function getPublic(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/json,application/atom+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    refused: blocked(response.status, text) || !response.ok,
  };
}

function parseAccupass(html, context) {
  const pattern = /EventCard_event-time__[^"]*">([^<]+)<\/p>[\s\S]*?href="(\/event\/\d+)[^"]*"[\s\S]*?EventCard_event-name__[^"]*">([^<]*)<\/p>[\s\S]*?EventPlaceType_event-(online|offline)__[^"]*"><\/i><span>([^<]*)<\/span>/gi;
  const events = [];
  for (const match of html.matchAll(pattern)) {
    const when = decode(match[1]);
    const path = match[2];
    const title = decode(match[3]);
    const kind = match[4].toLowerCase();
    const place = decode(match[5]);
    if (!title || onlineOnly(title, place, kind)) continue;
    const [start, end] = parseAccuWhen(when);
    if (!start || !context.overlaps(start, end || start, context.window.from, context.window.to)) continue;
    const mapped = CITY.get(place.toLowerCase()) || "";
    const county = context.locate(title + " " + mapped) || mapped;
    if (!county) continue;
    const town = context.matchTown(title + " " + place, county, context.towns);
    events.push({
      title,
      start,
      end: end || start,
      venue: "",
      address: mapped || county,
      county,
      town,
      source: "Accupass",
      category: categorizePublic(title),
      url: "https://www.accupass.com" + path,
      link: "official",
      sourceWebPromote: "https://www.accupass.com" + path,
      webSales: "",
      uid: "",
    });
  }
  return events;
}

function stripTags(value) {
  return decode(String(value || "").replace(/<[^>]+>/g, " "));
}

function parseKktix(text, context) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = Array.isArray(payload) ? payload : (payload.entry || payload.entries || []);
  if (!Array.isArray(entries)) return [];
  const events = [];
  for (const entry of entries) {
    const title = stripTags(entry.title || entry.name || "");
    const body = stripTags([entry.summary, entry.content, entry.description, entry.location].filter(Boolean).join(" "));
    const url = String(entry.url || entry.link || "");
    if (!title || !/^https?:\/\//.test(url)) continue;
    const dates = [...body.matchAll(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)].map((item) => iso(item[1], item[2], item[3]));
    if (!dates.length) continue;
    dates.sort();
    const start = dates[0];
    const end = dates[dates.length - 1];
    if (!context.overlaps(start, end, context.window.from, context.window.to)) continue;
    const county = context.locate(title + " " + body);
    if (!county) continue;
    events.push({
      title,
      start,
      end,
      venue: "",
      address: body.slice(0, 80),
      county,
      town: context.matchTown(title + " " + body, county, context.towns),
      source: "KKTIX",
      category: categorizePublic(title + body),
      url,
      link: "official",
      sourceWebPromote: url,
      webSales: "",
      uid: "",
    });
  }
  return events;
}

function parseBeclass(html, context) {
  const pattern = /<a[^>]+href="(https?:\/\/www\.beclass\.com\/[^"]+|\/(?:rid|class)[^"]*)"[^>]*>([^<]{4,80})<\/a>/gi;
  const events = [];
  for (const match of html.matchAll(pattern)) {
    const title = decode(match[2]);
    if (!/[\u4e00-\u9fff]/.test(title)) continue;
    const around = html.slice(Math.max(0, match.index - 180), match.index + 240);
    const dates = [...stripTags(around).matchAll(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)].map((item) => iso(item[1], item[2], item[3]));
    if (!dates.length) continue;
    dates.sort();
    const start = dates[0];
    const end = dates[dates.length - 1];
    if (!context.overlaps(start, end, context.window.from, context.window.to)) continue;
    const blob = title + " " + stripTags(around);
    const county = context.locate(blob);
    if (!county) continue;
    const href = match[1].startsWith("http") ? match[1] : "https://www.beclass.com" + match[1];
    events.push({
      title,
      start,
      end,
      venue: "",
      address: county,
      county,
      town: context.matchTown(blob, county, context.towns),
      source: "BeClass",
      category: categorizePublic(blob),
      url: href.split("?")[0],
      link: "official",
      sourceWebPromote: href.split("?")[0],
      webSales: "",
      uid: "",
    });
  }
  return events;
}

export async function fetchExtraEvents(context) {
  const events = [];
  const failures = [];
  const sources = [];

  let accupassBlocked = false;
  for (let index = 0; index < ACCUPASS_PAGES.length; index += 1) {
    if (accupassBlocked) break;
    if (index > 0) await pause(700);
    const url = ACCUPASS_PAGES[index];
    try {
      const got = await getPublic(url);
      if (got.refused) {
        accupassBlocked = true;
        failures.push({
          name: "Accupass",
          url,
          status: got.status,
          reason: "公開頁拒絕自動讀取",
        });
        break;
      }
      events.push(...parseAccupass(got.text, context));
    } catch (error) {
      accupassBlocked = true;
      failures.push({
        name: "Accupass",
        url,
        status: 0,
        reason: error.message || "讀取失敗",
      });
    }
  }
  if (!accupassBlocked) {
    sources.push({ name: "Accupass", url: "https://www.accupass.com/search" });
  }

  for (const target of [
    { name: "KKTIX", url: "https://kktix.com/events.json", parse: parseKktix, backup: "https://kktix.com/events.atom" },
    { name: "BeClass", url: "https://www.beclass.com/", parse: parseBeclass, backup: "" },
  ]) {
    await pause(700);
    try {
      let got = await getPublic(target.url);
      if (got.refused && target.backup) {
        await pause(700);
        const second = await getPublic(target.backup);
        if (!second.refused) got = second;
      }
      if (got.refused) {
        failures.push({
          name: target.name,
          url: target.url,
          status: got.status,
          reason: "Cloudflare 擋下自動讀取，沒有再改用其他方式",
        });
        continue;
      }
      const parsed = target.parse(got.text, context);
      if (!parsed.length) {
        failures.push({
          name: target.name,
          url: target.url,
          status: got.status,
          reason: "公開頁有回應，但沒有可對應的活動欄位",
        });
        continue;
      }
      events.push(...parsed);
      sources.push({ name: target.name, url: target.url });
    } catch (error) {
      failures.push({
        name: target.name,
        url: target.url,
        status: 0,
        reason: error.message || "讀取失敗",
      });
    }
  }

  return { events, failures, sources };
}
