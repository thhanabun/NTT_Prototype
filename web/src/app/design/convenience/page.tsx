import { Prompt } from "next/font/google";
import { DesignFrame } from "../_shared/frame";
import { MartScreen } from "./screen";

const font = Prompt({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"] });

export const metadata = { title: "FAST | Quick Mart" };

export default function Page() {
  return <DesignFrame slug="convenience" stage="#e4efe8"><MartScreen fontClass={font.className} /></DesignFrame>;
}
