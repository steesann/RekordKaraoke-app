/**
 * Cover Art Provider
 * MusicBrainz (find release MBID) -> Cover Art Archive (download front cover)
 */

const fs = require("fs");
const path = require("path");
const logger = require("../../util/logger");
const { makeSafeFilename, cleanForSearch } = require("../../util/normalize");

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "http://coverartarchive.org";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dns = require("dns");

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}


function escapeLucenePhrase(s) {
  // минимально, но достаточно: кавычки и обратный слеш
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function qdur(durationMs) {
  // MusicBrainz: qdur = duration(ms)/2000 округлённо
  return Math.round(durationMs / 2000);
}

class CoverProvider {
  constructor(config) {
    this.coversDir = config.paths?.covers || "./data/covers";
    this.timeout = config.timeout || 8000;

    // Обязательное: идентификация приложения для MusicBrainz
    this.userAgent =
      config.musicbrainz?.userAgent || "rk-karaoke/0.0.2 (alpha) (yrkiy.evgeny@gmail.com)";

    // простейший rate-limit для MB: 1 req/sec
    this._mbNextAt = 0;

    // дедуп параллельных запросов на один и тот же файл
    this._inFlight = new Map();
  }

  async init() {
    await fs.promises.mkdir(this.coversDir, { recursive: true });
  }

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      const cause = err?.cause;
      const causeMsg =
        cause?.code || cause?.message || (cause ? String(cause) : "no-cause");
      logger.warn(`Fetch failed: ${url} :: ${err.message} :: ${causeMsg}`);
      throw err;
    } finally {
      clearTimeout(t);
    }
  }


  async _mbFetch(url) {
    const now = Date.now();
    if (now < this._mbNextAt) await sleep(this._mbNextAt - now);
    this._mbNextAt = Date.now() + 1100;

    return this._fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
    });
  }

  async _fileExists(p, minBytes = 1024) {
    try {
      const st = await fs.promises.stat(p);
      return st.isFile() && st.size >= minBytes;
    } catch {
      return false;
    }
  }

  async getCover(artist, title, durationMs) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    const publicUrl = `/covers/${filename}`;

    if (await this._fileExists(filePath)) return publicUrl;

    // дедуп: если уже качаем — просто ждём
    if (this._inFlight.has(filename)) return await this._inFlight.get(filename);

    const task = (async () => {
      const releaseMbid = await this._findReleaseMbid(artist, title, durationMs);
      if (!releaseMbid) return null;

      const imageUrl = await this._findCaaFrontImageUrl(releaseMbid);
      if (!imageUrl) return null;

      const ok = await this._downloadImageAtomic(imageUrl, filePath);
      return ok ? publicUrl : null;
    })();

    this._inFlight.set(filename, task);
    try {
      return await task;
    } finally {
      this._inFlight.delete(filename);
    }
  }

  async _findReleaseMbid(artist, title, durationMs) {
    const a = escapeLucenePhrase(cleanForSearch(artist));
    const t = escapeLucenePhrase(cleanForSearch(title));

    let query = `artist:"${a}" AND recording:"${t}"`;
    if (Number.isFinite(durationMs)) query += ` AND qdur:${qdur(durationMs)}`;
    query += ` AND status:official`;

    const url = new URL(`${MB_BASE}/recording/`);
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("inc", "releases"); // чтобы releases пришли сразу

    const res = await this._mbFetch(url.toString());
    if (!res.ok) {
      logger.warn(`MusicBrainz error ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }

    const data = await res.json();
    const rec = data.recordings?.[0];
    const releases = rec?.releases;
    if (!releases?.length) return null;

    // простая эвристика: official релиз > первый попавшийся
    const best =
      releases.find((r) => String(r.status).toLowerCase() === "official") || releases[0];

    return best?.id || null;
  }

  async _findCaaFrontImageUrl(releaseMbid) {
    try{
    // CAA: /release/{mbid}/ возвращает JSON со списком изображений :contentReference[oaicite:4]{index=4}
    const url = `${CAA_BASE}/release/${releaseMbid}`;
    const res = await this._fetchWithTimeout(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const images = Array.isArray(data.images) ? data.images : [];
    if (!images.length) return null;

    const front =
      images.find((img) => img.front === true) ||
      images.find((img) => Array.isArray(img.types) && img.types.includes("Front")) ||
      images[0];

    // берем нормальный размер, если есть
    return front?.thumbnails?.["500"] || front?.image || null;

    } catch (e) {
      logger.warn(`CAA fetch failed for release ${releaseMbid}: ${e.message}`);
      return null;
    }
  }

  async _downloadImageAtomic(url, filePath) {
    const tmp = `${filePath}.tmp`;
    try {
      const res = await this._fetchWithTimeout(url, { headers: { Accept: "image/*" } });
      if (!res.ok) return false;

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/")) return false;

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) return false;

      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, filePath);
      return true;
    } catch (e) {
      fs.promises.unlink(tmp).catch(() => {});
      const cause = e?.cause;
      logger.warn(
  `     Cover download failed: ${e.message}` +
        (cause ? ` :: ${cause.code || cause.message || String(cause)}` : "")
      );
      return false;
    }
  }

  async hasCover(artist, title) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    return await this._fileExists(filePath);
  }
}

module.exports = CoverProvider;
