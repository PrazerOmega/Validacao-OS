// Hora oficial obtida pela rede (NTP.br — Observatório Nacional), nunca do relógio
// da máquina. Guardamos apenas a diferença (offset) entre a hora oficial e o relógio
// local, e ressincronizamos periodicamente.
import dgram from "node:dgram";

export const BRASILIA_TIMEZONE = "America/Sao_Paulo";

const NTP_SERVERS = (process.env.NTP_SERVERS || "a.ntp.br,b.ntp.br,c.ntp.br,a.st1.ntp.br")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const HTTP_TIME_URLS = ["https://ntp.br", "https://www.google.com"];
const NTP_EPOCH_OFFSET = 2208988800; // segundos entre 1900-01-01 e 1970-01-01
const QUERY_TIMEOUT_MS = 3000;
const RESYNC_INTERVAL_MS = 10 * 60 * 1000;
// Se a última sincronização ficar mais antiga que isso, a hora deixa de ser confiável.
const MAX_STALENESS_MS = 6 * 60 * 60 * 1000;

let offsetMs = null;
let lastSyncLocal = null;
let lastSource = null;
let syncInFlight = null;

export class NetworkTimeUnavailableError extends Error {
  constructor() {
    super("Não foi possível obter o horário oficial de Brasília pela rede. Tente novamente em instantes.");
    this.name = "NetworkTimeUnavailableError";
  }
}

function readNtpTimestamp(buffer, offset) {
  const seconds = buffer.readUInt32BE(offset);
  const fraction = buffer.readUInt32BE(offset + 4);
  return (seconds - NTP_EPOCH_OFFSET) * 1000 + (fraction / 2 ** 32) * 1000;
}

function queryNtp(host) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b; // LI=0, VN=3, Mode=3 (cliente)
    let t0;

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timeout em ${host}`));
    }, QUERY_TIMEOUT_MS);

    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });

    socket.once("message", (msg) => {
      const t3 = Date.now();
      clearTimeout(timer);
      socket.close();
      if (msg.length < 48) return reject(new Error(`resposta inválida de ${host}`));
      const t1 = readNtpTimestamp(msg, 32); // servidor recebeu
      const t2 = readNtpTimestamp(msg, 40); // servidor enviou
      if (!t2 || t2 < 0) return reject(new Error(`resposta inválida de ${host}`));
      resolve({ offset: ((t1 - t0) + (t2 - t3)) / 2, source: `ntp:${host}` });
    });

    t0 = Date.now();
    socket.send(packet, 123, host, (error) => {
      if (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
  });
}

// Plano B quando a porta UDP 123 estiver bloqueada: cabeçalho Date de um servidor HTTPS.
async function queryHttp(url) {
  const t0 = Date.now();
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
  const t3 = Date.now();
  const header = response.headers.get("date");
  const serverMs = header ? Date.parse(header) : NaN;
  if (Number.isNaN(serverMs)) throw new Error(`sem cabeçalho Date em ${url}`);
  // O cabeçalho tem resolução de 1 s: somamos 500 ms para centralizar o erro.
  return { offset: serverMs + 500 - (t0 + t3) / 2, source: `http:${new URL(url).host}` };
}

async function doSync() {
  for (const host of NTP_SERVERS) {
    try {
      return await queryNtp(host);
    } catch {
      // tenta o próximo servidor
    }
  }
  for (const url of HTTP_TIME_URLS) {
    try {
      return await queryHttp(url);
    } catch {
      // tenta o próximo
    }
  }
  throw new NetworkTimeUnavailableError();
}

export async function syncNetworkTime() {
  if (!syncInFlight) {
    syncInFlight = doSync()
      .then((result) => {
        offsetMs = result.offset;
        lastSyncLocal = Date.now();
        lastSource = result.source;
        return result;
      })
      .finally(() => {
        syncInFlight = null;
      });
  }
  return syncInFlight;
}

function isFresh() {
  return offsetMs !== null && Date.now() - lastSyncLocal < MAX_STALENESS_MS;
}

// Hora oficial atual. Sincroniza sob demanda se ainda não houver uma medição válida.
export async function networkNow() {
  if (!isFresh()) {
    try {
      await syncNetworkTime();
    } catch {
      throw new NetworkTimeUnavailableError();
    }
  }
  return new Date(Date.now() + offsetMs);
}

export function networkTimeStatus() {
  return {
    synced: isFresh(),
    source: lastSource,
    syncedAt: lastSyncLocal === null ? null : new Date(lastSyncLocal + offsetMs).toISOString(),
    localClockOffsetMs: offsetMs === null ? null : Math.round(offsetMs)
  };
}

export function startNetworkTimeSync() {
  const run = () =>
    syncNetworkTime()
      .then((r) => console.log(`[Hora oficial] sincronizada via ${r.source} (relógio local ${Math.round(r.offset)} ms de diferença)`))
      .catch((error) => console.error(`[Hora oficial] ${error.message}`));
  run();
  setInterval(run, RESYNC_INTERVAL_MS).unref();
}

// Data no calendário de Brasília ("AAAA-MM-DD") para um instante qualquer.
export function brasiliaDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BRASILIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
