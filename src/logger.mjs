export function logEvent(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const write = level === "ERROR" || level === "WARN" ? console.error : console.log;
  write(JSON.stringify(entry));
  return entry;
}
