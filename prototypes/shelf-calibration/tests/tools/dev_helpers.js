// Main-session dev helpers (not a user feature): record a run's raw detections, replay them through the page's own tracking code.
// Load in the page console: eval((await (await fetch("/devlog/devhelpers")).json()).src)
window.devLoad = async (set, links) => { const sel = document.getElementById("vset"); for (let k = 0; k < 20 && !sel.sets; k++) await new Promise(r => setTimeout(r, 300));
  sel.value = set; sel.dispatchEvent(new Event("change", { bubbles: true }));
  for (let k = 0; k < 60 && !cams.slice(0, sel.sets.find(x => x.id === set).files.length).every(c => c.frame); k++) await new Promise(r => setTimeout(r, 300));
  if (links) cams.forEach((c, i) => { if (links[i]) { c.links = JSON.parse(JSON.stringify(links[i])); c.fitKey = null; } }); };
window.devRecord = async name => { window.rec = []; window.recDone = false; const fe = window.fetch; const n = cams.filter(c => c.frame && c.isVideo).length; let pending = {}, t0 = null;
  window.fetch = async (u, o) => { if (String(u) !== "/people") return fe(u, o); const cam = JSON.parse(o.body).camera, now = cams[0].video.currentTime * 1000; const r = await fe(u, o); const j = await r.clone().json();
    t0 ??= now; pending[cams.findIndex(c => c.id === cam)] = j.people; if (Object.keys(pending).length === n) { rec.push({ now: t0, cams: pending }); pending = {}; t0 = null; } return r; };
  document.getElementById("rewind").click(); await new Promise(r => setTimeout(r, 1500));
  document.getElementById("play").click(); while (playing) await new Promise(r => setTimeout(r, 500)); window.fetch = fe; window.recDone = true;
  await fetch("/devlog/rec-" + name, { method: "POST", body: JSON.stringify(rec) }); };
window.devReplay = () => { resetTracking(); const S = []; let last = -1; const live = cams.filter(c => c.frame && c.isVideo);
  for (const r of rec) { live.forEach(c => { c.people = r.cams[cams.indexOf(c)] ?? []; }); const seen = peopleRound(live, r.now); collectSamples(seen);
    if (stats.detections % 60 === 0) cams.forEach(tuneSuggest);
    for (const p of mapPeople) if (p.pid !== undefined) stats.persons.add(p.pid);
    if (r.now / 1000 - last >= .5) { last = r.now / 1000; S.push({ t: +(r.now / 1000).toFixed(2), people: mapPeople.map(p => ({ pid: p.pid, x: +p.smooth[0].toFixed(2), y: +p.smooth[1].toFixed(2) })) }); } }
  return { fits: cams.map(c => ({ H: camFit(c).H })), samples: S }; };
window.devScore = async name => { const d = devReplay(); await fetch("/devlog/" + name, { method: "POST", body: JSON.stringify(d) }); return { persons: stats.persons.size, absorbed: stats.absorbed ?? 0 }; };
window.variant = async (name, patch = {}) => { const keep = { ...TRACK }; Object.assign(TRACK, patch); const r = await devScore(name); Object.assign(TRACK, keep); return r; };
window.devLoadState = async (set, st) => { await devLoad(set, null); refs = JSON.parse(JSON.stringify(st.refs)); st.cams.forEach((s, i) => { if (!cams[i]) return; Object.assign(cams[i], { links: JSON.parse(JSON.stringify(s.links)), camH: s.camH ?? null, tune: s.tune ?? null, align: s.align ?? null, level: s.level ?? true, fitKey: null }); }); draw(); };
window.steadyRun = async name => { window.sdone = null; const S = []; const orig = peopleRound; let last = -1;
  peopleRound = (live, now) => { const seen = orig(live, now); if (now / 1000 - last >= .5) { last = now / 1000; S.push({ t: +(now / 1000).toFixed(2), people: mapPeople.map(p => ({ pid: p.pid, x: +p.smooth[0].toFixed(2), y: +p.smooth[1].toFixed(2) })) }); } return seen; };
  document.getElementById("rewind").click(); await new Promise(r => setTimeout(r, 1000)); const t0 = performance.now(); document.getElementById("play").click();
  while (playing) await new Promise(r => setTimeout(r, 500)); peopleRound = orig;
  window.sdone = { secs: (performance.now() - t0) / 1000, n: S.length };
  await fetch("/devlog/" + name, { method: "POST", body: JSON.stringify({ fits: cams.map(c => ({ H: camFit(c).H })), samples: S }) }); };
