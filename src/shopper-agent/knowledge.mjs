import { readFile } from "node:fs/promises";

const path = new URL("./knowledge/store-guide.md", import.meta.url);
export const shopperGuideVersion = "1";
let guide;
export async function loadShopperGuide() {
  guide ||= readFile(path, "utf8").then(text => text.split(/^# /m).filter(Boolean).map(section => {
    const [heading, ...lines] = section.trim().split("\n");
    const [id, title, keywords] = heading.split("|").map(value => value.trim());
    return Object.freeze({ id: `guide:${id}`, title, version: shopperGuideVersion, keywords: keywords.split(","), text: lines.join("\n").trim(), kind: "guide" });
  }));
  return guide;
}

// Small local corpus: lexical retrieval, no embedding/model calls or external DB.
export function searchShopperGuide(documents, query, limit = 3) {
  const text = query.normalize("NFC").toLowerCase();
  return documents.map(document => ({ document, score: document.keywords.reduce((score, word) => score + (text.includes(word.toLowerCase()) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.document);
}
