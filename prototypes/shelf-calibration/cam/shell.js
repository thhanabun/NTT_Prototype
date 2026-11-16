/* /cam shell: wraps the existing page (same element ids and handlers) in the redesign's menu and views.
   Nothing here changes tracking or calibration; it moves elements and reads state for the headings. */
(() => {
  const $ = id => document.getElementById(id);
  const VIEWS = {
    live: { name: "ร้านสด", title: () => `${n(() => (mapPeople ?? []).filter(p => p.pid !== undefined && p.counted !== false).length)} คนในร้าน` },
    setup: { name: "ผูกกล้อง", sub: true, title: () => `ผูกกล้องแล้ว ${n(() => cams.filter(c => camFit(c).H).length)} จาก ${n(() => cams.length)}` },
    sync: { name: "ซิงค์คน", sub: true, title: () => "ซิงค์คน" },
    map: { name: "แผนที่ร้าน", sub: true, title: () => "แผนที่ร้าน" },
  };
  function n(f) { try { return f(); } catch { return "–"; } }
  const header = document.querySelector("body > header"), bar = document.querySelector("body > .bar"), status = $("status"), main = document.querySelector("body > main");
  if (!bar || !main) return;
  document.body.classList.add("camui");
  const shell = document.createElement("div"); shell.className = "shell";
  const nav = document.createElement("nav"); nav.setAttribute("aria-label", "เมนู");
  nav.innerHTML = `<div class="brand"><span class="logo" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M9,1 L3,9 H7.5 L7,15 L13,7 H8.5 Z" fill="#f47b3c"/></svg></span><b>FAST<i>.</i></b><span>กล้อง</span></div>`
    + Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" data-view="${k}"${v.sub ? ' class="sub"' : ""}>${v.name}${k === "sync" ? '<span class="badge" id="syncBadge" hidden></span>' : ""}</a>`).join("")
    + `<div class="foot"><span id="camLive" class="mono">หยุด</span></div>`;
  const content = document.createElement("div"); content.className = "content";
  const head = document.createElement("div"); head.className = "vhead";
  head.innerHTML = `<div><h1 id="vTitle"></h1></div><button type="button" id="syncBig" hidden></button><button type="button" id="advBtn" aria-expanded="false">ขั้นสูง</button>`;
  content.append(head, bar, status, main);
  shell.append(nav, content);
  document.body.insertBefore(shell, document.body.firstChild);
  if (header) header.hidden = true;

  const advBtn = $("advBtn"), syncBig = $("syncBig"), realSync = $("autoSync");
  advBtn.onclick = () => { const on = !document.body.classList.contains("adv"); document.body.classList.toggle("adv", on); advBtn.setAttribute("aria-expanded", on); };
  syncBig.onclick = () => realSync?.click();
  let view = "live";
  function show(k) { if (!VIEWS[k]) k = "live"; view = k;
    for (const v of Object.keys(VIEWS)) document.body.classList.toggle("v-" + v, v === k);
    nav.querySelectorAll("a[data-view]").forEach(a => { if (a.dataset.view === k) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    syncBig.hidden = k !== "sync"; refresh(); }
  function refresh() { const v = VIEWS[view];
    $("vTitle").textContent = v.title();
    const on = realSync?.getAttribute("aria-pressed") === "true";
    syncBig.textContent = on ? "⇄ ซิงค์: เปิด" : "⇄ ซิงค์: ปิด"; syncBig.setAttribute("aria-pressed", on);
    const live = $("camLive"), p = n(() => playing) === true; live.classList.toggle("on", p); live.textContent = p ? "LIVE · " + n(() => (cams[0]?.video.currentTime ?? 0).toFixed(1)) + " วิ" : "หยุด";
    const waiting = n(() => cams.filter(c => c.sugg?.H).length), b = $("syncBadge"); if (b) { b.hidden = !(waiting > 0); b.textContent = waiting; } }
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || "live");
  setInterval(refresh, 500);
})();
