import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { DesignFrame } from "../_shared/frame";
import { LiveScreen } from "./screen";

const display = Chakra_Petch({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--live-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--live-mono" });

export const metadata = { title: "FAST | Night Shift" };

export default function Page() {
  return <DesignFrame slug="live" stage="#1b1f1d" dark><LiveScreen fontClass={`${display.variable} ${mono.variable}`} /></DesignFrame>;
}
