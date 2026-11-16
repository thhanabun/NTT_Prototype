// Testing helper (token saver). Loads in the page console; touches NO app state except pressing the user's own buttons #rewind/#play.
// It never places, moves or computes any point: corners/ties stay hand-clicked by eye. It only READS state and RECORDS a play-through.
//   th.state()          -> one short line of text (replaces a full screenshot for "did my click land / how many ties / is it playing")
//   await th.run(name)  -> rewind + press Play, sample every 0.5 s of video time until the clip ends, POST everything to /devlog/<name>
//                          (never returned into chat), returns a ~200-char summary. Score with: python tests/harness/score_dev.py <scenario> <name> <limit>
//   th.usage()          -> number of logged user actions so far (cheap check)
(() => {
  const r2 = v => v == null || !isFinite(v) ? null : +(+v).toFixed(2);
  const txt = id => (document.getElementById(id)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const live = () => cams.filter(c => c.frame);
  const th = window.th = {
    usage: () => window.usageLog.length,
    state() {
      return JSON.stringify({
        cams: cams.map((c, i) => [i, c.frame ? 1 : 0, c.links ? c.links.length : 0, c.fit ? { rms: r2(c.fit.rms), h: r2(c.fit.height) } : null]),
        refs: refs.length, playing, vt: [...document.querySelectorAll("video")].map(v => r2(v.currentTime)),
        people: (mapPeople || []).filter(p => p.floor).length, det: stats?.detections ?? 0, ids: stats?.persons?.size ?? 0,
        acts: window.usageLog.length, status: txt("status"), check: txt("checkOut"), note: txt("liveNote")
      });
    },
    async run(name, opts = {}) {
      const S = [], maxWait = (opts.maxSec ?? 900) * 1000, step = opts.step ?? 0.5; let last = -9;
      const sample = () => { const v = document.querySelector("video"), t = v ? v.currentTime : null;
        if (t == null || t - last < step - 1e-6) return; last = t;
        S.push({ t: +t.toFixed(2), people: (mapPeople || []).filter(p => p.floor).map(p => { const f = p.smooth ?? p.floor;
          return { pid: p.pid, x: +f[0].toFixed(3), y: +f[1].toFixed(3), counted: !!p.counted, n: (p.keys || []).filter(k => k !== undefined).length }; }) }); };
      const iv = setInterval(sample, 150);
      document.getElementById("rewind").click(); await new Promise(r => setTimeout(r, 1200));
      const w0 = performance.now(); document.getElementById("play").click();
      await new Promise(r => setTimeout(r, 3000));
      while (playing && performance.now() - w0 < maxWait) await new Promise(r => setTimeout(r, 1000));
      clearInterval(iv); sample();
      const dump = { usage: window.usageLog.map(x => [x.order, x.t, x.name, x.params]), samples: S,
        fits: cams.map(c => ({ H: c.fit && c.fit.H, rms: c.fit && c.fit.rms, height: c.fit && c.fit.height })),
        meta: { wall_s: r2((performance.now() - w0) / 1000), finished: !playing } };
      const resp = await (await fetch("/devlog/" + name, { method: "POST", body: JSON.stringify(dump) })).json();
      const cnt = S.map(s => s.people.length);
      return JSON.stringify({ saved: resp.saved, samples: S.length, finished: !playing, wall_s: dump.meta.wall_s, people_min_max: [Math.min(...cnt), Math.max(...cnt)], acts: dump.usage.length });
    }
  };
  return "th ready";
})();
