// TrialBridge backend: zero dependencies, Node 18+.
// Routes: /api/trials (ClinicalTrials.gov v2), /api/research (TinyFish Search + Fetch),
//         /api/saved (snapshots + change detection, JSON-file store).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
try { // minimal .env loader
  for (const l of fs.readFileSync(path.join(__dir, ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const PORT = process.env.PORT || 3000;
const TF_KEY = process.env.TINYFISH_API_KEY;
const CTG = "https://clinicaltrials.gov/api/v2/studies";
const DB_FILE = path.join(__dir, "data", "store.json");

// ---------- tiny JSON store (swap for Supabase/Postgres in production) ----------
const readDb = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return {}; } };
const writeDb = (db) => { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); };

// ---------- ClinicalTrials.gov ----------
const num = (s) => { const m = /(\d+)/.exec(s || ""); return m ? +m[1] : null; };
const bullets = (t) => t.split(/\n/).map((x) => x.replace(/^[\s*\-•]+/, "").trim())
  .filter((x) => x.length > 6 && !/^(inclusion|exclusion) criteria:?$/i.test(x)).slice(0, 8);
function normalize(s) {
  const p = s.protocolSection || {}, id = p.identificationModule || {}, st = p.statusModule || {},
    el = p.eligibilityModule || {}, lc = p.contactsLocationsModule || {};
  const txt = el.eligibilityCriteria || "", ix = txt.search(/exclusion criteria/i);
  const pretty = { RECRUITING: "Recruiting", NOT_YET_RECRUITING: "Not yet recruiting" };
  return {
    id: id.nctId, title: id.briefTitle, cond: (p.conditionsModule || {}).conditions || [],
    status: pretty[st.overallStatus] || st.overallStatus || "Unknown",
    updated: (st.lastUpdatePostDateStruct || {}).date || "",
    sites: (lc.locations || []).slice(0, 40).map((l) => [l.facility || "Site", l.city || "", l.country || ""]),
    min: num(el.minimumAge), max: num(el.maximumAge),
    sex: { FEMALE: "Female", MALE: "Male" }[el.sex] || "All",
    inc: bullets(ix > -1 ? txt.slice(0, ix) : txt), exc: ix > -1 ? bullets(txt.slice(ix)) : [],
  };
}
async function ctgSearch({ q, loc, status }) {
  const u = new URL(CTG);
  if (q) u.searchParams.set("query.cond", q);
  if (loc) u.searchParams.set("query.locn", loc);
  u.searchParams.set("filter.overallStatus", status === "Not yet recruiting" ? "NOT_YET_RECRUITING" : status === "Recruiting" ? "RECRUITING" : "RECRUITING,NOT_YET_RECRUITING");
  u.searchParams.set("pageSize", "12");
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ClinicalTrials.gov returned ${r.status}`);
  return ((await r.json()).studies || []).map(normalize);
}
async function ctgOne(nct) {
  const r = await fetch(`${CTG}/${encodeURIComponent(nct)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ClinicalTrials.gov returned ${r.status}`);
  return normalize(await r.json());
}

// ---------- TinyFish Search + Fetch ----------
async function tinyfishResearch({ id, cond, title }) {
  if (!TF_KEY) { const e = new Error("TinyFish isn’t configured. Add TINYFISH_API_KEY to .env and restart the server."); e.status = 503; throw e; }
  const query = `${id} ${cond || ""} clinical trial -site:clinicaltrials.gov`.trim();
  const sr = await fetch("https://api.search.tinyfish.ai?" + new URLSearchParams({ query }), { headers: { "X-API-Key": TF_KEY }, signal: AbortSignal.timeout(20000) });
  if (!sr.ok) throw new Error(`TinyFish Search returned ${sr.status}`);
  const results = ((await sr.json()).results || []).slice(0, 5)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.snippet || r.description || "" }));
  const extracted = { ids: [], contacts: [], status: [] };
  if (results.length) {
    const fr = await fetch("https://api.fetch.tinyfish.ai", {
      method: "POST", headers: { "X-API-Key": TF_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: results.slice(0, 3).map((r) => r.url), format: "markdown" }), signal: AbortSignal.timeout(45000),
    });
    if (fr.ok) {
      const pages = (await fr.json()).results || [];
      const text = pages.map((p) => p.text || "").join("\n").slice(0, 200000);
      extracted.ids = [...new Set(text.match(/NCT\d{8}/g) || [])].slice(0, 6);
      const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])].slice(0, 3);
      const phones = [...new Set((text.match(/\+?\d[\d\s().-]{8,16}\d/g) || []).filter((x) => x.replace(/\D/g, "").length >= 9))].slice(0, 2);
      const pi = (text.match(/principal investigator[:\s-]+[^\n]{5,80}/gi) || []).slice(0, 2).map((x) => x.trim());
      extracted.contacts = [...pi, ...emails, ...phones];
      extracted.status = text.split("\n").filter((l) => /(now recruiting|currently recruiting|enrol(l)?ment (is )?(open|closed)|no longer recruiting)/i.test(l))
        .map((l) => l.replace(/[#*_>\[\]]/g, "").trim().slice(0, 160)).slice(0, 3);
    }
  }
  return { results, extracted };
}

// ---------- change detection ----------
const hash = (t) => crypto.createHash("md5").update([...t.inc, ...t.exc].join("\n")).digest("hex");
const snap = (t) => ({ status: t.status, updated: t.updated, min: t.min, max: t.max, sex: t.sex, sites: t.sites.map((s) => s.join("|")), crit: hash(t) });
function diff(a, t) {
  const b = snap(t), out = [];
  if (a.status !== b.status) out.push(`Recruitment status changed from “${a.status}” to “${b.status}”.`);
  const added = b.sites.filter((s) => !a.sites.includes(s)), gone = a.sites.filter((s) => !b.sites.includes(s));
  if (added.length) out.push(`${added.length} site(s) added, e.g. ${added[0].replace(/\|/g, ", ")}.`);
  if (gone.length) out.push(`${gone.length} site(s) removed, e.g. ${gone[0].replace(/\|/g, ", ")}.`);
  if (a.min !== b.min || a.max !== b.max || a.sex !== b.sex) out.push("Age or sex requirements changed.");
  if (a.crit !== b.crit) out.push("Eligibility criteria text was edited.");
  if (!out.length && a.updated !== b.updated) out.push(`Record updated on ${b.updated} (no tracked fields changed).`);
  return out;
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } }); });

async function api(req, res, url) {
  const cid = (req.headers["x-client"] || "anon").toString().slice(0, 64), p = url.pathname, q = url.searchParams;
  if (p === "/api/health") return send(res, 200, { ok: true, tinyfish: !!TF_KEY });
  if (p === "/api/trials") return send(res, 200, { trials: await ctgSearch({ q: q.get("q") || "", loc: q.get("loc") || "", status: q.get("status") || "" }) });
  if (p === "/api/research") {
    if (!/^NCT\d{8}$/.test(q.get("id") || "")) return send(res, 400, { error: "Missing or invalid NCT id." });
    return send(res, 200, await tinyfishResearch({ id: q.get("id"), cond: q.get("cond"), title: q.get("title") }));
  }
  const m = /^\/api\/saved(?:\/(NCT\d{8}))?(\/ack)?$/.exec(p);
  if (m) {
    const db = readDb(), mine = (db[cid] ||= {});
    if (req.method === "GET" && !m[1]) {
      const items = Object.values(mine);
      if (q.get("check") !== "1") return send(res, 200, { items: items.map((i) => ({ trial: i.trial })) });
      const out = await Promise.all(items.map(async (i) => {
        try { const cur = await ctgOne(i.trial.id); return { trial: cur, changes: diff(i.snapshot, cur) }; }
        catch (e) { return { trial: i.trial, changes: [], error: e.message }; }
      }));
      return send(res, 200, { items: out });
    }
    if (req.method === "POST" && !m[1]) {
      const { trial } = await body(req);
      if (!trial || !/^NCT\d{8}$/.test(trial.id || "")) return send(res, 400, { error: "A real registry trial is required." });
      mine[trial.id] = { trial, snapshot: snap(trial), savedAt: new Date().toISOString() }; writeDb(db);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE" && m[1]) { delete mine[m[1]]; writeDb(db); return send(res, 200, { ok: true }); }
    if (req.method === "POST" && m[1] && m[2]) {
      if (!mine[m[1]]) return send(res, 404, { error: "Not saved." });
      const cur = await ctgOne(m[1]); mine[m[1]] = { ...mine[m[1]], trial: cur, snapshot: snap(cur) }; writeDb(db);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: "Not found" });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = path.join(__dir, "public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(path.join(__dir, "public")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, e.status || 500, { error: e.message || "Server error" }); }
}).listen(PORT, () => console.log(`TrialBridge running at http://localhost:${PORT}  (TinyFish: ${TF_KEY ? "on" : "off, set TINYFISH_API_KEY"})`));
