"use client";

import { useRef, useState } from "react";
import { checkout, confirmCustomerCase, startSession } from "@/lib/api/client";
import { useLiveState } from "@/lib/api/live-state";
import type { Basket, BasketId, Order } from "@/lib/api/types";
import { useBasketSelection } from "./use-basket-selection";

export function useShopper() {
  const live = useLiveState();
  const { state, loading, stale } = live;
  const selection = useBasketSelection();
  const { basketId } = selection;
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(true);
  const locked = useRef(false);
  const error = actionError || live.error;

  async function refresh() {
    setActionError("");
    return live.refresh();
  }

  function selectBasket(id: BasketId) {
    if (locked.current) return;
    selection.select(id);
    setNotice("");
    setShowReceipt(true);

  }

  async function runAction(action: () => Promise<string>) {
    if (locked.current || loading || stale) return;
    locked.current = true;
    setPending(true);
    setActionError("");
    setNotice("");
    try {
      const message = await action();
      if (await refresh()) setNotice(message);
    } catch (cause) {
      await refresh();
      setActionError(cause instanceof Error ? cause.message : "The request failed. Check the latest state before retrying.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  async function beginSession(id: BasketId = basketId) {
    return runAction(async () => {
      await startSession(id);
      setShowReceipt(false);
      setCompletedOrder(null);
      setCompletedSessionId(null);
      return `Basket ${id} พร้อมสำหรับการช้อปแล้ว`;
    });
  }

  const serverBasket: Basket = state?.baskets.find((item) => item.basketId === basketId) ?? {
    basketId, session: null, lines: [], total: 0, payable: false, unresolvedCaseCount: 0,
  };

  // A successful order response confirms the old session closed, even if the stream/GET is delayed.
  // Do not hide a different session started by another viewer.
  const basket = completedOrder?.basketId === basketId && serverBasket.session?.sessionId === completedSessionId
    ? { ...serverBasket, session:null, lines:[], total:0, payable:false } : serverBasket;

  const waitingCases = (state?.cases ?? []).filter((item) => item.status === "WAITING_CUSTOMER" && item.candidate === basketId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const staffCases = (state?.cases ?? []).filter((item) => item.status === "OPEN_STAFF" &&
    (!item.candidate || item.candidate === basketId || item.evidence.zone === "ZONE_UNKNOWN"));
  const currentCase = waitingCases[0] ?? null;
  const receipt = showReceipt && !basket.session
    ? (completedOrder?.basketId === basketId ? completedOrder : state?.recentOrders.find((item) => item.basketId === basketId)) ?? null
    : null;

  async function confirmItem(answer: "YES" | "NO") {
    if (!currentCase) return;
    return runAction(async () => {
      const result = await confirmCustomerCase(currentCase.caseId, answer);
      return result.case.status === "CLOSED" ? "ยืนยันรายการแล้ว และตรวจสอบตะกร้าล่าสุดเรียบร้อย"
        : "ส่งรายการให้พนักงานตรวจสอบแล้ว รายการยังไม่เปลี่ยนยอดชำระ";
    });
  }

  async function finishCheckout() {
    if (!basket.session || !basket.lines.length || !basket.payable) return;
    return runAction(async () => {
      const { order } = await checkout(basketId);
      setCompletedOrder(order);
      setShowReceipt(true);
      setCompletedSessionId(basket.session?.sessionId ?? null);
      return "Mock checkout สำเร็จ ไม่มีการเรียกเก็บเงินจริง";
    });
  }

  return { state, basket, basketId, loading, stale, error, notice, pending, refresh, selectBasket, beginSession,
    connection:live.connection, retryAttempt:live.retryAttempt, currentCase, waitingCases, staffCases, receipt, confirmItem, finishCheckout, dismissReceipt: () => setShowReceipt(false) };
}
