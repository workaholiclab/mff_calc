// MFF 데미지 계산기 — 웹 화면
// 계산은 서버에서 하고, 서버가 보내 주는 exe 화면 구성(탭·항목·입력 칸)을 그대로 그린다.
"use strict";
const API = window.MFF_API.replace(/\/$/, "");
const ICONS = window.MFF_ICONS || "";
const SIDES = ["ally", "enemy"];
const SIDE_NAME = { ally: "아군", enemy: "적군" };
const STORE_KEY = "mff_spec_v1";

let spec = null;          // exe 저장 형식과 같은 스펙 JSON
let last = null;          // 마지막 계산 결과
let meta = null;
let pending = [];         // 다음 계산 때 서버에 보낼 화면 조작
let timer = null, busy = false, again = false;
const curTab = { ally: "정보", enemy: "정보" };
const subTab = {};        // 탭 안의 탭 (있을 때)
let uruTarget = null;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (rel) => (rel && ICONS ? `${ICONS}${rel}` : "");
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("ko-KR") : n);
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.style.visibility = "hidden"; }, true);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function status(msg, err = false) {
  const el = $("#status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!err);
}

async function api(path, body) {
  const r = await fetch(API + path, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : {});
  const j = await r.json().catch(() => ({ error: `서버 응답 오류 (${r.status})` }));
  if (!r.ok) throw new Error(j.error || `서버 오류 (${r.status})`);
  return j;
}

// ── 계산 요청 (연속 입력은 묶어서 한 번) ──
function recalc(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}
function act(side, a, delay = 0) { pending.push({ side, ...a }); recalc(delay); }

async function run() {
  if (busy) { again = true; return; }
  busy = true;
  document.body.classList.add("busy");
  status("계산 중…");
  try {
    const body = { ...spec, _actions: pending };
    pending = [];
    const res = await api("/api/calc", body);
    last = res;
    spec.mode = res.mode;
    spec.ally = res.ally.state;
    spec.enemy = res.enemy.state;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(spec)); } catch (_) { /* 저장소 사용 불가 */ }
    render();
    status("");
  } catch (e) {
    status(e.message.includes("Failed to fetch") ? "계산 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요." : e.message, true);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    if (again) { again = false; recalc(0); }
  }
}

// ── 화면 ──
function render() {
  const y = window.scrollY;
  $("#mode").value = last.mode;
  $("#team_fx").checked = spec.team_fx !== false;
  $("#team_size").value = spec.team_size ?? 3;
  $("#pvp").value = spec.pvp ?? 1;
  $("#pvp_sp").value = spec.pvp_sp ?? 1;
  renderResults();
  for (const s of SIDES) renderSide(s);
  window.scrollTo(0, y);
}

function renderResults() {
  $("#results").innerHTML = last.results.map((r, i) => {
    const sum = r.normal + r.penetrate + r.special || 1;
    const pct = (v) => `${(100 * v / sum).toFixed(2)}%`;
    let extra = `처치까지 <b>${fmt(r.kills)}</b>타`;
    if (r.special) extra += ` · 치명 ${(r.crit_p * 100).toFixed(1)}% · 일반 회피 ${(r.dodge_p * 100).toFixed(1)}% · 천성 치명 ${(r.sp_crit_p * 100).toFixed(1)}% · 천성 회피 ${(r.sp_dodge_p * 100).toFixed(1)}%`;
    if (r.dot_tick) extra += ` · 지속 피해 틱 ${fmt(r.dot_tick)}`;
    if (r.reflect) extra += ` · 반사 ${fmt(r.reflect)}`;
    const sk = r.skill ? `<div class="d"><b>스킬 1회: ${r.skill.hits}타 합계 ${fmt(r.skill.total)}</b>${r.skill.proj_hits ? ` / 투사체 포함 최대 ${r.skill.hits + r.skill.proj_hits}타 ${fmt(r.skill.total + r.skill.proj_total)}` : ""}</div>` : "";
    return `<div class="card ${SIDES[i]}">
      <div class="t">${esc(r.title)} (선택 타격 1회)</div>
      <div class="total">${fmt(r.total)}</div>
      <div class="bar"><i class="n" style="width:${pct(r.normal)}"></i><i class="p" style="width:${pct(r.penetrate)}"></i><i class="s" style="width:${pct(r.special)}"></i></div>
      <div class="d">일반 피해 ${fmt(r.normal + r.penetrate)} (${esc(r.kind)} ${fmt(r.normal)} + 추가 관통 ${fmt(r.penetrate)}) · 천성 피해 ${fmt(r.special)}</div>
      ${r.sim ? `<div class="d"><b>${esc(r.sim)}</b></div>` : ""}
      ${sk}<div class="d">${extra}</div>
      ${r.sim_graph ? simSvg(r.sim_graph) : ""}</div>`;
  }).join("");
}

// 시뮬레이션 그래프: 시간 → 대상 생명력 (계단선) · 최대 생명력 (점선) · 발동 효과 띠 · 스킬 사용 눈금
function simSvg(g) {
  if (!g || !g.curve || !g.curve.length) return "";
  const labels = [...new Set([...g.spans.filter((x) => x[3] === "a"), ...g.spans.filter((x) => x[3] !== "a")].map((x) => x[0]))];
  const lw = Math.max(56, ...labels.map((l) => [...l].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 11 : 6), 0)));
  const W = 760, L = Math.min(260, lw + 12), R = 16, T = 34, BH = 12, B = 28 + BH * labels.length + 4, PH = 200, H = T + PH + B;
  const pw = W - L - R, end = g.end || 1, top = Math.max(...g.curve.map((c) => c[2])) || 1;
  const X = (t) => L + (pw * t) / end, Y = (v) => T + PH - (PH * v) / top;
  const sh = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "K" : Math.round(v).toLocaleString());
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"><rect width="${W}" height="${H}" fill="#0f1524"/>`;
  for (let k = 0; k <= 4; k++) {
    const y = T + PH - (PH * k) / 4;
    s += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="#26304a"/><text x="${L - 6}" y="${y + 4}" fill="#8fa3c8" font-size="11" text-anchor="end">${sh((top * k) / 4)}</text>`;
  }
  const st = [0.5, 1, 2, 5, 10, 15, 20, 30, 60].find((x) => end / x <= 10) || 120;
  for (let t = 0; t <= end + 1e-9; t += st)
    s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${T + PH}" stroke="#26304a"/><text x="${X(t)}" y="${T + PH + 13}" fill="#8fa3c8" font-size="11" text-anchor="middle">${+t.toFixed(1)}s</text>`;
  let mx = "", hp = "", pm = null, ph = null;
  g.curve.forEach(([t, h, m]) => {
    mx += (pm === null ? `M${X(t)},${Y(m)}` : ` L${X(t)},${Y(pm)} L${X(t)},${Y(m)}`); pm = m;
    hp += (ph === null ? `M${X(t)},${Y(h)}` : ` L${X(t)},${Y(ph)} L${X(t)},${Y(h)}`); ph = h;
  });
  mx += ` L${X(end)},${Y(pm)}`;
  s += `<path d="${mx}" fill="none" stroke="${g.maxhp}" stroke-dasharray="5,4"/>`;
  g.uses.forEach(([t, n]) => (s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T - 6}" y2="${T}" stroke="#5a6a8c"><title>${t.toFixed(2)}초 ${esc(n)}</title></line>`));
  s += `<path d="${hp}" fill="none" stroke="${g.hp}" stroke-width="2"/>`;
  labels.forEach((l, i) => {
    const c = g.colors[i % g.colors.length], y = T + PH + 20 + i * BH;
    g.spans.filter((x) => x[0] === l).forEach(([, a, e]) => (s += `<rect x="${X(a)}" y="${y + 1}" width="${Math.max(2, X(Math.min(e, end)) - X(a))}" height="${BH - 3}" fill="${c}" opacity="0.7"><title>${esc(l)} ${a.toFixed(2)}~${e.toFixed(2)}초</title></rect>`));
    s += `<text x="${L - 4}" y="${y + BH - 3}" fill="${c}" font-size="10" text-anchor="end">${esc(l)}</text>`;
  });
  if (g.kill != null) s += `<line x1="${X(g.kill)}" x2="${X(g.kill)}" y1="${T}" y2="${T + PH}" stroke="#f25c54" stroke-width="1.5"/>`;
  s += `<text x="${L}" y="14" fill="#e6e9f0" font-size="12" font-weight="bold">${esc(g.title)}</text><text x="${L}" y="28" fill="#a9b6d3" font-size="11">${esc(g.summary || "")}</text></svg>`;
  return `<div class="graph">${s}</div>`;
}

function renderSide(s) {
  const el = $(`#side-${s}`), d = last[s], ui = d.ui;
  el.innerHTML = "";
  const head = h("div", "hero-head");
  const img = h("img", "portrait");
  if (ui.portrait && ICONS) img.src = icon(ui.portrait); else img.style.visibility = "hidden";
  head.appendChild(img);
  head.appendChild(h("div", "hero-sum", `<div><b class="side-title">${SIDE_NAME[s]}</b> <span class="tier">${ui.tier ? `티어-${ui.tier}` : ""}</span></div>
    <div class="hname">${esc(d.hero)}</div><div class="small">${esc(d.variant)}</div>
    <div class="small">${ui.ctp_icon && ICONS ? `<img class="mini" src="${icon(ui.ctp_icon)}">` : ""}${esc(ui.ctp || "C.T.P. 없음")} · ${esc(ui.artifact || "아티팩트 없음")}</div>`));
  el.appendChild(head);
  el.appendChild(node(d.tree, s, "root"));
}

// ── 서버가 보낸 화면 트리 그리기 ──
function node(n, s, path) {
  if (!n) return document.createTextNode("");
  switch (n.t) {
    case "col": { const e = h("div", "v"); n.kids.forEach((k, i) => e.appendChild(node(k, s, `${path}.${i}`))); return e; }
    case "row": { const e = h("div", "hz"); n.kids.forEach((k, i) => e.appendChild(node(k, s, `${path}.${i}`))); return e; }
    case "grid": {
      const wrap = h("div", "gwrap");
      const e = h("div", "grid");
      e.style.gridTemplateColumns = `repeat(${Math.max(1, n.cols)}, auto)`;
      n.cells.forEach((c, i) => {
        const x = node(c.n, s, `${path}.${i}`);
        const cell = h("div", "cell");
        cell.style.gridRow = `${c.r + 1} / span ${c.rs > 0 ? c.rs : 1}`;
        cell.style.gridColumn = `${c.c + 1} / span ${c.cs > 0 ? c.cs : 1}`;
        cell.appendChild(x);
        e.appendChild(cell);
      });
      wrap.appendChild(e);
      return wrap;
    }
    case "form": {
      const e = h("div", "form");
      n.rows.forEach(([lab, f], i) => {
        const r = h("div", "frow");
        if (lab !== null) r.appendChild(h("span", "flab", esc(lab)));
        r.appendChild(node(f, s, `${path}.${i}`));
        e.appendChild(r);
      });
      return e;
    }
    case "group": {
      const e = h("fieldset", "grp");
      e.appendChild(h("legend", "", esc(n.title)));
      e.appendChild(node(n.node, s, path));
      return e;
    }
    case "tabs": return tabs(n, s, path);
    case "label": { const e = h("span", n.hint ? "lbl hint" : "lbl", esc(n.text).replace(/\n/g, "<br>")); return e; }
    case "num": return num(n, s);
    case "combo": return combo(n, s);
    case "check": return check(n, s);
    case "btn": { const b = h("button", "btn sm", esc(n.text)); b.disabled = !n.en; b.onclick = () => act(s, { w: n.id }); return b; }
    case "text": { const i = h("input"); i.type = "text"; i.value = n.v; i.readOnly = n.ro; i.onchange = () => act(s, { w: n.id, v: i.value }); return i; }
    case "tree": return tree(n, s);
    case "graph": return graph(n);
    case "list": return list(n, s);
    case "uru": return uru(n, s);
    default: return document.createTextNode("");
  }
}

function tabs(n, s, path) {
  const root = n.tabs.some((t) => t.title === "정보");         // 패널의 큰 탭 (정보·영웅·스킬·…)
  const key = root ? null : `${s}:${path}`;
  const cur = root ? curTab[s] : (subTab[key] || n.tabs[0].title);
  const e = h("div", "tabsw");
  const bar = h("div", "tabs");
  n.tabs.forEach((t) => {
    const b = h("button", t.title === cur ? "on" : "", esc(t.title));
    b.onclick = () => { if (root) curTab[s] = t.title; else subTab[key] = t.title; renderSide(s); };
    bar.appendChild(b);
  });
  e.appendChild(bar);
  const page = n.tabs.find((t) => t.title === cur) || n.tabs[0];
  const pg = h("div", "tabpage");
  pg.appendChild(node(page.node, s, `${path}/${page.title}`));
  e.appendChild(pg);
  return e;
}

function num(n, s) {
  const w = h("span", "num");
  if (n.pre) w.appendChild(h("span", "affix", esc(n.pre)));
  if (n.ro) {
    w.appendChild(h("b", "ro", Number(n.v).toLocaleString("ko-KR", { minimumFractionDigits: n.dec, maximumFractionDigits: n.dec })));
  } else {
    const i = h("input");
    Object.assign(i, { type: "number", value: n.v, min: n.min, max: n.max, step: n.step || (n.dec ? 10 ** -n.dec : 1), disabled: !n.en });
    i.style.width = `${Math.min(14, Math.max(7, String(Math.round(n.max)).length + (n.dec ? n.dec + 1 : 0) + 4))}ch`;
    i.onchange = () => act(s, { w: n.id, v: i.value }, 300);
    w.appendChild(i);
  }
  if (n.suf) w.appendChild(h("span", "affix", esc(n.suf)));
  return w;
}

function combo(n, s) {
  const sel = h("select");
  sel.innerHTML = n.items.map((t, i) => `<option value="${i}" ${i === n.cur ? "selected" : ""}>${esc(t)}</option>`).join("");
  sel.disabled = !n.en;
  sel.onchange = () => act(s, { w: n.id, v: Number(sel.value) });
  if (!n.search || n.items.length < 30) return sel;
  // 항목이 많은 검색형 콤보(영웅·C.T.P. 등): 이름 입력 검색 + 목록
  const w = h("span", "csearch");
  const dl = h("datalist"); dl.id = `dl-${s}-${n.id}`;
  dl.innerHTML = n.items.map((t) => `<option value="${esc(t)}"></option>`).join("");
  const q = h("input"); q.type = "search"; q.placeholder = "이름 검색"; q.setAttribute("list", dl.id);
  q.onchange = () => { const k = n.items.indexOf(q.value.trim()); if (k >= 0) act(s, { w: n.id, v: k }); };
  w.append(sel, q, dl);
  return w;
}

function check(n, s) {
  const l = h("label", n.button ? "check tog" : "check");
  const i = h("input"); i.type = n.radio ? "radio" : "checkbox"; i.checked = n.v; i.disabled = !n.en;
  i.onchange = () => act(s, { w: n.id, v: i.checked });
  l.append(i, document.createTextNode(` ${n.text}`));
  return l;
}

function tree(n, s) {
  const wrap = h("div", "scroll");
  const t = h("table");
  if (n.head.length) t.appendChild(h("tr", "", n.head.map((x) => `<th>${esc(x)}</th>`).join("")));
  n.rows.forEach((r, i) => {
    const tr = h("tr", r.en ? "" : "dis");
    r.cells.forEach((c, j) => {
      const td = h("td", j ? "num" : "");
      if (j === 0) {
        td.style.paddingLeft = `${4 + r.d * 14}px`;
        if (r.c !== null) {
          const cb = h("input"); cb.type = "checkbox"; cb.checked = r.c; cb.disabled = !r.en;
          cb.onchange = () => act(s, { w: n.id, row: i, v: cb.checked });
          td.appendChild(cb);
        }
        td.appendChild(document.createTextNode(` ${c}`));
      } else if (r.cc && r.cc[j] !== undefined) {
        const cb = h("input"); cb.type = "checkbox"; cb.checked = r.cc[j]; cb.disabled = !r.en;
        cb.onchange = () => act(s, { w: n.id, row: i, col: j, v: cb.checked });
        td.appendChild(cb);
        td.appendChild(document.createTextNode(` ${c}`));
      } else if (r.ed && r.ed.includes(j)) {
        const inp = h("input"); inp.type = "number"; inp.step = "0.01"; inp.className = "cell-edit";
        inp.value = c ? String(c).replace(/,/g, "") : "";
        inp.onchange = () => act(s, { w: n.id, row: i, col: j, v: inp.value || "0", edit: true });
        td.appendChild(inp);
      } else td.textContent = c;
      if (/최종/.test(r.cells[0])) td.classList.add("fin");
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  wrap.appendChild(t);
  return wrap;
}

// 스킬 타격 프레임 그래프 (막대 = 1타 피해, 선 = 누적)
function graph(n) {
  const wrap = h("div", "graph");
  const W = 760, H = 240, L = 52, R = 56, T = 24, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const fmt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "K" : Math.round(v).toLocaleString());
  if (!n.frames || !n.bars.length) {
    wrap.textContent = n.note || "타격 타임라인 데이터가 없습니다.";
    wrap.classList.add("hint");
    return wrap;
  }
  const top = Math.max(...n.bars.map(([, l]) => l.reduce((a, x) => a + x[1], 0))) || 1;
  const X = (f) => L + (pw * f) / n.frames;
  const Yb = (v) => T + ph - (ph * v) / top;
  const Yc = (v) => T + ph - (ph * v) / (n.total || 1);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">`;
  svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#0f1524"/>`;
  for (let k = 1; k <= 4; k++) {
    const y = T + ph - (ph * k) / 4;
    svg += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="#26304a"/>`;
    svg += `<text x="${L - 6}" y="${y + 4}" fill="#8fa3c8" font-size="11" text-anchor="end">${fmt((top * k) / 4)}</text>`;
    svg += `<text x="${L + pw + 6}" y="${y + 4}" fill="${n.cum}" font-size="11">${fmt((n.total * k) / 4)}</text>`;
  }
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find((s_) => n.frames / s_ <= 9) || 500;
  for (let f = 0; f <= n.frames; f += step) {
    svg += `<text x="${X(f)}" y="${T + ph + 14}" fill="#8fa3c8" font-size="11" text-anchor="middle">${f}</text>`;
    svg += `<text x="${X(f)}" y="${T + ph + 27}" fill="#8fa3c8" font-size="10" text-anchor="middle">${(f / 30).toFixed(1)}s</text>`;
  }
  const bw = Math.max(2, Math.min(14, (pw / n.frames) * 0.8));
  let acc = 0, path = `M${X(0)},${Yc(0)}`;
  n.bars.forEach(([f, lst]) => {
    let base = 0;
    lst.forEach(([seg, d, no, sel]) => {
      const col = sel ? n.gold : n.colors[seg % n.colors.length];
      svg += `<rect x="${X(f) - bw / 2}" y="${Yb(base + d)}" width="${bw}" height="${Yb(base) - Yb(base + d)}" fill="${col}"><title>${f}프레임 (${(f / 30).toFixed(2)}초) · ${no}타 ${d.toLocaleString()}</title></rect>`;
      base += d;
    });
    path += ` L${X(f)},${Yc(acc)}`;
    acc += base;
    path += ` L${X(f)},${Yc(acc)}`;
  });
  path += ` L${X(n.frames)},${Yc(acc)}`;
  svg += `<path d="${path}" fill="none" stroke="${n.cum}" stroke-width="2"/>`;
  let head = `타격 피해 합계 ${n.total.toLocaleString()} · 전체 ${n.frames}프레임 (${(n.frames / 30).toFixed(2)}초, 공격 속도 100%)`;
  if (n.projHits) head += ` | 투사체 최대 ${n.projHits}타 ${n.proj.toLocaleString()} (그래프 밖)`;
  svg += `<text x="${L}" y="15" fill="#e6e9f0" font-size="12">${esc(head)}</text>`;
  svg += `<text x="${L + pw + R - 4}" y="15" fill="${n.cum}" font-size="12" text-anchor="end">— 누적</text></svg>`;
  wrap.innerHTML = svg;
  return wrap;
}

function list(n, s) {
  const w = h("div", "scroll clist");
  n.items.forEach((it, i) => {
    const l = h("label", "check");
    if (it.c !== null) {
      const cb = h("input"); cb.type = "checkbox"; cb.checked = it.c;
      cb.onchange = () => act(s, { w: n.id, row: i, v: cb.checked });
      l.appendChild(cb);
    }
    l.appendChild(document.createTextNode(` ${it.text}`));
    w.appendChild(l);
  });
  return w;
}

function uru(n, s) {
  const u = meta.uru.find((x) => x[0] === n.cur);
  const b = h("button", `uru ${u && n.amp ? "amp" : ""}`);
  b.disabled = !n.en;
  b.title = n.en ? (u ? `${u[1]}${n.amp ? " (증폭)" : ""}` : "비어 있음 — 눌러서 선택") : "장비 랭크 미달로 잠김";
  if (!n.en) b.textContent = "🔒";
  else if (u && u[2] && ICONS) b.innerHTML = `<img src="${icon(u[2])}" alt="">`;
  else b.textContent = u ? "U" : "+";
  b.onclick = () => openUru(s, n, u);
  return b;
}

function openUru(s, n, u) {
  uruTarget = { s, id: n.id };
  $("#uru-where").textContent = `${SIDE_NAME[s]} · 장비 ${n.slot[0]} · 슬롯 ${n.slot[1] + 1}${u ? ` — 현재: ${u[1]}` : ""}`;
  $("#uru-amp").checked = n.cur ? n.amp : true;
  $("#uru-q").value = "";
  fillUru();
  $("#uru-pop").hidden = false;
}

function fillUru() {
  const q = $("#uru-q").value.trim();
  $("#uru-list").innerHTML = meta.uru.filter((u) => !q || u[1].includes(q)).map((u) =>
    `<button class="uitem" data-id="${u[0]}">${u[2] && ICONS ? `<img src="${icon(u[2])}" loading="lazy">` : ""}<span>${esc(u[1])}</span></button>`).join("");
}

function pickUru(id) {
  if (!uruTarget) return;
  act(uruTarget.s, { w: uruTarget.id, uru: id, amp: $("#uru-amp").checked });
  $("#uru-pop").hidden = true;
}

// ── 파일 ──
function download() {
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const nm = `${last ? last.ally.hero : "spec"}_vs_${last ? last.enemy.hero : ""}.json`.replace(/[\\/:*?"<>|]/g, "_");
  a.href = URL.createObjectURL(blob);
  a.download = nm;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function upload(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result);
      if (!j.ally || !j.enemy) throw new Error("ally / enemy 가 없는 파일입니다");
      delete j.layout;
      spec = j; pending = [];
      recalc(0);
    } catch (e) { status(`불러오기 실패: ${e.message}`, true); }
  };
  fr.readAsText(file, "utf-8");
}

// ── 시작 ──
async function init() {
  document.querySelectorAll(".side-switch button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".side-switch button").forEach((x) => x.classList.toggle("on", x === b));
    for (const s of SIDES) $(`#side-${s}`).classList.toggle("show", s === b.dataset.side);
  }));
  $("#side-ally").classList.add("show");
  $("#calc").addEventListener("click", () => recalc(0));
  $("#save").addEventListener("click", download);
  $("#file").addEventListener("change", (e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ""; });
  $("#swap").addEventListener("click", () => { [spec.ally, spec.enemy] = [spec.enemy, spec.ally]; recalc(0); });
  $("#copy-ae").addEventListener("click", () => { spec.enemy = JSON.parse(JSON.stringify(spec.ally)); recalc(0); });
  $("#copy-ea").addEventListener("click", () => { spec.ally = JSON.parse(JSON.stringify(spec.enemy)); recalc(0); });
  $("#mode").addEventListener("change", (e) => { spec.mode = e.target.value; recalc(0); });
  $("#team_fx").addEventListener("change", (e) => { spec.team_fx = e.target.checked; recalc(0); });
  for (const k of ["team_size", "pvp", "pvp_sp"]) $(`#${k}`).addEventListener("change", (e) => { spec[k] = Number(e.target.value); recalc(); });
  $("#uru-close").onclick = () => { $("#uru-pop").hidden = true; };
  $("#uru-clear").onclick = () => pickUru(0);
  $("#uru-q").oninput = fillUru;
  $("#uru-list").addEventListener("click", (e) => { const b = e.target.closest(".uitem"); if (b) pickUru(Number(b.dataset.id)); });
  status("계산 서버 연결 중… (처음에는 서버가 깨어나는 데 10초 정도 걸릴 수 있습니다)");
  try {
    meta = await api("/api/meta");
  } catch (e) {
    status("계산 서버에 연결할 수 없습니다. 잠시 후 새로고침 하세요.", true);
    return;
  }
  $("#mode").innerHTML = meta.contents.map((c) => `<option>${esc(c)}</option>`).join("");
  try { spec = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (_) { spec = null; }
  if (!spec || !spec.ally || !spec.enemy) spec = { mode: meta.contents[0], team_fx: true, ally: {}, enemy: {} };
  recalc(0);
}
init();

// 잘린 글씨: 마우스를 올리면 전체 텍스트 (title 이 없는 요소만)
const _measure = document.createElement("canvas").getContext("2d");
document.addEventListener("mouseover", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.title || el.closest("svg")) return;
  let t, cut;
  if (el.tagName === "SELECT") {
    t = el.options[el.selectedIndex]?.text || "";
    _measure.font = getComputedStyle(el).font;
    cut = _measure.measureText(t).width > el.clientWidth - 24;
  } else if (el.tagName === "INPUT") {
    t = el.value;
    cut = el.scrollWidth > el.clientWidth + 1;
  } else {
    t = el.innerText;
    cut = el.children.length === 0 && el.scrollWidth > el.clientWidth + 1;
  }
  if (t && cut) el.title = t;
}, true);
