// Hora oficial de Brasília fornecida pela API (que a obtém do NTP.br).
// O relógio do computador do usuário não é usado como referência de data:
// guardamos só a diferença entre ele e a hora oficial.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";
export const BRASILIA_TIMEZONE = "America/Sao_Paulo";
const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

let offsetMs = null;

export async function syncOfficialTime() {
  const t0 = Date.now();
  const response = await fetch(`${API_URL}/time`, { cache: "no-store" });
  const t1 = Date.now();
  if (!response.ok) throw new Error("Hora oficial indisponível.");
  const data = await response.json();
  const serverMs = Date.parse(data.now);
  if (Number.isNaN(serverMs)) throw new Error("Hora oficial inválida.");
  offsetMs = serverMs - (t0 + t1) / 2;
  return data;
}

export function isOfficialTimeSynced() {
  return offsetMs !== null;
}

export function startOfficialTimeSync() {
  setInterval(() => {
    syncOfficialTime().catch(() => {});
  }, RESYNC_INTERVAL_MS);
}

export function officialNow() {
  return new Date(Date.now() + (offsetMs ?? 0));
}

// "AAAA-MM-DD" no calendário de Brasília.
export function brasiliaDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BRASILIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function todayKey() {
  return brasiliaDateKey(officialNow());
}

export function addDaysToKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function keyToBr(dateKey) {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}
