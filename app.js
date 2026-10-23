// MFF 데미지 계산기 — 웹 화면 (계산은 서버에서, 여기에는 입력·표시만)
"use strict";
const API = window.MFF_API.replace(/\/$/, "");
const ICONS = window.MFF_ICONS || "";
const SIDES = ["ally", "enemy"];
const SIDE_NAME = { ally: "아군", enemy: "적군" };
const STORE_KEY = "mff_spec_v1";
// 정보 탭 배치 (게임 '영웅 상세 정보' 화면 순서)
const INFO_LAYOUT = [
  [["공격", ["attack", "attack_alt", "atk_speed", "crit", "crit_dmg", "penetrate", "dodge_ignore", "dmg_fire", "dmg_cold",
            "dmg_elec", "dmg_poison", "dmg_mind", "add_penetrate", "focus", "element_add"]],
   ["천성", ["sp_atk", "sp_def", "sp_crit", "sp_crit_dmg", "sp_accuracy", "sp_dodge", "sp_guard", "sp_reduce"]]],
  [["방어", ["def_phys", "def_en", "hp", "recovery", "dodge", "res_fire", "res_cold", "res_elec", "res_poison", "res_mind",
            "penetrate_reduce", "dmg_reduce_phys", "dmg_reduce_en"]],
   ["상태 이상", ["move_speed", "cc_reduce", "cooldown"]]],
];

let spec = null;        // exe 저장 형식과 같은 스펙 JSON
let last = null;        // 마지막 계산 결과
let meta = null;
let pending = [];       // 다음 계산 때 서버에 보낼 화면 조작 (영웅 교체 등)
let timer = null, busy = false, again = false;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (rel) => (rel && ICONS ? `${ICONS}${rel}` : "");
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("ko-KR") : n);

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

// ── 화면 그리기 ──
function render() {
  $("#mode").value = last.mode;
  $("#team_fx").checked = spec.team_fx !== false;
  renderResults();
  for (const s of SIDES) renderSide(s);
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
      ${sk}<div class="d">${extra}</div></div>`;
  }).join("");
}

function sideEl(s) { return $(`#side-${s}`); }

function buildSide(s) {
  const el = sideEl(s);
  el.appendChild($("#side-tpl").content.cloneNode(true));
  $(".side-title", el).textContent = SIDE_NAME[s];
  el.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    el.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.classList.contains(b.dataset.tab)));
  }));
  const hero = $(".hero", el);
  hero.addEventListener("change", () => {
    const h = meta.heroes.find((x) => x.name === hero.value.trim());
    if (!h) { status("목록에 있는 영웅 이름을 고르세요.", true); return; }
    pending.push({ side: s, hero: h.id });
    recalc(0);
  });
  $(".variant", el).addEventListener("change", (e) => { pending.push({ side: s, variant: Number(e.target.value) }); recalc(0); });
  $(".skill", el).addEventListener("change", (e) => { spec[s].skill = Number(e.target.value); recalc(); });
  $(".skill-level", el).addEventListener("change", (e) => { spec[s].skill_level = Number(e.target.value); recalc(); });
  $(".level", el).addEventListener("change", (e) => { spec[s].level = Number(e.target.value); recalc(); });
  $(".potential", el).addEventListener("change", (e) => { spec[s].potential = Number(e.target.value); recalc(); });
}

function renderSide(s) {
  const el = sideEl(s), d = last[s], ui = d.ui;
  const img = $(".portrait", el);
  img.src = icon(ui.portrait); img.style.visibility = ui.portrait && ICONS ? "visible" : "hidden";
  $(".tier", el).textContent = ui.tier ? `티어-${ui.tier}` : "";
  if (document.activeElement !== $(".hero", el)) $(".hero", el).value = d.hero;
  $(".variant", el).innerHTML = ui.variants.map(([id, t]) => `<option value="${id}" ${id === ui.variant_id ? "selected" : ""}>${esc(t)}</option>`).join("");
  $(".skill", el).innerHTML = ui.skills.map((t, i) => `<option value="${i}" ${i === ui.skill ? "selected" : ""}>${esc(t)}</option>`).join("");
  $(".skill-level", el).innerHTML = ui.skill_levels.map((t, i) => `<option value="${i}" ${i === ui.skill_level ? "selected" : ""}>${esc(t)}</option>`).join("");
  Object.assign($(".level", el), { value: ui.level, max: ui.level_max });
  $(".potential", el).value = ui.potential;
  const ci = $(".ctp-icon", el);
  ci.src = icon(ui.ctp_icon); ci.style.display = ui.ctp_icon && ICONS ? "" : "none";
  $(".ctp", el).textContent = ui.ctp || "C.T.P. 없음";
  $(".artifact", el).textContent = ui.artifact || "아티팩트 없음";
  $(".team", el).textContent = "팀원: " + (ui.team.map((t) => t[1]).filter(Boolean).join(", ") || "없음");
  renderInfo(s); renderStat(s); renderEffects(s); renderBreakdown(s);
}

function renderInfo(s) {
  const d = last[s];
  const kv = (k) => {
    const v = d.info[k];
    if (v === undefined) return "";
    const cap = /초과분/.test(v) || /^200\.00%|^75\.00%|^50\.00%|^130\.00%/.test(v);
    return `<div class="kv"><span class="k">${esc(d.info_names[k])}</span><span class="v ${cap ? "cap" : ""}">${esc(v)}</span></div>`;
  };
  $(".tab.info", sideEl(s)).innerHTML = `<div class="grid2">${INFO_LAYOUT.map((col) =>
    `<div>${col.map(([t, keys]) => `<div class="blk"><h4>${t}</h4>${keys.map(kv).join("")}</div>`).join("")}</div>`).join("")}</div>`;
}

function renderStat(s) {
  const d = last[s];
  const rows = d.battle_totals.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${esc(r[2])}</td>
    <td class="num">${esc(r[3])}</td><td class="num">${esc(r[4])}</td><td class="num">${esc(r[5])}</td><td class="num">${esc(r[6])}</td>
    <td class="num fin">${esc(r[7])}</td></tr>`).join("");
  $(".tab.stat", sideEl(s)).innerHTML = `<div class="scroll"><table>
    <tr><th>묶음</th><th>항목</th><th>기준</th><th>상대 특성</th><th>정적</th><th>동적</th><th>디버프</th><th>최종</th></tr>${rows}</table></div>`;
}

function renderEffects(s) {
  const el = $(".tab.effects", sideEl(s));
  const q = (el.dataset.q || "").toLowerCase();
  const list = last[s].effects.filter((e) => !q || (e.name + e.source + e.trigger).toLowerCase().includes(q));
  el.innerHTML = `<div class="filter"><input type="text" placeholder="효과 검색" value="${esc(el.dataset.q || "")}"></div>
    <div class="scroll">${list.map((e, i) => {
      const dyn = e.class.startsWith("동적");
      const ic = icon(e.icon);
      return `<div class="eff ${e.checked ? "" : "off"} ${e.enabled ? "" : "dis"}">
        <input type="checkbox" data-i="${last[s].effects.indexOf(e)}" ${e.checked ? "checked" : ""} ${e.enabled ? "" : "disabled"}>
        ${ic ? `<img src="${ic}" alt="" loading="lazy">` : "<span></span>"}
        <div><div class="nm">${esc(e.name)}</div><div class="src">${esc(e.source)}</div>
          <div class="val">${esc(e.value)}</div><div class="tr">${esc(e.trigger)} · <span class="cls ${dyn ? "dyn" : "st"}">${esc(e.class)}</span></div></div>
      </div>`;
    }).join("")}</div>`;
  const inp = $(".filter input", el);
  inp.addEventListener("input", () => { el.dataset.q = inp.value; renderEffects(s); const n = $(".filter input", el); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  el.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => toggleEffect(s, Number(cb.dataset.i), cb.checked)));
}

function toggleEffect(s, i, on) {
  const e = last[s].effects[i];
  const key = JSON.stringify(e.key);
  const list = spec[s].effects_keyed || (spec[s].effects_keyed = []);
  const row = list.find((r) => JSON.stringify([r[0], r[1], r[2].map((x) => Math.round(x * 1e6) / 1e6)]) === key);
  if (row) { row[3] = on; row[4] = e.trigger; } else list.push([e.key[0], e.key[1], e.key[2], on, e.trigger]);
  e.checked = on;
  recalc();
}

function renderBreakdown(s) {
  const b = last[s].breakdown;
  const head = ["출처", "공격 %", "고정", "물방 %", "고정", "에방 %", "고정", "생명 %", "고정"];
  $(".tab.breakdown", sideEl(s)).innerHTML = `<div class="scroll"><table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
    ${b.map((r) => `<tr>${r.map((c, j) => `<td class="${j ? "num" : ""} ${/최종/.test(r[0]) ? "fin" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
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
  for (const s of SIDES) buildSide(s);
  document.querySelectorAll(".side-switch button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".side-switch button").forEach((x) => x.classList.toggle("on", x === b));
    for (const s of SIDES) sideEl(s).classList.toggle("show", s === b.dataset.side);
  }));
  sideEl("ally").classList.add("show");
  $("#calc").addEventListener("click", () => recalc(0));
  $("#save").addEventListener("click", download);
  $("#file").addEventListener("change", (e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ""; });
  $("#swap").addEventListener("click", () => { [spec.ally, spec.enemy] = [spec.enemy, spec.ally]; recalc(0); });
  $("#mode").addEventListener("change", (e) => { spec.mode = e.target.value; recalc(0); });
  $("#team_fx").addEventListener("change", (e) => { spec.team_fx = e.target.checked; recalc(0); });
  status("계산 서버 연결 중… (처음에는 서버가 깨어나는 데 시간이 걸릴 수 있습니다)");
  try {
    meta = await api("/api/meta");
  } catch (e) {
    status("계산 서버에 연결할 수 없습니다. 잠시 후 새로고침 하세요.", true);
    return;
  }
  $("#mode").innerHTML = meta.contents.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#hero-list").innerHTML = meta.heroes.map((h) => `<option value="${esc(h.name)}"></option>`).join("");
  try { spec = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (_) { spec = null; }
  if (!spec || !spec.ally || !spec.enemy) spec = { mode: meta.contents[0], team_fx: true, ally: {}, enemy: {} };
  recalc(0);
}
init();
