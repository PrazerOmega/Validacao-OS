import { brasiliaDateKey } from "./networkTime.js";

// Ano da numeração no calendário de Brasília, a partir de um instante já obtido da rede.
export function orderYearFor(date) {
  return Number(brasiliaDateKey(date).slice(0, 4));
}

// A numeração reinicia a cada ano: a primeira OS do ano é "01/AAAA".
export function formatOrderCode(sequence, year) {
  return `${String(sequence).padStart(2, "0")}/${year}`;
}
