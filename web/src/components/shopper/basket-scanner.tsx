"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, X } from "lucide-react";
import type { BasketId } from "@/lib/api/types";
import { parseBasketQr } from "./basket-qr";
import styles from "./shopper.module.css";

interface Detector {
  detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorConstructor = {
  new(options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

export function BasketScanner({ onClose, onPair }: {
  onClose: () => void;
  onPair: (id: BasketId, pairingCode?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pair = useRef(onPair);
  const [message, setMessage] = useState("กำลังเตรียมกล้อง…");

  useEffect(() => { pair.current = onPair; }, [onPair]);
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopCamera = () => stream?.getTracks().forEach((track) => track.stop());

    async function scan(detector: Detector) {
      if (cancelled || !video.current) return;
      try {
        if (video.current.readyState >= 2) {
          const codes = await detector.detect(video.current);
          if (cancelled) return;
          for (const code of codes) {
            const id = parseBasketQr(code.rawValue);
            if (id) {
              let pairingCode: string | undefined;
              if (process.env.NEXT_PUBLIC_CLOUD_MODE === "true") {
                try { pairingCode = new URL(code.rawValue, window.location.origin).searchParams.get("code") || undefined; } catch { /* Reject malformed cloud QR below. */ }
                if (!pairingCode || !/^[A-Za-z0-9_-]{43}$/.test(pairingCode)) { setMessage("QR นี้ไม่มีรหัสจับคู่ตะกร้า กรุณาสแกน QR ที่ติดบนตะกร้า"); continue; }
              }
              cancelled = true;
              stopCamera();
              pair.current(id, pairingCode);
              return;
            }
            setMessage("QR ไม่ถูกต้อง ลองสแกน QR บนตะกร้าอีกครั้ง");
          }
        }
        if (!cancelled) timer = setTimeout(() => void scan(detector), 350);
      } catch {
        if (!cancelled) setMessage("อ่าน QR ไม่สำเร็จ กรุณาเลือกตะกร้าด้านล่าง");
        stopCamera();
      }
    }

    async function startCamera() {
      const Constructor = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("เปิดกล้องไม่ได้ กรุณาเปิดผ่านลิงก์ HTTPS หรือเลือกตะกร้าด้านล่าง");
      }
      if (!Constructor || (Constructor.getSupportedFormats && !(await Constructor.getSupportedFormats()).includes("qr_code"))) {
        throw new Error("Browser นี้ไม่รองรับการอ่าน QR กรุณาเลือก Basket A หรือ B ด้านล่าง");
      }
      if (cancelled) return;
      const detector = new Constructor({ formats: ["qr_code"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (cancelled) { stopCamera(); return; }
      if (!video.current) { stopCamera(); return; }
      video.current.srcObject = stream;
      await video.current.play();
      if (cancelled) { stopCamera(); return; }
      setMessage("วาง QR บนตะกร้าให้อยู่ในกรอบ");
      void scan(detector);
    }

    void startCamera().catch((cause) => {
      stopCamera();
      if (cancelled) return;
      setMessage(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "ไม่ได้รับอนุญาตให้ใช้กล้อง เลือกตะกร้าด้านล่างเพื่อเริ่มได้"
        : cause instanceof Error ? cause.message : "เปิดกล้องไม่ได้ กรุณาเลือกตะกร้าด้านล่าง");
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopCamera();
      modal?.close();
    };
  }, []);

  return (
    <dialog ref={dialog} className={styles.scannerDialog} aria-labelledby="scanner-title" onCancel={onClose}>
      <div className={styles.scannerHeader}><span className={styles.iconTile}><QrCode size={23} aria-hidden="true" /></span><button className={styles.scannerClose} aria-label="ปิดกล้อง" onClick={onClose}><X size={21} aria-hidden="true" /></button></div>
      <p className={styles.eyebrow}>BASKET PAIRING</p><h2 id="scanner-title">สแกน QR บนตะกร้า</h2>
      <div className={styles.scannerVideo}><video ref={video} autoPlay muted playsInline aria-label="ภาพจากกล้องสำหรับอ่าน QR" /><div aria-hidden="true" /></div>
      <p className={styles.infoNotice} role="status">{message}</p>
      <p className={styles.muted}>หรือเลือกตะกร้า</p><div className={styles.confirmActions}>{(["A", "B"] as const).map((id) => <button key={id} className={styles.outlineButton} onClick={() => onPair(id)}>ใช้ Basket {id}</button>)}</div>
    </dialog>
  );
}
