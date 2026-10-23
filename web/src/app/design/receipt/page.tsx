import { IBM_Plex_Mono, IBM_Plex_Sans_Thai, Noto_Serif_Thai } from "next/font/google";
import { DesignFrame } from "../_shared/frame";
import { ReceiptScreen } from "./screen";

const serif = Noto_Serif_Thai({ subsets: ["thai", "latin"], weight: ["500", "700"], variable: "--r-serif" });
const sans = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--r-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--r-mono" });

export const metadata = { title: "FAST | Paper Receipt" };

export default function Page() {
  return <DesignFrame slug="receipt" stage="#dedad2"><ReceiptScreen fontClass={`${serif.variable} ${sans.variable} ${mono.variable}`} /></DesignFrame>;
}
