import { Anuphan } from "next/font/google";
import { DesignFrame } from "../_shared/frame";
import { WarmScreen } from "./screen";

const font = Anuphan({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"] });

export const metadata = { title: "FAST | Warm Scan" };

export default function Page() {
  return <DesignFrame slug="warm" stage="#e7e0d6"><WarmScreen fontClass={font.className} /></DesignFrame>;
}
