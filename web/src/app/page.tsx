import Link from "next/link";
import { ArrowUpRight, LayoutDashboard, ShoppingBasket, Zap } from "lucide-react";
export default function Home() {
  return <section className="home">
    <div className="home-intro"><span className="home-label"><Zap size={15} fill="currentColor" aria-hidden="true" /> FAST SMART SHOPPING</span><h1>หยิบสิ่งที่ชอบ<br /><span>แล้วไปต่อได้เลย.</span></h1></div>
    <div className="home-routes">
      <Link href="/shopper" className="home-route home-shopper"><ShoppingBasket size={32} strokeWidth={1.5} aria-hidden="true" /><div><p>สำหรับลูกค้า</p><h2>เริ่มช้อป</h2></div><ArrowUpRight size={24} aria-hidden="true" /></Link>
      <Link href="/admin" className="home-route"><LayoutDashboard size={32} strokeWidth={1.5} aria-hidden="true" /><div><p>สำหรับพนักงาน</p><h2>จัดการร้าน</h2></div><ArrowUpRight size={24} aria-hidden="true" /></Link>
    </div>
  </section>;
}
