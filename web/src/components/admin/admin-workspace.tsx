"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { BarChart3, LayoutDashboard, Pin, Plus, X } from "lucide-react";
import type { StatsResponse } from "@/lib/api/types";
import type { MapView } from "@/lib/admin-commands";
import { AdminDashboard } from "./admin-dashboard";
import { ChatDock } from "./chat-dock";
import { StatResult } from "./stat-result";
import { statsTabTitle } from "./stats-format";
import styles from "./admin-workspace.module.css";

type ResultTab = { id: string; message: string; response: StatsResponse; openedAt: string };
const MAX_RESULT_TABS = 8;
const HOME = "dashboard";

// Dashboard is always the first tab and stays mounted (hidden) so its live subscription and selected case survive tab changes.
export function AdminWorkspace() {
  const [tabs, setTabs] = useState<ResultTab[]>([]);
  const [active, setActive] = useState(HOME);
  const [chatOpen, setChatOpen] = useState(false);
  const [mapView, setMapView] = useState<MapView>("points");
  const list = useRef<HTMLDivElement>(null);

  function openResult(entry: { id: string; message: string; response: StatsResponse }) {
    const openedAt = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
    setTabs((current) => [...current.filter((tab) => tab.id !== entry.id), { ...entry, openedAt }].slice(-MAX_RESULT_TABS));
    setActive(entry.id);
    // On phones the chat panel covers the result, so let the new tab show.
    if (window.matchMedia("(max-width: 900px)").matches) setChatOpen(false);
  }
  function closeTab(id: string) {
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setActive((current) => (current === id ? HOME : current));
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const ids = [HOME, ...tabs.map((tab) => tab.id)];
    const index = ids.indexOf(active);
    const next = event.key === "ArrowRight" ? ids[(index + 1) % ids.length] : event.key === "ArrowLeft" ? ids[(index - 1 + ids.length) % ids.length]
      : event.key === "Home" ? ids[0] : event.key === "End" ? ids[ids.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setActive(next);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  }

  return <div className={styles.workspace}>
    <div className={styles.tabBar} role="tablist" aria-label="แท็บของ Admin" ref={list} onKeyDown={onKeyDown}>
      <div className={`${styles.tab} ${active === HOME ? styles.tabOn : ""}`}>
        <button type="button" role="tab" id="tab-dashboard" data-tab={HOME} aria-selected={active === HOME} aria-controls="panel-dashboard" tabIndex={active === HOME ? 0 : -1} onClick={() => setActive(HOME)}>
          <LayoutDashboard size={16} aria-hidden="true" /> Dashboard
        </button>
        <span className={styles.pin} title="แท็บหลัก ปิดไม่ได้"><Pin size={13} aria-label="แท็บหลัก ปิดไม่ได้" role="img" /></span>
      </div>
      {tabs.map((tab) => {
        const title = statsTabTitle(tab.response.plan);
        const on = active === tab.id;
        return <div key={tab.id} className={`${styles.tab} ${on ? styles.tabOn : ""}`}>
          <button type="button" role="tab" id={`tab-${tab.id}`} data-tab={tab.id} aria-selected={on} aria-controls={`panel-${tab.id}`} tabIndex={on ? 0 : -1} onClick={() => setActive(tab.id)}>
            <BarChart3 size={16} aria-hidden="true" /> <span className={styles.tabTitle}>{title}</span>
          </button>
          <button type="button" className={styles.close} aria-label={`ปิดแท็บ ${title}`} onClick={() => closeTab(tab.id)}><X size={14} aria-hidden="true" /></button>
        </div>;
      })}
      <button type="button" className={styles.newTab} aria-label="ถามคำถามใหม่ ผลลัพธ์จะเปิดเป็นแท็บใหม่" onClick={() => setChatOpen(true)}><Plus size={16} aria-hidden="true" /></button>
    </div>

    <div role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard" hidden={active !== HOME}>
      <AdminDashboard mapView={mapView} onMapViewChange={setMapView} active={active === HOME} />
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={active !== tab.id}>
      <StatResult response={tab.response} prompt={tab.message} openedAt={tab.openedAt} onAskMore={() => setChatOpen(true)} onClose={() => closeTab(tab.id)} />
    </div>)}

    <ChatDock open={chatOpen} onOpenChange={setChatOpen} activeResultId={active === HOME ? null : active} onResult={openResult} onMapViewChange={view => {
      setMapView(current => view === "toggle" ? current === "points" ? "heatmap" : "points" : view);
      setActive(HOME);
      requestAnimationFrame(() => document.getElementById("customer-detection-heading")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }} onOpenResult={(entry) => {
      if (!tabs.some((tab) => tab.id === entry.id)) openResult(entry); else { setActive(entry.id); if (window.matchMedia("(max-width: 900px)").matches) setChatOpen(false); }
    }} />
  </div>;
}
