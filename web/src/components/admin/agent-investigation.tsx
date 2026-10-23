import type { BasketCase } from "@/lib/api/types";
import styles from "./admin.module.css";

export function AgentInvestigation({ item }: { item: BasketCase }) {
  return <>
    {item.agent?.mode === "AGENTIC" && <div className={styles.timeline}>
      <h3>Agentic investigation</h3>
      <p className={styles.footnote}>สูงสุด 8 ขั้น · 25 วินาที</p>
      <ol tabIndex={0} aria-label="ขั้นตอนการตรวจสอบของ Agent">{item.agent.steps?.map((step, index) => <li key={`${step.number}-${step.phase}-${index}`}>
        <span className={styles.timelineDot} />
        <div><strong>Step {step.number} · {step.phase === "SELECT" ? "Model selected" : "Observation"} · {step.action}</strong>
          {step.model && <p>{step.model}{step.confidence !== undefined ? ` · selection probability ${Math.round(step.confidence * 100)}%` : ""}</p>}
          <p>{step.summary}</p>
          {step.availableActions && <details><summary>Available actions</summary><p>{step.availableActions.join(" · ")}</p></details>}
        </div>
      </li>)}</ol>
    </div>}
    {item.toolCalls.length > 0 && <div className={styles.tools} aria-label="Evidence tool results">
      {item.toolCalls.map((tool, index) => <details key={`${tool.name}-${index}`}>
        <summary>{tool.name} · {tool.status}</summary>
        <p>{tool.summary}</p>
        <pre className={styles.evidenceJson} tabIndex={0} aria-label="ผลลัพธ์ของเครื่องมือ">{JSON.stringify({ input: tool.input, result: tool.result }, null, 2)}</pre>
      </details>)}
    </div>}
  </>;
}
