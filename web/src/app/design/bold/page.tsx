import { Mitr } from "next/font/google";
import { DesignFrame } from "../_shared/frame";
import { BoldScreen } from "./screen";

const font = Mitr({ subsets: ["thai", "latin"], weight: ["400", "500", "600"] });

export const metadata = { title: "FAST | Pop Blocks" };

export default function Page() {
  return <DesignFrame slug="bold" stage="#ffe9a8"><BoldScreen fontClass={font.className} /></DesignFrame>;
}
