import cors from "cors";
import express from "express";
import "dotenv/config";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ordersRouter } from "./routes/orders.js";
import { usersRouter } from "./routes/users.js";
import { notificationsRouter } from "./routes/notifications.js";
import { requireAuth } from "./middleware/auth.js";
import {
  BRASILIA_TIMEZONE,
  NetworkTimeUnavailableError,
  brasiliaDateKey,
  networkNow,
  networkTimeStatus,
  startNetworkTimeSync
} from "./utils/networkTime.js";

const app = express();
const port = Number(process.env.PORT ?? 3333);

const rawCorsOrigin = process.env.CORS_ORIGIN;

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (!rawCorsOrigin || rawCorsOrigin === "*") return true;

  const allowedOrigins = rawCorsOrigin.split(",").map((s) => s.trim());
  if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) return true;

  // Permite conexões locais e de rede local (LAN: 192.168.x.x, 10.x.x.x, 172.16-31.x.x, localhost)
  const isLanOrLocal =
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
    /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);

  return isLanOrLocal;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Hora oficial de Brasília (via rede) para o frontend não depender do relógio do usuário.
app.get("/time", async (_req, res) => {
  const now = await networkNow();
  res.set("Cache-Control", "no-store");
  res.json({
    now: now.toISOString(),
    timezone: BRASILIA_TIMEZONE,
    today: brasiliaDateKey(now),
    ...networkTimeStatus()
  });
});

app.use("/auth", authRouter);
app.use("/catalog", requireAuth, catalogRouter);
app.use("/users", requireAuth, usersRouter);
app.use("/orders", requireAuth, ordersRouter);
app.use("/dashboard", requireAuth, dashboardRouter);
app.use("/notification-emails", requireAuth, notificationsRouter);

app.use((error, _req, res, _next) => {
  if (error instanceof NetworkTimeUnavailableError) {
    return res.status(503).json({ message: error.message });
  }
  console.error(error);
  res.status(500).json({ message: "Erro interno." });
});

startNetworkTimeSync();

app.listen(port, "0.0.0.0", () => {
  console.log(`API ouvindo em http://localhost:${port}`);
});
