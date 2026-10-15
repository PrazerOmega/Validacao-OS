import cors from "cors";
import express from "express";
import "dotenv/config";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ordersRouter } from "./routes/orders.js";
import { usersRouter } from "./routes/users.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const port = Number(process.env.PORT ?? 3333);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/catalog", requireAuth, catalogRouter);
app.use("/users", requireAuth, usersRouter);
app.use("/orders", requireAuth, ordersRouter);
app.use("/dashboard", requireAuth, dashboardRouter);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Erro interno." });
});

app.listen(port, () => {
  console.log(`API ouvindo em http://localhost:${port}`);
});
