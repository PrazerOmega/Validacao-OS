import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Cpu,
  Edit3,
  FileSignature,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  UserCheck,
  Users,
  UserPlus,
  Wrench,
  XCircle
} from "lucide-react";
import "./styles.css";
import {
  BRASILIA_TIMEZONE,
  addDaysToKey,
  brasiliaDateKey,
  keyToBr,
  startOfficialTimeSync,
  syncOfficialTime,
  todayKey
} from "./officialTime.js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

const statusLabels = {
  draft: "Rascunho",
  pending_signature: "Pendente Validação",
  correction_requested: "Aguardando correção",
  divergent: "Divergente",
  signed: "Aprovada",
  cancelled: "Cancelada",
  awaiting_stock_check: "Aguardando conferência",
  stock_checking: "Em conferência",
  stock_picking: "Em separação",
  stock_returned: "Retorno do estoque"
};

const statusIcons = {
  draft: Edit3,
  pending_signature: Clock3,
  correction_requested: RefreshCw,
  divergent: AlertTriangle,
  signed: CheckCircle2,
  cancelled: XCircle,
  awaiting_stock_check: Inbox,
  stock_checking: ClipboardList,
  stock_picking: Activity,
  stock_returned: AlertTriangle
};

// Acessórios que o Estoque marca como enviados junto do terminal; requestedBy indica o que a OS pediu
const stockAccessoryOptions = [
  { key: "battery", label: "Bateria", requestedBy: (item) => item.battery === "SIM" },
  { key: "charger", label: "Carregador", requestedBy: (item) => item.charger === "SIM" },
  { key: "manual", label: "Manual", requestedBy: (item) => item.manual === "SIM" },
  { key: "minbase", label: "Minbase", requestedBy: (item) => item.minbase === "SIM" },
  { key: "label", label: "Label", requestedBy: (item) => item.label === "SIM" },
  { key: "aesthetic_cover", label: "Cobre estético", requestedBy: (item) => item.aesthetic_cover === "SIM" },
  { key: "packaging", label: "Embalagem", requestedBy: (item) => Boolean(item.packaging) }
];

function stockAccessoryLabel(key) {
  return stockAccessoryOptions.find((option) => option.key === key)?.label ?? key;
}

const stockResultOptions = [
  { value: "complete", label: "Completo" },
  { value: "partial", label: "Parcial" },
  { value: "shortage", label: "Pendência de estoque" }
];

const orderTypeOptions = [
  { value: "Reparo", label: "Reparo" },
  { value: "Atualizacao", label: "Atualização" },
  { value: "Teste", label: "Teste" }
];

const defaultCatalog = {
  orderTypes: orderTypeOptions.map((option) => ({ id: option.value, name: option.value })),
  terminalModels: ["D195", "S920", "Q92x", "A910", "P2"].map((name) => ({ id: name, name })),
  partNumbers: []
};

const roleOptions = [
  { value: "requester", label: "Operações" },
  { value: "signer", label: "Suporte" },
  { value: "stock", label: "Estoque" },
  { value: "spectator", label: "Produção" },
  { value: "admin", label: "Admin" }
];

const destinationOptions = [
  { value: "signer", label: "Suporte" }
];

const ITEM_MANDATORY_OPTIONS = [
  { key: "packaging", label: "Embalagem", choices: ["CAIXA", "SACO BOLHA"] },
  { key: "battery", label: "Bateria", choices: ["SIM", "NÃO"] },
  { key: "terminalOpening", label: "Abertura de Terminal", choices: ["SIM", "NÃO"] },
  { key: "manual", label: "Manual", choices: ["SIM", "NÃO"] },
  { key: "charger", label: "Carregador", choices: ["SIM", "NÃO"] },
  { key: "minbase", label: "Minbase", choices: ["SIM", "NÃO"] },
  { key: "label", label: "Label", choices: ["SIM", "NÃO"] },
  { key: "aestheticCover", label: "Cobre Estético", choices: ["SIM", "NÃO"] }
];

function createEmptyItem() {
  return {
    itemName: "",
    itemIdentifier: "D195",
    partNumber: "",
    isCustomPn: false,
    clientName: "",
    quantity: 1,
    configuration: "",
    packaging: "",
    battery: "",
    terminalOpening: "",
    manual: "",
    charger: "",
    minbase: "",
    label: "",
    aestheticCover: ""
  };
}

function createEmptyOrder(userName = "") {
  return {
    orderType: "Reparo",
    executorTeam: "suporte",
    authorizedPersonName: userName,
    authorizedPersonDocument: "",
    validFrom: "",
    validUntil: "",
    signatureDueAt: "",
    destinationRole: "signer",
    items: [createEmptyItem()]
  };
}

function useApi(session, onUnauthorized) {
  // O callback fica em uma ref para que o objeto `api` só mude quando o token mudar.
  // Sem isso, cada render do App criaria um novo `api` e dispararia novamente todos
  // os efeitos que dependem dele (painéis refazendo requisições a cada render).
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const token = session?.token;

  return useMemo(() => {
    async function request(path, options = {}) {
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers
        }
      });

      if (response.status === 401) {
        onUnauthorizedRef.current?.();
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? "Erro ao comunicar com a API.");
      }

      return data;
    }

    return { request };
  }, [token]);
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-switch-btn"
      onClick={onToggle}
      role="switch"
      aria-checked={isDark}
      aria-label="Alternar tema claro e escuro"
      title={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
    >
      <span className={`theme-switch-icon ${!isDark ? "active" : ""}`}>
        <Sun size={15} />
      </span>
      <span className="theme-switch-slider">
        <span className="theme-switch-thumb" />
      </span>
      <span className={`theme-switch-icon ${isDark ? "active" : ""}`}>
        <Moon size={15} />
      </span>
    </button>
  );
}

function Login({ onLogin, theme, onToggleTheme }) {
  // Credenciais de demonstração só vêm preenchidas em desenvolvimento, nunca no build de produção
  const [email, setEmail] = useState(import.meta.env.DEV ? "solicitante@empresa.com" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "123456" : "");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        throw new Error(data?.message ?? "Falha no login. Tente novamente.");
      }

      onLogin(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-page">
      <div className="login-theme-bar">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <section className="login-panel">
        <div>
          <p className="eyebrow">Controle de autorizações</p>
          <h1>Ordens de Serviço</h1>
        </div>
        <form onSubmit={submit} className="stack">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className="alert">{error}</p>}
          <button className="primary" type="submit">
            <ShieldCheck size={18} />
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}

const realtimeSyncChannel = typeof window !== "undefined" && "BroadcastChannel" in window
  ? new BroadcastChannel("validacao_os_sync")
  : null;

// Executa uma ação cuja mensagem de erro já é exibida por quem a implementa (ex.: runOrderAction),
// evitando que a rejeição vaze como "Uncaught (in promise)" no console.
// Mesmo mínimo do feedbackSchema da API (POST /orders/:id/request-correction)
const MIN_CORRECTION_LENGTH = 5;

function runHandled(action, ...args) {
  return Promise.resolve()
    .then(() => action?.(...args))
    .catch(() => {});
}

// Elementos com role="button" devem responder a Enter e Espaço, como um botão nativo
function activateOnKey(event, action) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function notifyRealtimeSync() {
  if (realtimeSyncChannel) {
    try {
      realtimeSyncChannel.postMessage({ type: "SYNC", timestamp: Date.now() });
    } catch (_) {}
  }
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("app_theme") || "light");
  const [session, setSession] = useState(() => {
    // Um valor corrompido no armazenamento não pode deixar a aplicação em branco
    try {
      const stored = localStorage.getItem("ordens:session");
      return stored ? JSON.parse(stored) : null;
    } catch {
      localStorage.removeItem("ordens:session");
      return null;
    }
  });
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(defaultCatalog);
  const [form, setForm] = useState(() => createEmptyOrder(session?.user?.name ?? ""));
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "requester" });
  const [newCatalogItem, setNewCatalogItem] = useState({ orderType: "", terminalModel: "" });
  const [newPartNumberItem, setNewPartNumberItem] = useState({ modelName: "D195", partNumber: "" });
  const [message, setMessage] = useState("");
  const [notification, setNotification] = useState(null);
  const [adminMenu, setAdminMenu] = useState("dashboard");
  const [userMenu, setUserMenu] = useState("dashboard");
  const [adminStatusFilter, setAdminStatusFilter] = useState("total");
  const [userStatusFilter, setUserStatusFilter] = useState("todas");
  const [postSaveModalOrder, setPostSaveModalOrder] = useState(null);
  const [isSubmittingPostSave, setIsSubmittingPostSave] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [executorTab, setExecutorTab] = useState("suporte");
  const [counts, setCounts] = useState({ suporte: 0, producao: 0, unassigned: 0 });
  const executorTabRef = useRef(executorTab);

  useEffect(() => {
    executorTabRef.current = executorTab;
  }, [executorTab]);

  function handleExecutorTabChange(tab) {
    setExecutorTab(tab);
    executorTabRef.current = tab;
    setSelected(null);
    loadData(tab);
  }

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  function safeNavigate(navigationFn) {
    if (userMenu === "create" && editingId) {
      setPendingNavigation(() => navigationFn);
      setShowUnsavedPrompt(true);
    } else {
      navigationFn();
    }
  }

  function handleNavigateOrdersFromDashboard(statusKey) {
    safeNavigate(() => {
      if (counts?.suporte === 0 && counts?.producao > 0 && executorTabRef.current === "suporte") {
        setExecutorTab("producao");
        executorTabRef.current = "producao";
        loadData("producao");
      }
      if (session?.user?.role === "admin") {
        setAdminStatusFilter(statusKey);
        setAdminMenu("orders");
      } else {
        setUserStatusFilter(dashboardStatusToUserFilter(statusKey));
        setUserMenu("orders");
      }
    });
  }

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (userMenu === "create" && editingId) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [userMenu, editingId]);

  const api = useApi(session, logout);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app_theme", theme);
  }, [theme]);

  // Encerra a sessão imediatamente (também usado quando o token expira, sem confirmação)
  function logout() {
    localStorage.removeItem("ordens:session");
    setShowLogoutConfirm(false);
    setSession(null);
  }

  // Clique em "Sair": pede confirmação antes de encerrar a sessão
  function requestLogout() {
    setShowLogoutConfirm(true);
  }

  function login(data) {
    localStorage.setItem("ordens:session", JSON.stringify(data));
    setSession(data);
    setSignatureName(data.user.email);
    setForm(createEmptyOrder(data.user.name));
  }

  async function loadData(team = executorTabRef.current) {
    if (!session) return;

    try {
      const activeTeam = team || executorTabRef.current || "suporte";
      const [orderList, catalogList, countsRes] = await Promise.all([
        api.request(`/orders?executorTeam=${activeTeam}`),
        api.request("/catalog"),
        api.request("/orders/counts").catch(() => null)
      ]);
      setOrders(orderList);
      setCatalog(catalogList);
      if (countsRes) {
        setCounts(countsRes);
      }

      if (session.user.role === "admin") {
        setUsers(await api.request("/users"));
      }

      // Sincroniza os detalhes da ordem selecionada caso ela tenha sido modificada no backend
      setSelected((prevSelected) => {
        if (!prevSelected) return null;
        const currentInList = orderList.find((o) => o.id === prevSelected.id);
        if (currentInList && currentInList.updated_at !== prevSelected.updated_at) {
          api.request(`/orders/${prevSelected.id}`).then((fresh) => {
            setSelected((curr) => (curr?.id === fresh.id ? fresh : curr));
          }).catch(() => {});
        }
        return prevSelected;
      });
    } catch (err) {
      console.warn("Falha na sincronização:", err.message);
    }
  }

  // Sincronização contínua e em tempo real (Admin e Solicitante sempre atualizados)
  useEffect(() => {
    if (!session) return;

    if (!signatureName) {
      setSignatureName(session.user.email);
    }

    loadData(executorTabRef.current);

    // Polling controlado para refletir alterações sem sobrecarregar o banco
    const interval = setInterval(() => {
      if (!document.hidden) {
        loadData(executorTabRef.current);
      }
    }, 8000);

    function handleSyncEvent() {
      if (!document.hidden) {
        loadData(executorTabRef.current);
      }
    }

    const handleBroadcast = (ev) => {
      if (ev.data?.type === "SYNC") {
        loadData(executorTabRef.current);
      }
    };

    if (realtimeSyncChannel) {
      realtimeSyncChannel.addEventListener("message", handleBroadcast);
    }

    window.addEventListener("focus", handleSyncEvent);
    window.addEventListener("storage", handleSyncEvent);
    document.addEventListener("visibilitychange", handleSyncEvent);

    return () => {
      clearInterval(interval);
      if (realtimeSyncChannel) {
        realtimeSyncChannel.removeEventListener("message", handleBroadcast);
      }
      window.removeEventListener("focus", handleSyncEvent);
      window.removeEventListener("storage", handleSyncEvent);
      document.removeEventListener("visibilitychange", handleSyncEvent);
    };
  }, [session]);

  // Atualização instantânea ao alternar menus
  useEffect(() => {
    if (session) {
      loadData(executorTabRef.current);
    }
  }, [adminMenu, userMenu]);

  async function selectOrder(order) {
    if (!order) {
      setSelected(null);
      return;
    }
    try {
      const fullOrder = await api.request(`/orders/${order.id}`);
      setSelected(fullOrder);
      if (fullOrder?.executor_team && fullOrder.executor_team !== executorTabRef.current) {
        setExecutorTab(fullOrder.executor_team);
        executorTabRef.current = fullOrder.executor_team;
        await loadData(fullOrder.executor_team);
      }
    } catch (err) {
      setMessage(err.message);
    }
  }

  function startEdit(order) {
    setEditingId(order.id);
    setUserMenu("create");
    setForm({
      orderType: order.order_type ?? "Reparo",
      executorTeam: order.executor_team || "suporte",
      authorizedPersonName: order.authorized_person_name,
      authorizedPersonDocument: order.code || order.authorized_person_document || "",
      validFrom: order.valid_from?.slice(0, 10),
      validUntil: order.valid_until?.slice(0, 10),
      signatureDueAt: order.signature_due_at,
      destinationRole: order.destination_role ?? "signer",
      items: order.items?.length
        ? order.items.map((item) => {
          const allowed = (catalog.partNumbers ?? []).filter(
            (pn) => (pn.model_name || pn.terminal_model_name) === item.terminal_model
          );
          const isPreset = allowed.some((pn) => pn.part_number === item.part_number);
          return {
            itemName: item.item_name || "",
            itemIdentifier: item.terminal_model,
            partNumber: item.part_number,
            isCustomPn: !isPreset && Boolean(item.part_number && item.part_number !== "-"),
            clientName: item.client_name,
            quantity: item.quantity,
            configuration: item.configuration,
            packaging: item.packaging || "",
            battery: item.battery || "",
            terminalOpening: item.terminal_opening || item.terminalOpening || "",
            manual: item.manual || "",
            charger: item.charger || "",
            minbase: item.minbase || "",
            label: item.label || "",
            aestheticCover: item.aesthetic_cover || item.aestheticCover || ""
          };
        })
        : [{
          itemName: order.item_name || "",
          itemIdentifier: order.item_identifier,
          partNumber: "-",
          isCustomPn: false,
          clientName: "-",
          quantity: 1,
          configuration: order.usage_reason,
          packaging: "",
          battery: "",
          terminalOpening: "",
          manual: "",
          charger: "",
          minbase: "",
          label: "",
          aestheticCover: ""
        }]
    });
  }

  async function saveOrder(event) {
    event.preventDefault();
    setMessage("");

    for (let i = 0; i < form.items.length; i++) {
      const it = form.items[i];
      const itemNum = i + 1;

      if (it.isCustomPn && (!it.partNumber || !it.partNumber.trim())) {
        setMessage(`Item ${itemNum}: Informe o Part Number (opção "Outros").`);
        return;
      }

      const missingOption = ITEM_MANDATORY_OPTIONS.find((opt) => !opt.choices.includes(it[opt.key]));
      if (missingOption) {
        setMessage(
          `Item ${itemNum}: Selecione a opção obrigatória "${missingOption.label}" (${missingOption.choices.join(" ou ")}).`
        );
        return;
      }
    }

    try {
      const method = editingId ? "PUT" : "POST";
      const path = editingId ? `/orders/${editingId}` : "/orders";
      const saved = await api.request(path, {
        method,
        body: JSON.stringify({
          ...form,
          executorTeam: form.executorTeam || "suporte",
          validUntil: form.validUntil || null
        })
      });

      const fullOrder = await api.request(`/orders/${saved.id}`);
      startEdit(fullOrder);
      if (saved.executor_team) {
        setExecutorTab(saved.executor_team);
      }
      await loadData(saved.executor_team || executorTab);
      notifyRealtimeSync();
      setMessage(editingId ? "Ordem atualizada com sucesso!" : "Ordem salva com sucesso!");
      setPostSaveModalOrder(fullOrder);
    } catch (err) {
      setMessage(err.message || "Erro ao salvar ordem de serviço.");
    }
  }

  async function runOrderAction(path, body) {
    setMessage("");
    try {
      const result = await api.request(path, {
        method: "POST",
        body: JSON.stringify(body ?? {})
      });
      if (result?.incorrectSignature) {
        setNotification({
          type: "warning",
          title: "Assinatura incorreta",
          message: result.message || "A assinatura foi identificada como incorreta e a ordem retornou para a etapa de assinatura."
        });
      } else if (result?.divergent) {
        setNotification({
          type: "warning",
          title: "Divergência identificada",
          message: result.message || "A contagem informada diverge da validação anterior."
        });
      } else {
        setNotification(null);
      }
      await loadData();
      notifyRealtimeSync();
      if (selected) {
        // OS divergente sai da visão do assinante: fecha o detalhe em vez de recarregá-lo
        if (session.user.role === "signer" && result?.status === "divergent") {
          setSelected(null);
        } else {
          setSelected(await api.request(`/orders/${selected.id}`));
        }
      }
      return result;
    } catch (err) {
      setMessage(err.message);
      throw err;
    }
  }

  async function createUser(event) {
    event.preventDefault();
    try {
      await api.request("/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      });
      setNewUser({ name: "", email: "", password: "", role: "requester" });
      setUsers(await api.request("/users"));
      notifyRealtimeSync();
      setMessage("Usuário cadastrado com sucesso.");
    } catch (err) {
      setMessage(err.message || "Erro ao criar usuário.");
    }
  }

  async function updateUser(userId, changes) {
    try {
      await api.request(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      setUsers(await api.request("/users"));
      notifyRealtimeSync();
      setMessage("Usuário atualizado com sucesso.");
    } catch (err) {
      setMessage(err.message || "Erro ao atualizar usuário.");
    }
  }

  async function removeUser(userId) {
    try {
      await api.request(`/users/${userId}`, { method: "DELETE" });
      setUsers(await api.request("/users"));
      notifyRealtimeSync();
      setMessage("Usuário desativado com sucesso.");
    } catch (err) {
      setMessage(err.message || "Erro ao desativar usuário.");
    }
  }

  async function clearAllOrders() {
    setMessage("");
    try {
      await api.request("/orders/all", { method: "DELETE" });
      setSelected(null);
      await loadData();
      notifyRealtimeSync();
      setMessage("Todas as ordens de serviço foram limpas com sucesso.");
    } catch (err) {
      setMessage(err.message || "Erro ao limpar ordens de serviço.");
      throw err;
    }
  }

  async function createCatalogItem(kind, event) {
    event.preventDefault();
    try {
      if (kind === "part-numbers") {
        const { modelName, partNumber } = newPartNumberItem;
        if (!modelName || !partNumber.trim()) return;

        await api.request("/catalog/part-numbers", {
          method: "POST",
          body: JSON.stringify({
            modelName,
            terminalModelName: modelName,
            partNumber: partNumber.trim()
          })
        });

        setNewPartNumberItem((current) => ({ ...current, partNumber: "" }));
        setCatalog(await api.request("/catalog"));
        notifyRealtimeSync();
        setMessage("Part Number adicionado ao catálogo com sucesso.");
        return;
      }

      const field = kind === "order-types" ? "orderType" : "terminalModel";
      const name = newCatalogItem[field].trim();

      if (!name) return;

      await api.request(`/catalog/${kind}`, {
        method: "POST",
        body: JSON.stringify({ name })
      });

      setNewCatalogItem((current) => ({ ...current, [field]: "" }));
      setCatalog(await api.request("/catalog"));
      notifyRealtimeSync();
      setMessage("Item adicionado ao catálogo com sucesso.");
    } catch (err) {
      setMessage(err.message || "Erro ao adicionar item ao catálogo.");
    }
  }

  if (!session) {
    return (
      <Login
        onLogin={login}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
    );
  }

  const canCreate = ["requester", "admin"].includes(session.user.role);
  const isAdmin = session.user.role === "admin";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Ordens digitais</p>
          <h2>{session.user.name}</h2>
          <span className="role-pill">{session.user.role}</span>
        </div>
        {isAdmin ? (
          <>
            <nav className="sidebar-menu" aria-label="Menus do admin">
              <button className={`sidebar-btn sidebar-btn-secondary ${adminMenu === "dashboard" ? "active" : ""}`} onClick={() => safeNavigate(() => setAdminMenu("dashboard"))}>
                <LayoutDashboard size={16} />
                <span>Dashboard</span>
              </button>
              <button className={`sidebar-btn sidebar-btn-secondary ${adminMenu === "orders" ? "active" : ""}`} onClick={() => safeNavigate(() => setAdminMenu("orders"))}>
                <ClipboardList size={16} />
                <span>Ordens</span>
              </button>
              <button className={`sidebar-btn sidebar-btn-secondary ${adminMenu === "occurrences" ? "active" : ""}`} onClick={() => safeNavigate(() => setAdminMenu("occurrences"))}>
                <AlertTriangle size={16} />
                <span>Ocorrências</span>
              </button>
              <button className={`sidebar-btn sidebar-btn-secondary ${adminMenu === "users" ? "active" : ""}`} onClick={() => safeNavigate(() => setAdminMenu("users"))}>
                <Users size={16} />
                <span>Usuários</span>
              </button>
              <button className={`sidebar-btn sidebar-btn-secondary ${adminMenu === "items" ? "active" : ""}`} onClick={() => safeNavigate(() => setAdminMenu("items"))}>
                <Plus size={16} />
                <span>Adicionar item</span>
              </button>
            </nav>
            <button type="button" className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={() => safeNavigate(requestLogout)}>
              <LogOut size={16} />
              <span>Sair</span>
            </button>
          </>
        ) : session.user.role === "requester" ? (
          <nav className="sidebar-menu" aria-label="Menus do solicitante">
            <button
              className={`sidebar-btn sidebar-btn-secondary ${userMenu === "dashboard" ? "active" : ""}`}
              onClick={() => safeNavigate(() => setUserMenu("dashboard"))}
            >
              <LayoutDashboard size={16} />
              <span>Dashboard</span>
            </button>
            {/* Criar/editar ordem é aberto pelo botão "Nova ordem" do Histórico, que fica destacado nesse fluxo */}
            <button
              className={`sidebar-btn sidebar-btn-secondary ${["orders", "create"].includes(userMenu) ? "active" : ""}`}
              onClick={() => safeNavigate(() => setUserMenu("orders"))}
            >
              <ClipboardList size={16} />
              <span>Histórico de ordens</span>
            </button>
            <button type="button" className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={() => safeNavigate(requestLogout)}>
              <LogOut size={16} />
              <span>Sair</span>
            </button>
          </nav>
        ) : (
          <nav className="sidebar-menu" aria-label="Menus do usuario">
            <button
              className={`sidebar-btn sidebar-btn-secondary ${userMenu === "dashboard" ? "active" : ""}`}
              onClick={() => setUserMenu("dashboard")}
            >
              <LayoutDashboard size={16} />
              <span>Dashboard</span>
            </button>
            <button
              className={`sidebar-btn sidebar-btn-secondary ${userMenu === "orders" ? "active" : ""}`}
              onClick={() => setUserMenu("orders")}
            >
              <ClipboardList size={16} />
              <span>Histórico de ordens</span>
            </button>
            {session.user.role === "signer" && (
              <button
                className={`sidebar-btn sidebar-btn-secondary ${userMenu === "occurrences" ? "active" : ""}`}
                onClick={() => setUserMenu("occurrences")}
              >
                <AlertTriangle size={16} />
                <span>Ocorrências</span>
              </button>
            )}
            <button type="button" className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={requestLogout}>
              <LogOut size={16} />
              <span>Sair</span>
            </button>
          </nav>
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>
              {isAdmin
                ? (adminMenu === "dashboard" ? "Dashboard" : adminMenu === "occurrences" ? "Ocorrências" : "Admin")
                : (userMenu === "dashboard"
                  ? "Dashboard"
                  : userMenu === "occurrences"
                    ? "Ocorrências"
                    : (session.user.role === "requester"
                      ? (userMenu === "create" ? "Solicitante" : "Histórico de ordens")
                      : "Histórico de ordens"))}
            </h1>
            <p className="muted">
              {isAdmin
                ? (adminMenu === "dashboard"
                    ? "Visão geral e indicadores das ordens de serviço."
                    : adminMenu === "occurrences"
                      ? "Auditoria e gestão de ordens com tentativas incorretas de assinatura."
                      : "Gerencie usuários e acompanhe todas as ordens de serviço.")
                : (userMenu === "dashboard"
                  ? "Visão geral e indicadores das ordens de serviço."
                  : userMenu === "occurrences"
                    ? "Auditoria e gestão de ordens com tentativas incorretas de assinatura."
                    : (session.user.role === "requester"
                      ? (userMenu === "create" ? "Crie e acompanhe suas ordens de serviço." : "Consulte suas ordens criadas e acompanhe seus status.")
                      : session.user.role === "stock"
                        ? "Confira o material de cada ordem antes do envio ao Suporte."
                        : "A aprovação exige duas assinaturas registradas."))}
            </p>
          </div>
          <div className="topbar-actions">
            {message && <span className="toast">{message}</span>}
            <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
          </div>
        </header>

        {notification && (
          <div className={`notification-banner ${notification.type || "warning"}`}>
            <div className="notification-content">
              <strong>{notification.title}</strong>
              <p>{notification.message}</p>
            </div>
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => setNotification(null)}
              aria-label="Fechar aviso"
            >
              <XCircle size={18} />
            </button>
          </div>
        )}

        {isAdmin ? (
          adminMenu === "dashboard" ? (
            <DashboardPanel
              session={session}
              api={api}
              onNavigateOrders={handleNavigateOrdersFromDashboard}
            />
          ) : (
            <AdminConsole
              activeMenu={adminMenu}
              orders={orders}
              selected={selected}
              users={users}
              catalog={catalog}
              currentUserId={session.user.id}
              newUser={newUser}
              setNewUser={setNewUser}
              newCatalogItem={newCatalogItem}
              setNewCatalogItem={setNewCatalogItem}
              newPartNumberItem={newPartNumberItem}
              setNewPartNumberItem={setNewPartNumberItem}
              feedback={feedback}
              setFeedback={setFeedback}
              signatureName={signatureName}
              setSignatureName={setSignatureName}
              onCreateUser={createUser}
              onUpdateUser={updateUser}
              onRemoveUser={removeUser}
              onCreateCatalogItem={createCatalogItem}
              onSelectOrder={selectOrder}
              onSubmitOrder={() => runOrderAction(`/orders/${selected.id}/submit`)}
              onSignOrder={(keyCount) => runOrderAction(`/orders/${selected.id}/sign`, { keyCount: Number(keyCount) })}
              onCorrection={(msg) => runOrderAction(`/orders/${selected.id}/request-correction`, { message: msg })}
              onIncorrectSignature={() => runOrderAction(`/orders/${selected.id}/incorrect-signature`)}
              onOrderAction={(action, body) => runOrderAction(`/orders/${selected.id}/${action}`, body)}
              onEditOrder={startEdit}
              onClearAllOrders={clearAllOrders}
              session={session}
              executorTab={executorTab}
              onExecutorTabChange={handleExecutorTabChange}
              counts={counts}
              initialStatusFilter={adminStatusFilter}
              api={api}
              onNavigateToOrdersTab={() => setAdminMenu("orders")}
            />
          )
        ) : userMenu === "dashboard" ? (
          <DashboardPanel
            session={session}
            api={api}
            onNavigateCreate={() => {
              safeNavigate(() => {
                setEditingId(null);
                setForm(createEmptyOrder(session?.user?.name ?? ""));
                setUserMenu("create");
              });
            }}
            onNavigateOrders={handleNavigateOrdersFromDashboard}
          />
        ) : userMenu === "occurrences" ? (
          <OccurrencesPanel
            api={api}
            onSelectOrder={(orderId) => {
              setUserMenu("orders");
              // selectOrder já busca a ordem completa e troca a aba da equipe
              selectOrder({ id: orderId });
            }}
          />
        ) : session.user.role === "requester" && userMenu === "create" ? (
          <div className="requester-create-container">
            <OrderForm
              form={form}
              setForm={setForm}
              catalog={catalog}
              editingId={editingId}
              onSubmit={saveOrder}
              onCancel={() => {
                safeNavigate(() => {
                  setEditingId(null);
                  setForm(createEmptyOrder(session?.user?.name ?? ""));
                  setUserMenu("orders");
                });
              }}
              onDirectSubmit={async () => {
                if (!editingId) return;
                try {
                  await runOrderAction(`/orders/${editingId}/submit`);
                  setEditingId(null);
                  setForm(createEmptyOrder(session?.user?.name ?? ""));
                  setUserMenu("orders");
                  setMessage("Ordem enviada com sucesso para validação.");
                } catch (err) {
                  console.error("Erro ao enviar ordem:", err);
                }
              }}
              session={session}
              api={api}
            />
          </div>
        ) : (
          <UserOrdersPanel
            orders={orders}
            selected={selected}
            session={session}
            feedback={feedback}
            setFeedback={setFeedback}
            signatureName={signatureName}
            setSignatureName={setSignatureName}
            onSelectOrder={selectOrder}
            onNewOrder={() => {
              safeNavigate(() => {
                setEditingId(null);
                setForm(createEmptyOrder(session?.user?.name ?? ""));
                setUserMenu("create");
              });
            }}
            onSubmit={() => runOrderAction(`/orders/${selected.id}/submit`)}
            onSign={(keyCount) => runOrderAction(`/orders/${selected.id}/sign`, { keyCount: Number(keyCount) })}
            onCorrection={(msg) => runOrderAction(`/orders/${selected.id}/request-correction`, { message: msg })}
            onIncorrectSignature={() => runOrderAction(`/orders/${selected.id}/incorrect-signature`)}
            onOrderAction={(action, body) => runOrderAction(`/orders/${selected.id}/${action}`, body)}
            onEdit={startEdit}
            executorTab={executorTab}
            onExecutorTabChange={handleExecutorTabChange}
            counts={counts}
            initialFilter={userStatusFilter}
          />
        )}
      </section>

      {/* Modal 1: Confirmação pós-salvar (EDITAR ou ENVIAR) */}
      {postSaveModalOrder && (
        <div className="modal-overlay" onClick={() => !isSubmittingPostSave && setPostSaveModalOrder(null)}>
          <div className="modal-dialog post-save-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-badge success">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3>Ordem salva!</h3>
                <p className="modal-subtitle">O que deseja fazer com esta ordem?</p>
              </div>
            </div>
            <div className="modal-body">
              <div className="post-save-card">
                <div className="post-save-card-header">
                  <span className="post-save-code">OS {postSaveModalOrder.code}</span>
                  <span className="post-save-badge">Rascunho</span>
                </div>
                <div className="post-save-meta-grid">
                  <div className="post-save-meta-item">
                    <span className="post-save-meta-label">Solicitante</span>
                    <span className="post-save-meta-value">{postSaveModalOrder.requester_name || session?.user?.name}</span>
                  </div>
                  <div className="post-save-meta-item">
                    <span className="post-save-meta-label">Tipo</span>
                    <span className="post-save-meta-value">{typeLabel(postSaveModalOrder.order_type)}</span>
                  </div>
                  <div className="post-save-meta-item">
                    <span className="post-save-meta-label">Equipe</span>
                    <span className="post-save-meta-value">
                      {postSaveModalOrder.executor_team === "producao" ? "Produção" : postSaveModalOrder.executor_team === "suporte" ? "Suporte" : "Não informada"}
                    </span>
                  </div>
                  <div className="post-save-meta-item">
                    <span className="post-save-meta-label">Total de itens</span>
                    <span className="post-save-meta-value">
                      {postSaveModalOrder.items?.length || 1} {postSaveModalOrder.items?.length === 1 ? "item cadastrado" : "itens cadastrados"}
                    </span>
                  </div>
                  <div className="post-save-meta-item">
                    <span className="post-save-meta-label">Status</span>
                    <span className="post-save-meta-value">Não enviada</span>
                  </div>
                </div>
              </div>
              <p className="modal-description">
                A ordem foi registrada no sistema. Você pode continuar editando suas informações ou enviá-la para a etapa de validação.
              </p>
            </div>
            <div className="modal-actions post-save-actions">
              <button
                type="button"
                className="ghost modal-btn-edit"
                disabled={isSubmittingPostSave}
                onClick={() => setPostSaveModalOrder(null)}
              >
                <Edit3 size={16} />
                EDITAR
              </button>
              <button
                type="button"
                className="primary modal-btn-send"
                disabled={isSubmittingPostSave}
                onClick={async () => {
                  try {
                    setIsSubmittingPostSave(true);
                    const result = await runOrderAction(`/orders/${postSaveModalOrder.id}/submit`);
                    setPostSaveModalOrder(null);
                    setEditingId(null);
                    setForm(createEmptyOrder(session?.user?.name ?? ""));
                    setUserMenu("orders");
                    const targetTeam = postSaveModalOrder.executor_team || "suporte";
                    setExecutorTab(targetTeam);
                    executorTabRef.current = targetTeam;
                    await loadData(targetTeam);
                    // O envio devolve a própria ordem (ou { order } em outras ações)
                    const submittedOrder = result?.order ?? result;
                    if (submittedOrder?.id) {
                      await selectOrder(submittedOrder);
                    }
                    setMessage("Ordem enviada com sucesso para validação.");
                  } catch (err) {
                    console.error("Erro ao enviar ordem:", err);
                  } finally {
                    setIsSubmittingPostSave(false);
                  }
                }}
              >
                <Send size={16} />
                {isSubmittingPostSave ? "ENVIANDO..." : "ENVIAR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Proteção contra perda da ordem não enviada */}
      {showUnsavedPrompt && (
        <div className="modal-overlay" onClick={() => setShowUnsavedPrompt(false)}>
          <div className="modal-dialog unsubmitted-warning-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-badge warning">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3>Você possui uma ordem não enviada.</h3>
                <p className="modal-subtitle">Deseja continuar sem enviá-la?</p>
              </div>
            </div>
            <div className="modal-body">
              <p>
                A ordem recém-salva permanecerá armazenada no seu histórico como rascunho e poderá ser editada ou enviada posteriormente.
              </p>
              <div className="modal-warning-box">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>
                  Sua ordem não será apagada. Você pode sair para consultar outras informações e voltar para ela mais tarde.
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setShowUnsavedPrompt(false);
                  setPendingNavigation(null);
                }}
              >
                CANCELAR
              </button>
              <button
                type="button"
                className="warning-subtle-button"
                onClick={() => {
                  setShowUnsavedPrompt(false);
                  if (pendingNavigation) {
                    setEditingId(null);
                    setForm(createEmptyOrder(session?.user?.name ?? ""));
                    pendingNavigation();
                    setPendingNavigation(null);
                  }
                }}
              >
                SAIR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Confirmação de saída da conta (todos os perfis) */}
      {showLogoutConfirm && (
        <LogoutConfirmDialog
          userName={session.user.name}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            setShowLogoutConfirm(false);
            logout();
          }}
        />
      )}
    </main>
  );
}

function LogoutConfirmDialog({ userName, onCancel, onConfirm }) {
  // Esc cancela, como em qualquer diálogo
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-icon-badge warning">
            <LogOut size={22} />
          </div>
          <div>
            <h3 id="logout-confirm-title">Sair da conta</h3>
            <p className="modal-subtitle">Você precisará entrar novamente para continuar.</p>
          </div>
        </div>
        <div className="modal-body">
          <p>
            Tem certeza que deseja sair da conta <strong>{userName}</strong>?
          </p>
        </div>
        <div className="modal-actions">
          {/* Foco inicial em Cancelar: um Enter acidental não encerra a sessão */}
          <button type="button" className="ghost" onClick={onCancel} autoFocus>
            Cancelar
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderForm({ form, setForm, catalog, editingId, onSubmit, onCancel, onDirectSubmit, session, api }) {
  const [nextCode, setNextCode] = useState("");
  const [saving, setSaving] = useState(false);
  // Ref (e não só estado) porque um duplo clique dispara dois submits antes do re-render
  const savingRef = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSubmit(event);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!editingId && api) {
      api.request("/orders/next-code")
        .then((data) => {
          if (data?.nextCode) setNextCode(data.nextCode);
        })
        .catch(() => { });
    }
  }, [editingId, api]);

  useEffect(() => {
    if (catalog.partNumbers?.length) {
      setForm((current) => {
        let changed = false;
        const newItems = current.items.map((item) => {
          if (item.isCustomPn) return item;
          const allowed = catalog.partNumbers.filter((pn) => (pn.model_name || pn.terminal_model_name) === item.itemIdentifier);
          const hasValid = allowed.some((pn) => pn.part_number === item.partNumber);
          if (!hasValid && allowed.length > 0 && !item.partNumber) {
            changed = true;
            return { ...item, partNumber: allowed[0].part_number };
          }
          return item;
        });
        return changed ? { ...current, items: newItems } : current;
      });
    }
  }, [catalog.partNumbers]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateItem(index, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ))
    }));
  }

  function addItem() {
    const defaultModel = catalog.terminalModels[0]?.name || "D195";
    const availablePns = (catalog.partNumbers ?? []).filter((pn) => (pn.model_name || pn.terminal_model_name) === defaultModel);
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          itemName: "",
          itemIdentifier: defaultModel,
          partNumber: availablePns[0]?.part_number || "",
          isCustomPn: false,
          clientName: "",
          quantity: 1,
          configuration: "",
          packaging: "",
          battery: "",
          terminalOpening: "",
          manual: "",
          charger: "",
          minbase: "",
          label: "",
          aestheticCover: ""
        }
      ]
    }));
  }

  function removeItem(index) {
    setForm((current) => ({
      ...current,
      items: current.items.length === 1
        ? current.items
        : current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  return (
    <form className="panel order-form" onSubmit={handleSubmit}>
      <div className="panel-title">
        <Plus size={18} />
        <h3>{editingId ? "Editar ordem" : "Nova ordem"}</h3>
      </div>
      <div className="order-identification-block">
        <div className="id-card">
          <span className="id-label">Número da OS</span>
          <span className="id-value">{editingId ? (form.authorizedPersonDocument || "—") : (nextCode || "Gerando...")}</span>
        </div>
        <div className="id-card">
          <span className="id-label">Solicitante</span>
          <span className="id-value">{editingId ? (form.authorizedPersonName || session?.user?.name) : (session?.user?.name || "Solicitante")}</span>
        </div>
      </div>
      <div className="two-columns">
        <label>
          Tipo da ordem
          <select value={form.orderType} onChange={(event) => update("orderType", event.target.value)} required>
            {catalog.orderTypes.map((option) => (
              <option key={option.id} value={option.name}>{typeLabel(option.name)}</option>
            ))}
          </select>
        </label>
        <label>
          Equipe executora
          <select
            value={form.executorTeam || "suporte"}
            onChange={(event) => update("executorTeam", event.target.value)}
            required
          >
            <option value="suporte">Suporte</option>
            <option value="producao">Produção</option>
          </select>
        </label>
      </div>
      <div className="two-columns">
        <div className="auto-field">
          <span>Data Solicitacao</span>
          <strong>{editingId && form.validFrom ? formatDate(form.validFrom) : keyToBr(todayKey())}</strong>
        </div>
        <div className="auto-field">
          <span>Prazo Assinatura</span>
          <strong>{editingId && form.signatureDueAt ? formatDateTime(form.signatureDueAt) : keyToBr(addDaysToKey(todayKey(), 1))}</strong>
        </div>
      </div>
      <section className="order-items-editor">
        <div className="panel-title">
          <FileSignature size={18} />
          <h3>Itens da OS</h3>
        </div>
        {form.items.map((item, index) => {
          const allowedPns = (catalog.partNumbers ?? []).filter(
            (pn) => (pn.model_name || pn.terminal_model_name) === item.itemIdentifier
          );

          return (
            <article className="order-item-editor" key={index}>
              <div className="item-editor-head">
                <strong>Item {index + 1}</strong>
                <button type="button" className="ghost icon-button" onClick={() => removeItem(index)} disabled={form.items.length === 1} title="Remover item">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="two-columns">
                <label>
                  Nota do Pedido
                  <input
                    value={item.itemName}
                    onChange={(event) => updateItem(index, "itemName", event.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <label>
                  Modelo do Terminal
                  <select
                    value={item.itemIdentifier}
                    onChange={(event) => {
                      const newModel = event.target.value;
                      const pnsForModel = (catalog.partNumbers ?? []).filter((pn) => (pn.model_name || pn.terminal_model_name) === newModel);
                      const defaultPn = pnsForModel.length > 0 ? pnsForModel[0].part_number : "";
                      setForm((current) => ({
                        ...current,
                        items: current.items.map((it, i) =>
                          i === index ? { ...it, itemIdentifier: newModel, partNumber: defaultPn, isCustomPn: false } : it
                        )
                      }));
                    }}
                    required
                  >
                    {catalog.terminalModels.map((model) => (
                      <option key={model.id} value={model.name}>{model.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Part Number
                  <select
                    value={item.isCustomPn ? "__OUTROS__" : (item.partNumber || "")}
                    onChange={(event) => {
                      if (event.target.value === "__OUTROS__") {
                        setForm((current) => ({
                          ...current,
                          items: current.items.map((it, i) =>
                            i === index ? { ...it, isCustomPn: true, partNumber: "" } : it
                          )
                        }));
                      } else {
                        setForm((current) => ({
                          ...current,
                          items: current.items.map((it, i) =>
                            i === index ? { ...it, isCustomPn: false, partNumber: event.target.value } : it
                          )
                        }));
                      }
                    }}
                    required
                  >
                    <option value="" disabled>Selecione o Part Number</option>
                    {allowedPns.map((pn) => (
                      <option key={pn.id} value={pn.part_number}>
                        {pn.part_number}
                      </option>
                    ))}
                    <option value="__OUTROS__">Outros</option>
                  </select>
                </label>
                {item.isCustomPn && (
                  <label className="custom-pn-field">
                    Novo Part Number
                    <input
                      type="text"
                      placeholder="Digite o Part Number"
                      value={item.partNumber}
                      onChange={(event) => updateItem(index, "partNumber", event.target.value)}
                      required
                    />
                  </label>
                )}
                <label>
                  Cliente
                  <input value={item.clientName} onChange={(event) => updateItem(index, "clientName", event.target.value)} required />
                </label>
                <label>
                  Quantia
                  <input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required />
                </label>
              </div>
              <label>
                Configuracao
                <textarea value={item.configuration} onChange={(event) => updateItem(index, "configuration", event.target.value)} required />
              </label>

              <div className="item-mandatory-options">
                <div className="item-options-header">
                  <div className="item-options-badge">Opções Obrigatórias do Item {index + 1}</div>
                  <span className="item-options-hint">Selecione uma opção para cada campo (nenhum campo pré-selecionado)</span>
                </div>
                <div className="item-options-grid">
                  {ITEM_MANDATORY_OPTIONS.map((opt) => {
                    const currentValue = item[opt.key] || "";
                    return (
                      <div className="item-option-field" key={opt.key}>
                        <div className="item-option-label-row">
                          <span className="item-option-title">{opt.label}</span>
                          <span className="item-option-required">*</span>
                          {currentValue && (
                            <span className="item-option-selected-badge">{currentValue}</span>
                          )}
                        </div>
                        <div className="segmented-control item-options-segmented" role="radiogroup" aria-label={opt.label}>
                          {opt.choices.map((choice) => {
                            const isSelected = currentValue === choice;
                            return (
                              <button
                                key={choice}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                className={`item-option-btn ${isSelected ? "active" : ""}`}
                                onClick={() => updateItem(index, opt.key, choice)}
                              >
                                {choice}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
        <button type="button" className="ghost add-item-button" onClick={addItem}>
          <Plus size={18} />
          Adicionar item
        </button>
      </section>
      <div className="actions">
        {editingId && <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>}
        <button className="primary" type="submit" disabled={saving}>
          <FileSignature size={18} />
          {saving ? "Salvando..." : "Salvar"}
        </button>
        {editingId && onDirectSubmit && (
          <button type="button" className="success" onClick={onDirectSubmit}>
            <Send size={18} />
            Enviar
          </button>
        )}
      </div>
    </form>
  );
}

function DashboardMetricCard({ title, value, icon, variant = "neutral", onClick }) {
  return (
    <div
      className={`dashboard-metric-card variant-${variant} ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => activateOnKey(e, onClick) : undefined}
      title={onClick ? `Ver ordens: ${title}` : undefined}
    >
      <div className="metric-card-top">
        <span className="metric-card-title">{title}</span>
        <div className={`metric-icon-badge badge-${variant}`}>{icon}</div>
      </div>
      <div className="metric-card-number">{value ?? 0}</div>
    </div>
  );
}

function DashboardSectorGroup({ title, icon, metrics, onNavigateOrders }) {
  const subtotal = metrics.reduce((sum, metric) => sum + (metric.value ?? 0), 0);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`dashboard-sector-group${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="dashboard-sector-header"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        title={collapsed ? "Expandir" : "Retrair"}
      >
        <span className="dashboard-sector-title">
          <ChevronDown size={16} className="dashboard-sector-chevron" />
          {icon}
          {title}
        </span>
        <span className="dashboard-sector-count" title="Ordens em andamento neste setor">{subtotal}</span>
      </button>
      <div className="dashboard-sector-cards" hidden={collapsed}>
        {metrics.map((metric) => (
          <DashboardMetricCard
            key={metric.statusKey}
            title={metric.title}
            value={metric.value}
            icon={metric.icon}
            variant={metric.variant}
            onClick={() => onNavigateOrders && onNavigateOrders(metric.statusKey)}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardPanel({ session, api, onNavigateOrders }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  const fetchDashboard = React.useCallback(async () => {
    try {
      setError(null);
      const data = await api.request("/dashboard");
      setDashboardData(data);
    } catch (err) {
      console.error("Erro ao carregar dados do dashboard:", err);
      setError(err?.message ?? "Falha ao carregar indicadores.");
    }
  }, [api]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Atualização periódica a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboard();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Sincronização em tempo real de novos eventos de ordens
  useEffect(() => {
    if (!realtimeSyncChannel) return;
    const handleSync = (event) => {
      if (event?.data?.type === "SYNC") {
        fetchDashboard();
      }
    };
    realtimeSyncChannel.addEventListener("message", handleSync);
    return () => realtimeSyncChannel.removeEventListener("message", handleSync);
  }, [fetchDashboard]);

  const userRole = session?.user?.role;
  const metrics = dashboardData?.metrics || {
    totalOrders: 0,
    awaitingValidation: 0,
    awaitingCorrection: 0,
    approved: 0,
    divergent: 0,
    awaitingStockCheck: 0,
    stockPicking: 0,
    stockReturned: 0
  };

  const roleLabel = {
    admin: "Administrador",
    requester: "Operações",
    signer: "Suporte",
    spectator: "Produção",
    stock: "Estoque"
  }[userRole] || "Usuário";

  const operationsSectorGroup = (
    <DashboardSectorGroup
      title="Operações"
      icon={<Edit3 size={15} />}
      metrics={[
        { title: "Aguardando correção", value: metrics.awaitingCorrection, icon: <RefreshCw size={18} />, variant: "info", statusKey: "correction_requested" },
        { title: "Divergências", value: metrics.divergent, icon: <AlertTriangle size={18} />, variant: "danger", statusKey: "divergent" }
      ]}
      onNavigateOrders={onNavigateOrders}
    />
  );

  const stockSectorGroup = (
    <DashboardSectorGroup
      title="Estoque"
      icon={<Inbox size={15} />}
      metrics={[
        { title: "Aguardando conferência", value: metrics.awaitingStockCheck, icon: <Inbox size={18} />, variant: "info", statusKey: "awaiting_stock_check" },
        { title: "Em separação", value: metrics.stockPicking, icon: <Activity size={18} />, variant: "primary", statusKey: "stock_picking" },
        { title: "Retorno do estoque", value: metrics.stockReturned, icon: <AlertTriangle size={18} />, variant: "warning", statusKey: "stock_returned" }
      ]}
      onNavigateOrders={onNavigateOrders}
    />
  );

  return (
    <div className="dashboard-panel">
      {/* Barra superior limpa e objetiva */}
      <div className="dashboard-top-bar">
        <div className="dashboard-title-area">
          <div className="dashboard-badge-role">
            <LayoutDashboard size={16} />
            <span>Painel {roleLabel}</span>
          </div>
          <span className="dashboard-subtitle">Indicadores principais das ordens de serviço</span>
        </div>
      </div>

      {error && (
        <div className="notification-banner warning">
          <div className="notification-content">
            <strong>Aviso</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Visão geral: total e ordens concluídas */}
      <section className="dashboard-metrics-section">
        <div className="dashboard-metrics-grid dashboard-overview-grid">
          <DashboardMetricCard
            title="Total de OS"
            value={metrics.totalOrders}
            icon={<ClipboardList size={18} />}
            variant="primary"
            onClick={() => onNavigateOrders && onNavigateOrders("total")}
          />
          <DashboardMetricCard
            title="Aprovadas"
            value={metrics.approved}
            icon={<CheckCircle2 size={18} />}
            variant="success"
            onClick={() => onNavigateOrders && onNavigateOrders("signed")}
          />
        </div>
      </section>

      {/* Estado das ordens separado pelo setor responsável pela próxima ação.
          Mesmo layout para todos os perfis (padrão do perfil Operações). */}
      <section className="dashboard-sectors">
        {stockSectorGroup}
        {operationsSectorGroup}
        <DashboardSectorGroup
          title="Suporte"
          icon={<Clock3 size={15} />}
          metrics={[
            { title: "Aguardando validação", value: metrics.awaitingValidation, icon: <Clock3 size={18} />, variant: "warning", statusKey: "pending_signature" }
          ]}
          onNavigateOrders={onNavigateOrders}
        />
      </section>

      {/* Dois Gráficos Simples: Notas Realizadas e Assinaturas por Pessoa */}
      <DashboardCharts charts={dashboardData?.charts} />
    </div>
  );
}

function DashboardCharts({ charts }) {
  const periodData = charts?.ordersCompletedByPeriod || [];
  const personData = charts?.signaturesByPerson || [];

  const maxPeriodCount = Math.max(...periodData.map((d) => d.count), 1);
  const maxPersonCount = Math.max(...personData.map((d) => d.count), 1);

  return (
    <section className="dashboard-charts-section">
      <div className="dashboard-charts-grid">
        {/* Gráfico 1: Notas Realizadas por Período */}
        <div className="dashboard-chart-card">
          <div className="dashboard-chart-header">
            <div className="chart-title-group">
              <div className="chart-title-row">
                <BarChart3 size={18} className="chart-title-icon text-primary" />
                <h3>Notas Realizadas</h3>
              </div>
              <p className="chart-subtitle">Ordens concluídas e aprovadas agrupadas por período</p>
            </div>
            <span className="chart-badge-pill">
              Total: {periodData.reduce((acc, d) => acc + d.count, 0)}
            </span>
          </div>

          <div className="dashboard-chart-body">
            {periodData.length === 0 ? (
              <div className="chart-empty-state">
                <Calendar size={28} className="chart-empty-icon" />
                <p>Nenhuma nota ou ordem concluída registrada no período.</p>
              </div>
            ) : (
              <div className="chart-vertical-bars-wrapper">
                <div className="chart-vertical-bars-container">
                  {periodData.map((item) => {
                    const heightPercent = Math.max(Math.round((item.count / maxPeriodCount) * 100), 10);
                    return (
                      <div
                        key={item.date || item.label}
                        className="chart-col-item"
                        title={`${item.label}: ${item.count} nota(s) realizada(s)`}
                      >
                        <span className="chart-col-val">{item.count}</span>
                        <div className="chart-col-track">
                          <div
                            className="chart-col-bar fill-primary"
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>
                        <span className="chart-col-label">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Gráfico 2: Assinaturas por Pessoa */}
        <div className="dashboard-chart-card">
          <div className="dashboard-chart-header">
            <div className="chart-title-group">
              <div className="chart-title-row">
                <Users size={18} className="chart-title-icon text-success" />
                <h3>Assinaturas por Pessoa</h3>
              </div>
              <p className="chart-subtitle">Assinaturas válidas concluídas por usuário</p>
            </div>
            <span className="chart-badge-pill">
              Total: {personData.reduce((acc, d) => acc + d.count, 0)}
            </span>
          </div>

          <div className="dashboard-chart-body">
            {personData.length === 0 ? (
              <div className="chart-empty-state">
                <UserCheck size={28} className="chart-empty-icon" />
                <p>Nenhuma assinatura registrada no sistema.</p>
              </div>
            ) : (
              <div className="chart-horizontal-bars-container">
                {personData.map((item) => {
                  const widthPercent = Math.max(Math.round((item.count / maxPersonCount) * 100), 8);
                  return (
                    <div key={item.userName} className="chart-row-item">
                      <div className="chart-row-header">
                        <span className="chart-person-name" title={item.userName}>
                          {item.userName}
                        </span>
                        <span className="chart-person-badge">
                          {item.count} {item.count === 1 ? "assinatura" : "assinaturas"}
                        </span>
                      </div>
                      <div className="chart-row-track">
                        <div
                          className="chart-row-bar fill-success"
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// Admin cadastra os e-mails que recebem automaticamente o alerta quando uma OS
// atinge 2 tentativas incorretas de assinatura.
function NotificationEmailsCard({ api }) {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setEmails((await api.request("/notification-emails")) || []);
    } catch (err) {
      setMessage({ type: "error", text: err?.message || "Falha ao carregar os e-mails cadastrados." });
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(event) {
    event.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    try {
      setBusy(true);
      setMessage(null);
      await api.request("/notification-emails", { method: "POST", body: JSON.stringify({ email }) });
      setNewEmail("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err?.message || "Não foi possível cadastrar o e-mail." });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remover ${item.email} da lista de notificações?`)) return;
    try {
      setMessage(null);
      await api.request(`/notification-emails/${item.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err?.message || "Não foi possível remover o e-mail." });
    }
  }

  return (
    <section className="panel catalog-card notification-emails-card">
      <div className="panel-title">
        <Mail size={18} />
        <h3>E-mails que recebem os alertas</h3>
      </div>
      <p className="muted">
        Ao chegar em 2 tentativas incorretas de assinatura, um alerta é enviado automaticamente para todos os e-mails abaixo.
      </p>
      <form className="catalog-form" onSubmit={handleAdd}>
        <input
          type="email"
          placeholder="Ex: auditoria@empresa.com"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          required
        />
        <button className="primary" type="submit" disabled={busy}>
          <Plus size={18} />
          Cadastrar
        </button>
      </form>
      {message && <p className={message.type === "error" ? "text-danger" : "muted"}>{message.text}</p>}
      <div className="catalog-list">
        {emails.length === 0 ? (
          <small className="muted">Nenhum e-mail cadastrado — os alertas automáticos não serão enviados.</small>
        ) : (
          emails.map((item) => (
            <span key={item.id} className="notification-email-pill">
              {item.email}
              <button type="button" className="ghost icon-button" title="Remover" onClick={() => handleRemove(item)}>
                <Trash2 size={14} />
              </button>
            </span>
          ))
        )}
      </div>
    </section>
  );
}

const occurrenceErrorLabels = {
  divergencia_double_check: "Divergência no double check",
  assinatura_incorreta: "Assinatura apontada como incorreta",
  two_incorrect_attempts: "Tentativas incorretas"
};

function occurrenceErrorLabel(value) {
  return occurrenceErrorLabels[value] ?? value ?? "-";
}

function occurrenceStatusLabel(status) {
  if (status === "resolved") return "Resolvida";
  if (status === "email_sent") return "E-mail enviado";
  return "Pendente";
}

function formatKeyCount(value) {
  if (value === null || value === undefined) return null;
  return `${value} ${Number(value) === 1 ? "chave" : "chaves"}`;
}

// Quem foi o 1º e o 2º assinante em cada tentativa incorreta, e quantas chaves cada um informou
// (as quantidades só chegam da API para o admin).
function SignatureAttemptsHistory({ attempts }) {
  if (!attempts || attempts.length === 0) {
    return <small className="muted">Sem histórico detalhado das tentativas (ocorrência registrada antes desta funcionalidade).</small>;
  }

  const showKeys = attempts.some((a) => a.first_key_count !== null || a.second_key_count !== null);
  const keys = (value) => formatKeyCount(value) ?? "—";

  return (
    <div className="occ-attempts-history">
      <span className="occ-attempts-title">
        <History size={13} /> Histórico das tentativas incorretas
      </span>
      <table className="occ-attempts-table">
        <thead>
          <tr>
            <th>Tentativa</th>
            <th>Data / Hora</th>
            <th>1º assinante</th>
            {showKeys && <th>Chaves</th>}
            <th>2º assinante</th>
            {showKeys && <th>Chaves</th>}
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => (
            <tr key={attempt.id}>
              <td><strong>{attempt.attempt_number}ª</strong></td>
              <td>{formatDateTime(attempt.created_at)}</td>
              <td><strong>{attempt.first_signer_name || "—"}</strong></td>
              {showKeys && <td><span className="occ-attempt-keys">{keys(attempt.first_key_count)}</span></td>}
              <td><strong>{attempt.second_signer_name || "—"}</strong></td>
              {showKeys && <td><span className="occ-attempt-keys">{keys(attempt.second_key_count)}</span></td>}
              <td className="muted">
                {attempt.error_type === "assinatura_incorreta"
                  ? `Apontada por ${attempt.reported_by_name || "—"}${attempt.reason ? ` — ${attempt.reason}` : ""}`
                  : "Quantidades divergentes"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OccurrencesPanel({ api, onSelectOrder, isAdmin = false }) {
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedForEmail, setSelectedForEmail] = useState(null);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailResponse, setEmailResponse] = useState(null);
  const [emailError, setEmailError] = useState("");
  const [notificationMsg, setNotificationMsg] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchOccurrences = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.request("/orders/occurrences");
      setOccurrences(data || []);
    } catch (err) {
      console.error("Erro ao carregar ocorrências:", err);
      setError(err?.message || "Falha ao carregar ocorrências.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchOccurrences();
  }, [fetchOccurrences]);

  const handleOpenEmail = (occ) => {
    setSelectedForEmail(occ);
    setEmailRecipient(occ.email_recipient || "");
    setEmailResponse(null);
    setEmailError("");
  };

  const handleSendEmail = async () => {
    if (!selectedForEmail) return;
    // Ocorrência já notificada: o clique em "Reenviar Notificação" é a confirmação explícita exigida pela API
    const isResend = selectedForEmail.status === "email_sent";
    try {
      setEmailSending(true);
      setEmailError("");
      setEmailResponse(null);
      const res = await api.request(`/orders/occurrences/${selectedForEmail.id}/send-email`, {
        method: "POST",
        body: JSON.stringify({ recipient: emailRecipient || undefined, resend: isResend || undefined })
      });
      setEmailResponse(res);
      setSelectedForEmail((prev) => (prev && prev.status !== "resolved" ? { ...prev, status: "email_sent" } : prev));
      fetchOccurrences();
    } catch (err) {
      console.error("Erro ao enviar e-mail:", err);
      // Exibe dentro do modal: o banner do painel fica escondido atrás do fundo do modal
      setEmailError(err?.message || "Erro ao preparar/enviar e-mail.");
    } finally {
      setEmailSending(false);
    }
  };

  const handleResolve = async (occId) => {
    try {
      await api.request(`/orders/occurrences/${occId}/resolve`, {
        method: "POST"
      });
      setNotificationMsg({ type: "success", text: "Ocorrência marcada como resolvida com sucesso." });
      fetchOccurrences();
    } catch (err) {
      console.error("Erro ao resolver ocorrência:", err);
      setNotificationMsg({ type: "error", text: err?.message || "Erro ao resolver ocorrência." });
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = occurrences.filter((occ) => {
    const matchesStatus = filterStatus === "all" || occ.status === filterStatus;
    const matchesSearch =
      !normalizedSearch ||
      occ.order_code?.toLowerCase().includes(normalizedSearch) ||
      occ.user_name?.toLowerCase().includes(normalizedSearch) ||
      occ.description?.toLowerCase().includes(normalizedSearch);
    return matchesStatus && matchesSearch;
  });

  const pendingCount = occurrences.filter((o) => o.status === "pending").length;
  const sentCount = occurrences.filter((o) => o.status === "email_sent").length;
  const resolvedCount = occurrences.filter((o) => o.status === "resolved").length;
  const allExpanded = filtered.length > 0 && filtered.every((o) => expandedIds.has(o.id));

  return (
    <div className="occurrences-panel">
      <div className="occurrences-header">
        <div>
          <h2>Auditoria de Assinaturas Incorretas</h2>
          <p className="muted">
            Ordens de serviço com 2 ou mais tentativas incorretas de assinatura registradas.
          </p>
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={fetchOccurrences}
          disabled={loading}
          title="Atualizar lista"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          <span>Atualizar</span>
        </button>
      </div>

      {isAdmin && <NotificationEmailsCard api={api} />}

      {notificationMsg && (
        <div className={`notification-banner ${notificationMsg.type || "info"}`}>
          <div className="notification-content">
            <p>{notificationMsg.text}</p>
          </div>
          <button type="button" className="ghost icon-button" onClick={() => setNotificationMsg(null)}>
            <XCircle size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="notification-banner danger">
          <div className="notification-content">
            <strong>Erro</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="occurrences-summary-grid">
        <div className={`occ-summary-card total ${filterStatus === "all" ? "active" : ""}`} role="button" tabIndex={0} aria-pressed={filterStatus === "all"} onClick={() => setFilterStatus("all")} onKeyDown={(e) => activateOnKey(e, () => setFilterStatus("all"))}>
          <span className="occ-summary-label">Total de Ocorrências</span>
          <strong className="occ-summary-value">{occurrences.length}</strong>
        </div>
        <div className={`occ-summary-card pending ${filterStatus === "pending" ? "active" : ""}`} role="button" tabIndex={0} aria-pressed={filterStatus === "pending"} onClick={() => setFilterStatus("pending")} onKeyDown={(e) => activateOnKey(e, () => setFilterStatus("pending"))}>
          <span className="occ-summary-label">Pendentes de Ação</span>
          <strong className="occ-summary-value text-warning">{pendingCount}</strong>
        </div>
        <div className={`occ-summary-card sent ${filterStatus === "email_sent" ? "active" : ""}`} role="button" tabIndex={0} aria-pressed={filterStatus === "email_sent"} onClick={() => setFilterStatus("email_sent")} onKeyDown={(e) => activateOnKey(e, () => setFilterStatus("email_sent"))}>
          <span className="occ-summary-label">Notificadas por E-mail</span>
          <strong className="occ-summary-value text-info">{sentCount}</strong>
        </div>
        <div className={`occ-summary-card resolved ${filterStatus === "resolved" ? "active" : ""}`} role="button" tabIndex={0} aria-pressed={filterStatus === "resolved"} onClick={() => setFilterStatus("resolved")} onKeyDown={(e) => activateOnKey(e, () => setFilterStatus("resolved"))}>
          <span className="occ-summary-label">Resolvidas</span>
          <strong className="occ-summary-value text-success">{resolvedCount}</strong>
        </div>
      </div>

      <div className="occurrences-filters-bar">
        <div className="occ-status-tabs">
          <button
            type="button"
            className={`occ-tab-btn ${filterStatus === "all" ? "active" : ""}`}
            onClick={() => setFilterStatus("all")}
          >
            Todas ({occurrences.length})
          </button>
          <button
            type="button"
            className={`occ-tab-btn ${filterStatus === "pending" ? "active" : ""}`}
            onClick={() => setFilterStatus("pending")}
          >
            Pendentes ({pendingCount})
          </button>
          <button
            type="button"
            className={`occ-tab-btn ${filterStatus === "email_sent" ? "active" : ""}`}
            onClick={() => setFilterStatus("email_sent")}
          >
            Notificadas ({sentCount})
          </button>
          <button
            type="button"
            className={`occ-tab-btn ${filterStatus === "resolved" ? "active" : ""}`}
            onClick={() => setFilterStatus("resolved")}
          >
            Resolvidas ({resolvedCount})
          </button>
        </div>

        <div className="occ-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar por OS, usuário ou motivo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="occ-list-toolbar">
          <small className="muted">
            {filtered.length} {filtered.length === 1 ? "ocorrência" : "ocorrências"} — clique em uma linha para ver os detalhes
          </small>
          <button
            type="button"
            className="ghost occ-expand-all-btn"
            onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(filtered.map((o) => o.id)))}
          >
            <ChevronDown size={14} className={allExpanded ? "occ-chevron open" : "occ-chevron"} />
            {allExpanded ? "Recolher todas" : "Expandir todas"}
          </button>
        </div>
      )}

      <div className="occ-list">
        {filtered.length === 0 ? (
          <div className="occurrences-empty">
            <Inbox size={36} className="muted" />
            <p>Nenhuma ocorrência encontrada para os filtros selecionados.</p>
          </div>
        ) : (
          filtered.map((occ) => {
            const isOpen = expandedIds.has(occ.id);
            const bodyId = `occ-body-${occ.id}`;
            return (
              <article key={occ.id} className={`occ-item ${occ.status} ${isOpen ? "open" : ""}`}>
                <div className="occ-item-head">
                  <button
                    type="button"
                    className="occ-item-toggle"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    onClick={() => toggleExpanded(occ.id)}
                  >
                    <ChevronDown size={18} className={isOpen ? "occ-chevron open" : "occ-chevron"} />
                    <span className="occ-item-main">
                      <span className="occ-item-title">
                        <strong>OS {occ.order_code}</strong>
                        <span className="occ-error-type-tag">{occurrenceErrorLabel(occ.error_type)}</span>
                      </span>
                      <span className="occ-item-meta">
                        <span><UserCheck size={13} /> {occ.user_name}</span>
                        <span><Clock3 size={13} /> {formatDateTime(occ.created_at)}</span>
                        <span className="occ-attempt-badge">{occ.attempt_count} tentativas</span>
                      </span>
                    </span>
                    <span className={`occ-status-badge ${occ.status}`}>{occurrenceStatusLabel(occ.status)}</span>
                  </button>
                  <div className="occ-item-actions">
                    <button
                      type="button"
                      className="occ-action-btn email"
                      onClick={() => handleOpenEmail(occ)}
                      title="Preparar / Enviar e-mail"
                    >
                      <Mail size={14} />
                      <span>E-mail</span>
                    </button>
                    {occ.status !== "resolved" && (
                      <button
                        type="button"
                        className="occ-action-btn resolve"
                        onClick={() => handleResolve(occ.id)}
                        title="Marcar ocorrência como resolvida"
                      >
                        <Check size={14} />
                        <span>Resolver</span>
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="occ-item-body" id={bodyId}>
                    <div className="occ-detail-block">
                      <span className="occ-detail-label">Descrição</span>
                      <p className="occ-detail-desc">{occ.description || "—"}</p>
                    </div>

                    <dl className="occ-detail-grid">
                      <div>
                        <dt>Tipo da ordem</dt>
                        <dd>{occ.order_type || "—"}</dd>
                      </div>
                      <div>
                        <dt>Equipe executora</dt>
                        <dd>{occ.executor_team === "producao" ? "Produção" : "Suporte"}</dd>
                      </div>
                      <div>
                        <dt>Situação da OS</dt>
                        <dd>{statusLabels[occ.order_status] ?? occ.order_status ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Solicitante</dt>
                        <dd>{occ.requester_name || occ.authorized_person_name || "—"}</dd>
                      </div>
                      <div>
                        <dt>Usuário envolvido</dt>
                        <dd>{occ.user_name || "—"}</dd>
                      </div>
                      <div>
                        <dt>Registrada em</dt>
                        <dd>{formatDateTime(occ.created_at)}</dd>
                      </div>
                      <div>
                        <dt>E-mail enviado</dt>
                        <dd>
                          {occ.email_sent_at
                            ? `${formatDateTime(occ.email_sent_at)}${occ.email_recipient ? ` para ${occ.email_recipient}` : ""}`
                            : "Ainda não enviado"}
                        </dd>
                      </div>
                    </dl>

                    <div className="occ-attempts-scroll">
                      <SignatureAttemptsHistory attempts={occ.attempts} />
                    </div>

                    <div className="occ-item-body-footer">
                      <button
                        type="button"
                        className="ghost occ-open-order-btn"
                        onClick={() => onSelectOrder && onSelectOrder(occ.service_order_id)}
                      >
                        <ClipboardList size={14} />
                        Abrir OS {occ.order_code}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {selectedForEmail && (
        <div className="modal-backdrop" onClick={() => setSelectedForEmail(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <Mail size={20} className="text-primary" />
                <h3>Notificação por E-mail — OS #{selectedForEmail.order_code}</h3>
              </div>
              <button
                type="button"
                className="ghost icon-button"
                onClick={() => setSelectedForEmail(null)}
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-field">
                <label>Destinatário do E-mail:</label>
                <input
                  type="email"
                  placeholder="Ex: auditoria@empresa.com, gestor@empresa.com"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                />
                <small className="muted">
                  Deixe em branco para enviar a todos os e-mails cadastrados para notificações.
                </small>
              </div>

              {selectedForEmail.status === "email_sent" && !emailResponse && (
                <div className="notification-banner warning">
                  <div className="notification-content">
                    <strong>Ocorrência já notificada</strong>
                    <p>
                      {selectedForEmail.email_sent_at
                        ? `Enviada em ${formatDateTime(selectedForEmail.email_sent_at)}${selectedForEmail.email_recipient ? ` para ${selectedForEmail.email_recipient}` : ""}. `
                        : ""}
                      Confirme em "Reenviar Notificação" para enviar novamente.
                    </p>
                  </div>
                </div>
              )}

              {emailError && (
                <div className="notification-banner error">
                  <div className="notification-content">
                    <strong>Falha no envio</strong>
                    <p>{emailError}</p>
                  </div>
                </div>
              )}

              {emailResponse && (
                <div className={`notification-banner ${emailResponse.configured ? "success" : "warning"}`}>
                  <div className="notification-content">
                    <strong>{emailResponse.configured ? "E-mail Enviado com Sucesso" : "Envio Preparado (SMTP não configurado)"}</strong>
                    <p>{emailResponse.reason || `E-mail enviado para ${emailResponse.recipient}`}</p>
                  </div>
                </div>
              )}

              <div className="email-preview-container">
                <span className="email-preview-label">Pré-visualização do Conteúdo (Sem dados sensíveis):</span>
                <div className="email-preview-box">
                  <p><strong>Assunto:</strong> [Validação de OS] Alerta: {selectedForEmail.attempt_count}ª Tentativa Incorreta de Assinatura - OS {selectedForEmail.order_code}</p>
                  <hr />
                  <p><strong>Ordem de Serviço:</strong> {selectedForEmail.order_code}</p>
                  <p><strong>Usuário Envolvido:</strong> {selectedForEmail.user_name}</p>
                  <p><strong>Tipo de Erro:</strong> {occurrenceErrorLabel(selectedForEmail.error_type)}</p>
                  <p><strong>Tentativas:</strong> {selectedForEmail.attempt_count}</p>
                  <p><strong>Descrição:</strong> {selectedForEmail.description}</p>
                  <p><strong>Data/Hora:</strong> {formatDateTime(selectedForEmail.created_at)}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setSelectedForEmail(null)}
              >
                Fechar
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleSendEmail}
                disabled={emailSending}
              >
                {emailSending ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>Processando envio...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>{selectedForEmail.status === "email_sent" ? "Reenviar Notificação" : "Disparar Notificação"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserOrdersPanel({
  orders,
  selected,
  session,
  feedback,
  setFeedback,
  signatureName,
  setSignatureName,
  onSelectOrder,
  onNewOrder,
  onSubmit,
  onSign,
  onCorrection,
  onIncorrectSignature,
  onOrderAction,
  onEdit,
  executorTab = "suporte",
  onExecutorTabChange,
  counts,
  initialFilter = "pendente_validacao",
  extraActions = null,
  allowEdit = true
}) {
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState(() => addDaysToKey(todayKey(), -6));
  const [endDate, setEndDate] = useState(() => todayKey());
  const [appliedCustomDates, setAppliedCustomDates] = useState({ start: startDate, end: endDate });
  const [filter, setFilter] = useState(initialFilter || "pendente_validacao");

  useEffect(() => {
    if (initialFilter) {
      setFilter(initialFilter);
    }
  }, [initialFilter]);

  const teamFilteredOrders = orders.filter((order) => {
    if (executorTab === "suporte") return order.executor_team === "suporte";
    if (executorTab === "producao") return order.executor_team === "producao";
    if (executorTab === "unassigned") return !order.executor_team;
    return true;
  });

  const periodFilteredOrders = teamFilteredOrders.filter((order) =>
    orderMatchesPeriod(
      order,
      period,
      period === "custom" ? appliedCustomDates.start : startDate,
      period === "custom" ? appliedCustomDates.end : endDate
    )
  );

  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const searchedOrders = normalizedSearch
    ? periodFilteredOrders.filter((order) => orderMatchesSearch(order, normalizedSearch))
    : periodFilteredOrders;

  // Rascunhos aparecem para quem os cria (Operações) e para o Admin, que acompanha todas as ordens
  const canSeeDrafts = ["requester", "admin"].includes(session?.user?.role);
  const countFor = (statusValues) =>
    searchedOrders.filter((order) => statusValues.some((value) => userOrderMatchesFilter(order, value))).length;

  // Área = setor responsável pela próxima ação (mesmo agrupamento do dashboard)
  const areaOptions = [
    {
      value: "operacoes",
      label: "Operações",
      statuses: [
        ...(canSeeDrafts ? [{ value: "draft", label: "Rascunhos" }] : []),
        { value: "recertificar", label: "Aguardando correção" },
        { value: "divergent", label: "Divergências" }
      ]
    },
    {
      value: "estoque",
      label: "Estoque",
      statuses: [
        { value: "estoque", label: "Aguardando conferência" },
        { value: "em_separacao", label: "Em separação" },
        { value: "retorno_estoque", label: "Retorno do estoque" }
      ]
    },
    {
      value: "suporte",
      label: "Suporte",
      statuses: [
        { value: "pendente_validacao", label: "Pendente validação" },
        { value: "aguardando_1", label: "Aguardando 1 assinatura" }
      ]
    },
    {
      value: "concluidas",
      label: "Concluídas",
      statuses: [{ value: "signed", label: "Aprovadas" }]
    }
  ];
  const areaOfFilter = (value) => areaOptions.find((area) => area.statuses.some((s) => s.value === value))?.value ?? "all";

  const [area, setArea] = useState(() => areaOfFilter(initialFilter || "pendente_validacao"));

  useEffect(() => {
    if (initialFilter) {
      setArea(areaOfFilter(initialFilter));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);

  const currentArea = areaOptions.find((option) => option.value === area);
  // Status só pode ser escolhido depois de definir uma Área
  const statusEnabled = Boolean(currentArea);
  const effectiveFilter = statusEnabled ? filter : "todas";
  const statusSelectOptions = statusEnabled
    ? currentArea.statuses.map((status) => ({ ...status, count: countFor([status.value]) }))
    : [];

  const filteredOrders = searchedOrders.filter((order) => {
    if (effectiveFilter !== "todas") return userOrderMatchesFilter(order, effectiveFilter);
    if (!currentArea) return true;
    return currentArea.statuses.some((status) => userOrderMatchesFilter(order, status.value));
  });

  function handleAreaChange(nextArea) {
    setArea(nextArea);
    setFilter("todas");
  }

  return (
    <div className="content-grid user-orders-layout">
      <section className="orders-column">
        <div className="panel user-orders-panel">
          <div className="orders-panel-header">
            <div className="panel-title">
              <ClipboardList size={18} />
              <h3>Ordens de serviço</h3>
            </div>
            {session.user.role === "requester" && (
              <button className="primary orders-new-btn" onClick={onNewOrder}>
                <Plus size={16} />
                Nova ordem
              </button>
            )}
          </div>

          <div className="orders-executor-tabs" role="tablist" aria-label="Equipe executora">
            <button
              type="button"
              role="tab"
              aria-selected={executorTab === "producao"}
              className={`executor-tab-btn ${executorTab === "producao" ? "active" : ""}`}
              onClick={() => onExecutorTabChange && onExecutorTabChange("producao")}
            >
              <Cpu size={16} />
              <span>Requisições para Produção</span>
              {counts?.producao !== undefined && (
                <span className="executor-tab-count">{counts.producao}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={executorTab === "suporte"}
              className={`executor-tab-btn ${executorTab === "suporte" ? "active" : ""}`}
              onClick={() => onExecutorTabChange && onExecutorTabChange("suporte")}
            >
              <Wrench size={16} />
              <span>Requisições para Suporte</span>
              {counts?.suporte !== undefined && (
                <span className="executor-tab-count">{counts.suporte}</span>
              )}
            </button>
            {counts?.unassigned > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={executorTab === "unassigned"}
                className={`executor-tab-btn ${executorTab === "unassigned" ? "active" : ""}`}
                onClick={() => onExecutorTabChange && onExecutorTabChange("unassigned")}
                title="Ordens anteriores sem classificação de equipe"
              >
                <span>Sem classificação</span>
                <span className="executor-tab-count">{counts.unassigned}</span>
              </button>
            )}
          </div>

          <div className="orders-toolbar">
            <label className="orders-search">
              <Search size={15} />
              <input
                type="search"
                placeholder="Buscar código, modelo, cliente…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar ordens"
              />
            </label>
            <label className="orders-period-select">
              <Calendar size={15} />
              <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período">
                <option value="all">Todo o período</option>
                <option value="today">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="month">Este mês</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
          </div>

          {period === "custom" && (
            <div className="orders-custom-dates">
              <label>
                <span>De</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label>
                <span>Até</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => setAppliedCustomDates({ start: startDate, end: endDate })}
              >
                Aplicar
              </button>
            </div>
          )}

          <div className="orders-selects">
            <label className="orders-select-field">
              <span>Área</span>
              <select value={area} onChange={(event) => handleAreaChange(event.target.value)}>
                <option value="all">Todas as áreas ({searchedOrders.length})</option>
                {areaOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({countFor(option.statuses.map((s) => s.value))})
                  </option>
                ))}
              </select>
            </label>
            <label className="orders-select-field">
              <span>Status</span>
              <select
                value={effectiveFilter}
                onChange={(event) => setFilter(event.target.value)}
                disabled={!statusEnabled}
                title={statusEnabled ? undefined : "Selecione uma área para filtrar por status"}
              >
                <option value="todas">
                  {statusEnabled ? "Todos os status" : "Selecione uma área primeiro"}
                </option>
                {statusSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {extraActions && extraActions(filteredOrders)}
        </div>

        <div className="order-list-panel">
          <div className="order-list-summary">
            <span>
              {filteredOrders.length} {filteredOrders.length === 1 ? "ordem" : "ordens"}
            </span>
            <span className="muted">{formatPeriodRange(period, appliedCustomDates.start, appliedCustomDates.end)}</span>
          </div>
          <div className="order-list">
            {filteredOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                active={selected?.id === order.id}
                onClick={() => onSelectOrder(order)}
              />
            ))}
            {filteredOrders.length === 0 && (
              <p className="order-list-empty">Nenhuma ordem encontrada com estes filtros.</p>
            )}
          </div>
        </div>
      </section>
      <OrderDetails
        session={session}
        selected={selected}
        feedback={feedback}
        setFeedback={setFeedback}
        signatureName={signatureName}
        setSignatureName={setSignatureName}
        onSubmit={onSubmit}
        onSign={onSign}
        onCorrection={onCorrection}
        onIncorrectSignature={onIncorrectSignature}
        onOrderAction={onOrderAction}
        onEdit={onEdit}
        allowEdit={allowEdit}
      />
    </div>
  );
}

function AdminConsole({
  activeMenu,
  orders,
  selected,
  users,
  catalog,
  currentUserId,
  newUser,
  setNewUser,
  newCatalogItem,
  setNewCatalogItem,
  newPartNumberItem,
  setNewPartNumberItem,
  feedback,
  setFeedback,
  signatureName,
  setSignatureName,
  onCreateUser,
  onUpdateUser,
  onRemoveUser,
  onCreateCatalogItem,
  onSelectOrder,
  onSubmitOrder,
  onSignOrder,
  onCorrection,
  onIncorrectSignature,
  onOrderAction,
  onEditOrder,
  onClearAllOrders,
  session,
  executorTab = "suporte",
  onExecutorTabChange,
  counts,
  initialStatusFilter = "total",
  api,
  onNavigateToOrdersTab
}) {
  return (
    <section className="admin-console">
      {activeMenu === "occurrences" ? (
        <OccurrencesPanel
          api={api}
          isAdmin
          onSelectOrder={(orderId) => {
            // Busca pelo id (e não na lista da aba atual) para abrir ordens de qualquer equipe
            onSelectOrder({ id: orderId });
            onNavigateToOrdersTab?.();
          }}
        />
      ) : activeMenu === "users" ? (
        <AdminPanel
          users={users}
          currentUserId={currentUserId}
          newUser={newUser}
          setNewUser={setNewUser}
          onSubmit={onCreateUser}
          onUpdateUser={onUpdateUser}
          onRemoveUser={onRemoveUser}
        />
      ) : activeMenu === "items" ? (
        <AdminItemsPanel
          catalog={catalog}
          newCatalogItem={newCatalogItem}
          setNewCatalogItem={setNewCatalogItem}
          newPartNumberItem={newPartNumberItem}
          setNewPartNumberItem={setNewPartNumberItem}
          onCreateCatalogItem={onCreateCatalogItem}
        />
      ) : (
        // Mesmo layout do "Histórico de ordens" do Solicitante, com as ações exclusivas do Admin
        <UserOrdersPanel
          orders={orders}
          selected={selected}
          session={session}
          feedback={feedback}
          setFeedback={setFeedback}
          signatureName={signatureName}
          setSignatureName={setSignatureName}
          onSelectOrder={onSelectOrder}
          onSubmit={onSubmitOrder}
          onSign={onSignOrder}
          onCorrection={onCorrection}
          onIncorrectSignature={onIncorrectSignature}
          onOrderAction={onOrderAction}
          onEdit={onEditOrder}
          allowEdit={false}
          executorTab={executorTab}
          onExecutorTabChange={onExecutorTabChange}
          counts={counts}
          initialFilter={dashboardStatusToUserFilter(initialStatusFilter)}
          extraActions={(filteredOrders) => (
            <AdminOrdersActions
              orders={orders}
              filteredOrders={filteredOrders}
              onClearAllOrders={onClearAllOrders}
            />
          )}
        />
      )}
    </section>
  );
}

function AdminOrdersActions({ orders, filteredOrders, onClearAllOrders }) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  return (
    <>
      <div className="admin-orders-actions-bar">
        <div className="export-actions">
          <button className="ghost" type="button" onClick={() => exportOrdersToExcel(filteredOrders, "filtrado")} disabled={filteredOrders.length === 0}>
            <Save size={18} />
            Exportar filtrado
          </button>
          <button className="ghost" type="button" onClick={() => exportOrdersToExcel(orders, "completo")} disabled={orders.length === 0}>
            <Save size={18} />
            Exportar tudo
          </button>
        </div>
        <button
          className="clear-all-orders-btn"
          type="button"
          onClick={() => setShowClearConfirm(true)}
          disabled={orders.length === 0 || isClearing}
          title={orders.length === 0 ? "Não há ordens para limpar" : "Limpar todas as ordens de serviço"}
        >
          <Trash2 size={16} />
          Limpar todas as ordens
        </button>
      </div>

      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => !isClearing && setShowClearConfirm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-badge danger">
                <Trash2 size={22} />
              </div>
              <div>
                <h3>Limpar todas as ordens</h3>
                <p className="modal-subtitle">Esta ação não poderá ser desfeita.</p>
              </div>
            </div>
            <div className="modal-body">
              <p>
                Você tem certeza que deseja excluir permanentemente <strong>todas as {orders.length} ordens de serviço</strong> cadastradas no sistema?
              </p>
              <div className="modal-warning-box">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>
                  Todos os itens associados, assinaturas, divergências e registros de auditoria serão removidos. A sequência anual de OS será reiniciada a partir do #01.
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                disabled={isClearing}
                onClick={() => setShowClearConfirm(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger"
                disabled={isClearing}
                onClick={async () => {
                  try {
                    setIsClearing(true);
                    await onClearAllOrders();
                    setShowClearConfirm(false);
                  } catch (err) {
                    console.error("Erro ao limpar ordens:", err);
                  } finally {
                    setIsClearing(false);
                  }
                }}
              >
                <Trash2 size={16} />
                {isClearing ? "Limpando ordens..." : "Sim, limpar todas as ordens"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OrderRow({ order, active, onClick }) {
  const Icon = statusIcons[order.status] ?? FileSignature;

  const incorrect = Number(order.incorrect_signatures ?? 0);
  const signatureCount = Number(order.signature_count ?? 0);
  const models = order.terminal_models || order.item_identifier;
  const clients = order.client_names && order.client_names !== "-" ? order.client_names : null;
  const team = order.executor_team === "producao" ? "Produção" : order.executor_team === "suporte" ? "Suporte" : "Sem equipe";

  return (
    <button className={`order-row ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "true" : undefined}>
      <span className="order-row-top">
        <strong className="order-row-code">{order.code}</strong>
        <span className={`status-badge ${order.status}`}>
          <Icon size={12} />
          {statusLabels[order.status] ?? order.status}
        </span>
      </span>
      <span className="order-row-title">
        {typeLabel(order.order_type)}
        {models ? ` · ${models}` : ""}
        {order.total_quantity ? ` · Qtd ${order.total_quantity}` : ""}
      </span>
      {clients && <span className="order-row-sub">{clients}</span>}
      <span className="order-row-meta">
        <span>{team}</span>
        <span>{formatDate(order.created_at)}</span>
        <span>{signatureCount}/2 assinaturas</span>
        {incorrect > 0 && (
          <span className="order-row-warning" title={`${incorrect} tentativa(s) incorreta(s)`}>
            <AlertTriangle size={12} />
            {incorrect} {incorrect === 1 ? "tentativa incorreta" : "tentativas incorretas"}
          </span>
        )}
      </span>
    </button>
  );
}

function AdminItemsPanel({
  catalog,
  newCatalogItem,
  setNewCatalogItem,
  newPartNumberItem,
  setNewPartNumberItem,
  onCreateCatalogItem
}) {
  function update(field, value) {
    setNewCatalogItem((current) => ({ ...current, [field]: value }));
  }

  function updatePartNumber(field, value) {
    setNewPartNumberItem((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="items-grid">
      <CatalogCard
        title="Tipos de ordem"
        value={newCatalogItem.orderType}
        placeholder="Ex: Reparo/Atualização"
        items={catalog.orderTypes}
        onChange={(value) => update("orderType", value)}
        onSubmit={(event) => onCreateCatalogItem("order-types", event)}
      />
      <CatalogCard
        title="Modelos de terminal"
        value={newCatalogItem.terminalModel}
        placeholder="Ex: A910"
        items={catalog.terminalModels}
        onChange={(value) => update("terminalModel", value)}
        onSubmit={(event) => onCreateCatalogItem("terminal-models", event)}
      />
      <section className="panel catalog-card">
        <div className="panel-title">
          <Plus size={18} />
          <h3>Part Numbers por Modelo</h3>
        </div>
        <form className="catalog-form catalog-form-three" onSubmit={(event) => onCreateCatalogItem("part-numbers", event)}>
          <select
            value={newPartNumberItem?.modelName || (catalog.terminalModels[0]?.name ?? "")}
            onChange={(e) => updatePartNumber("modelName", e.target.value)}
            aria-label="Modelo"
          >
            {catalog.terminalModels.map((model) => (
              <option key={model.id} value={model.name}>{model.name}</option>
            ))}
          </select>
          <input
            placeholder="Ex: PN-D195-01"
            value={newPartNumberItem?.partNumber || ""}
            onChange={(event) => updatePartNumber("partNumber", event.target.value)}
            required
          />
          <button className="primary" type="submit">
            <Plus size={18} />
            Incluir
          </button>
        </form>
        <div className="part-number-groups">
          {groupPartNumbersByModel(catalog.partNumbers ?? []).map(([model, list]) => (
            <div key={model} className="part-number-group">
              <strong>{model}</strong>
              <div className="catalog-list">
                {list.map((pn) => (
                  <span key={pn.id}>{pn.part_number}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function groupPartNumbersByModel(partNumbers) {
  const groups = new Map();
  for (const pn of partNumbers) {
    const model = pn.model_name || pn.terminal_model_name || "-";
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push(pn);
  }
  return [...groups.entries()];
}

function CatalogCard({ title, value, placeholder, items, onChange, onSubmit }) {
  return (
    <section className="panel catalog-card">
      <div className="panel-title">
        <Plus size={18} />
        <h3>{title}</h3>
      </div>
      <form className="catalog-form" onSubmit={onSubmit}>
        <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        <button className="primary" type="submit">
          <Plus size={18} />
          Incluir
        </button>
      </form>
      <div className="catalog-list">
        {items.map((item) => (
          <span key={item.id}>{typeLabel(item.name)}</span>
        ))}
      </div>
    </section>
  );
}

function StockCheckPanel({ order, items, onAction }) {
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(items.map((item) => [item.id, String(item.stock_checked_quantity ?? item.quantity)]))
  );
  const [notes, setNotes] = useState(() => Object.fromEntries(items.map((item) => [item.id, item.stock_note ?? ""])));
  const [accessoriesNote, setAccessoriesNote] = useState(order.stock_accessories_note ?? "");
  const [accessories, setAccessories] = useState(() =>
    Object.fromEntries(items.map((item) => [
      item.id,
      item.stock_accessories ?? stockAccessoryOptions.filter((option) => option.requestedBy(item)).map((option) => option.key)
    ]))
  );

  function toggleAccessory(itemId, key) {
    setAccessories((current) => {
      const list = current[itemId] ?? [];
      return { ...current, [itemId]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] };
    });
  }
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const hasShortage = items.some((item) => Number(quantities[item.id] || 0) < Number(item.quantity));
  const hasInvalid = items.some((item) => quantities[item.id] === "" || Number(quantities[item.id]) > Number(item.quantity));
  // Mesma regra do backend: completo só sem falta; parcial/pendência só com falta
  const resultAllowed = result === "complete" ? !hasShortage : Boolean(result) && hasShortage;

  async function run(action, body) {
    setBusy(true);
    try {
      await onAction(action, body);
    } catch {
      // A mensagem de erro já é exibida pelo runOrderAction
    } finally {
      setBusy(false);
    }
  }

  if (order.status === "awaiting_stock_check") {
    return (
      <section className="validation-decision-panel">
        <h4>Conferência do estoque</h4>
        <p className="muted">Inicie a conferência para registrar a quantidade disponível de cada linha de terminal.</p>
        <button className="primary" type="button" disabled={busy} onClick={() => run("stock/start")}>
          <ClipboardList size={18} />
          Iniciar conferência
        </button>
      </section>
    );
  }

  if (order.status === "stock_picking") {
    return (
      <section className="validation-decision-panel">
        <h4>Separação do material</h4>
        <p className="muted">Conferência completa. Após separar o material, libere a ordem para assinatura do Suporte.</p>
        <button className="success" type="button" disabled={busy} onClick={() => run("stock/release")}>
          <Send size={18} />
          Concluir separação e enviar ao Suporte
        </button>
      </section>
    );
  }

  return (
    <section className="validation-decision-panel">
      <h4>Conferência por linha de terminal</h4>
      <div className="stock-check-lines">
        {items.map((item, index) => (
          <div className="stock-check-line" key={item.id}>
            <div>
              <strong>Item {index + 1}: {item.terminal_model}</strong>
              <small className="muted"> {item.part_number} | {item.client_name} | solicitado {item.quantity}</small>
            </div>
            <label>
              Conferido
              <input
                type="text"
                inputMode="numeric"
                className="numeric-input"
                value={quantities[item.id]}
                onChange={(event) => {
                  const cleaned = event.target.value.replace(/\D/g, "");
                  setQuantities((current) => ({ ...current, [item.id]: cleaned }));
                }}
              />
            </label>
            <label>
              Observação
              <input
                value={notes[item.id]}
                placeholder="Opcional"
                onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
              />
            </label>
          </div>
        ))}
      </div>

      <label>
        Observação de acessórios
        <textarea
          placeholder="Carregadores, baterias, manuais, embalagens..."
          value={accessoriesNote}
          onChange={(event) => setAccessoriesNote(event.target.value)}
        />
      </label>

      <div className="decision-options stock-result-options">
        {stockResultOptions.map((option) => (
          <label key={option.value} className={`decision-label ${result === option.value ? "active" : ""}`}>
            <input
              type="radio"
              name={`stock-result-${order.id}`}
              value={option.value}
              checked={result === option.value}
              onChange={() => setResult(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>

      {hasInvalid && <p className="inline-note">A quantidade conferida deve ser informada e não pode passar da solicitada.</p>}
      {result === "complete" && hasShortage && (
        <p className="inline-note">Há itens em falta. Registre como parcial ou pendência de estoque para decisão de Operações.</p>
      )}
      {result && result !== "complete" && !hasShortage && (
        <p className="inline-note">Todos os itens estão completos. Registre o resultado como completo.</p>
      )}

      <div className="stock-accessories-section">
        <h4>Itens que acompanham o terminal</h4>
        <p className="muted">Marque o que está sendo enviado junto com cada terminal.</p>
        <div className="stock-accessories-grid">
        {items.map((item, index) => {
          const selectedKeys = accessories[item.id] ?? [];
          const requestedKeys = stockAccessoryOptions.filter((option) => option.requestedBy(item)).map((option) => option.key);
          const pendingRequested = requestedKeys.filter((key) => !selectedKeys.includes(key)).length;
          return (
          <div className="stock-accessories-line" key={item.id}>
            <div className="stock-accessories-header">
              <div className="stock-accessories-title">
                <strong>Item {index + 1}: {item.terminal_model}</strong>
                <small className="muted">
                  {[item.part_number, item.client_name].filter(Boolean).join(" · ")}
                  {" · "}solicitado {item.quantity}
                </small>
              </div>
              <span
                className={`stock-accessories-progress ${pendingRequested > 0 ? "pending" : ""}`}
                title={pendingRequested > 0 ? `${pendingRequested} pedido(s) na OS ainda não marcado(s)` : "Todos os pedidos na OS estão marcados"}
              >
                {selectedKeys.length}/{stockAccessoryOptions.length}
              </span>
            </div>
            {requestedKeys.length > 0 && pendingRequested > 0 && (
              <button
                type="button"
                className="ghost stock-accessories-quick"
                onClick={() => setAccessories((current) => ({
                  ...current,
                  [item.id]: Array.from(new Set([...(current[item.id] ?? []), ...requestedKeys]))
                }))}
              >
                <CheckCircle2 size={14} />
                Marcar pedidos na OS ({pendingRequested})
              </button>
            )}
            <div className="stock-accessories-checklist">
              {stockAccessoryOptions.map((option) => {
                const checked = (accessories[item.id] ?? []).includes(option.key);
                const requested = option.requestedBy(item);
                const missing = requested && !checked;
                return (
                  <label
                    key={option.key}
                    className={`stock-accessory-row ${checked ? "checked" : ""} ${missing ? "missing" : ""}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleAccessory(item.id, option.key)} />
                    <span className="stock-accessory-name">{option.label}</span>
                    {requested && (
                      <span className="stock-accessory-requested">
                        {missing && <AlertTriangle size={14} aria-hidden="true" />}
                        pedido na OS
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          );
        })}
        </div>
      </div>

      <button
        className="primary"
        type="button"
        disabled={busy || hasInvalid || !resultAllowed}
        onClick={() => run("stock/check", {
          result,
          accessoriesNote,
          items: items.map((item) => ({
            id: item.id,
            checkedQuantity: Number(quantities[item.id]),
            note: notes[item.id],
            accessories: accessories[item.id] ?? []
          }))
        })}
      >
        <CheckCircle2 size={18} />
        Registrar conferência
      </button>
    </section>
  );
}

function StockReturnDecisionPanel({ onAction, onEdit, canEdit = true }) {
  const [decision, setDecision] = useState(null);
  const [justification, setJustification] = useState("");
  const [recheckNote, setRecheckNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action, body) {
    setBusy(true);
    try {
      await onAction(action, body);
    } catch {
      // A mensagem de erro já é exibida pelo runOrderAction
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="validation-decision-panel">
      <h4>Falta de material: o que deseja fazer?</h4>
      <div className="stock-decision-buttons">
        <button type="button" className={decision === "forward" ? "primary" : "ghost"} onClick={() => setDecision("forward")}>
          <Send size={16} />
          Encaminhar ao Suporte
        </button>
        <button type="button" className={decision === "recheck" ? "primary" : "ghost"} onClick={() => setDecision("recheck")}>
          <RefreshCw size={16} />
          Devolver ao Estoque
        </button>
        {canEdit && (
          <button type="button" className="ghost" onClick={onEdit}>
            <Edit3 size={16} />
            Editar OS
          </button>
        )}
      </div>

      {decision === "forward" && (
        <div className="decision-step-yes">
          <label>
            Justificativa (obrigatória, fica registrada no histórico)
            <textarea
              placeholder="Explique por que a ordem segue para o Suporte mesmo com falta de material..."
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
            />
          </label>
          <button
            className="primary"
            type="button"
            disabled={busy || justification.trim().length < 5}
            onClick={() => run("stock-return/forward", { justification })}
          >
            <Send size={18} />
            Confirmar encaminhamento
          </button>
        </div>
      )}

      {decision === "recheck" && (
        <div className="decision-step-no">
          <label>
            Observação para o estoque (opcional)
            <textarea value={recheckNote} onChange={(event) => setRecheckNote(event.target.value)} />
          </label>
          <button className="primary" type="button" disabled={busy} onClick={() => run("stock-return/recheck", { message: recheckNote })}>
            <RefreshCw size={18} />
            Devolver para nova conferência
          </button>
        </div>
      )}
    </section>
  );
}

function OrderDetails({
  session,
  selected,
  feedback,
  setFeedback,
  signatureName,
  setSignatureName,
  onSubmit,
  onSign,
  onCorrection,
  onIncorrectSignature,
  onOrderAction,
  onEdit,
  allowEdit = true
}) {
  const [validationDecision, setValidationDecision] = useState(null);
  const [keyCount, setKeyCount] = useState("");
  const [correctionMsg, setCorrectionMsg] = useState("");

  useEffect(() => {
    setValidationDecision(null);
    setKeyCount("");
    setCorrectionMsg("");
  }, [selected?.id]);

  if (!selected) {
    return (
      <section className="panel empty-state">
        <History size={34} />
        <h3>Selecione uma ordem</h3>
        <p className="muted">Escolha uma ordem na lista para ver dados, itens, assinaturas e histórico.</p>
      </section>
    );
  }

  const signatures = selected.signatures ?? [];
  const items = selected.items?.length
    ? selected.items
    : [{
      id: selected.id,
      item_name: selected.item_name,
      terminal_model: selected.item_identifier,
      part_number: "-",
      client_name: "-",
      quantity: 1,
      configuration: selected.usage_reason
    }];
  const signedUserIds = signatures.map((signature) => signature.signer_id);
  const isRecipient = selected.destination_role === session.user.role;
  const hasCurrentUserSigned = signedUserIds.includes(session.user.id);
  const isSpectator = session.user.role === "spectator";
  const isOwnerOrAdmin = session.user.role === "admin" || (session.user.role === "requester" && selected.requester_id === session.user.id);
  const canEdit = allowEdit && ["admin", "requester"].includes(session.user.role) && ["draft", "correction_requested", "divergent", "stock_returned"].includes(selected.status);
  const canSubmit = canEdit && selected.status !== "stock_returned";
  const isStockUser = session.user.role === "stock";
  const canStockAct = isStockUser && ["awaiting_stock_check", "stock_checking", "stock_picking"].includes(selected.status);
  const canDecideStockReturn = isOwnerOrAdmin && selected.status === "stock_returned" && Boolean(onOrderAction);
  const hasStockCheck = items.some((item) => item.stock_checked_quantity != null);
  const canReview = selected.status === "pending_signature" && !hasCurrentUserSigned && isRecipient;

  const divergenceInfo = selected.divergence ?? (
    session.user.role === "admin" && selected.status === "divergent"
      ? (() => {
        const divEvent = [...(selected.events ?? [])]
          .reverse()
          .find((e) => e.event_type?.toLowerCase().includes("diverg") || e.event_type?.toLowerCase().includes("corre"));
        return divEvent ? {
          reason: divEvent.message,
          createdAt: divEvent.created_at,
          validatorName: divEvent.actor_name,
          validatorEmail: divEvent.actor_email
        } : null;
      })()
      : null
  );

  return (
    <section className="panel detail-panel">
      <div className="detail-head">
        <div className="detail-head-main">
          <p className="eyebrow">OS {selected.code}</p>
          <h2>{typeLabel(selected.order_type)} · {[...new Set(items.map((item) => item.terminal_model).filter(Boolean))].join(", ") || "—"}</h2>
          <div className="detail-head-status">
            <span className={`status-badge ${selected.status}`}>
              {React.createElement(statusIcons[selected.status] ?? FileSignature, { size: 12 })}
              {statusLabels[selected.status] ?? selected.status}
            </span>
            <span className="signature-progress" title={`${signatures.length} de 2 assinaturas`}>
              <span className="signature-progress-bar">
                <span style={{ width: `${Math.min(signatures.length, 2) * 50}%` }} />
              </span>
              {signatures.length}/2 assinaturas
            </span>
          </div>
        </div>
        {canEdit && (
          <button className="ghost edit-order-button" onClick={() => onEdit(selected)} title="Editar OS">
            <Edit3 size={16} />
            <span>Editar</span>
          </button>
        )}
      </div>

      <div className="order-identification-block">
        <div className="id-card">
          <span className="id-label">Número da OS</span>
          <span className="id-value">{selected.authorized_person_document || selected.code || "—"}</span>
        </div>
        <div className="id-card">
          <span className="id-label">Solicitante</span>
          <span className="id-value">{selected.authorized_person_name || selected.requester_name || "—"}</span>
        </div>
      </div>

      {Number(selected.incorrect_signatures) > 0 && (
        <section className="incorrect-signature-callout">
          <div className="incorrect-signature-callout-header">
            <div>
              <AlertTriangle size={20} color="#d97706" />
              <strong>Assinatura incorreta — {selected.incorrect_signatures} {Number(selected.incorrect_signatures) === 1 ? "tentativa" : "tentativas"}</strong>
            </div>
            <span className="incorrect-tag">Retornou para assinatura</span>
          </div>
          <p className="incorrect-signature-desc">
            Esta ordem teve assinatura incorreta registrada anteriormente e retornou para a etapa de assinatura. Uma nova assinatura deve ser realizada.
          </p>
        </section>
      )}

      {selected.occurrences?.length > 0 && (
        <section className="occurrences-callout">
          <div className="occurrences-callout-header">
            <div>
              <AlertTriangle size={20} color="#b45309" />
              <strong>Auditoria: Registro de Ocorrências ({selected.occurrences.length})</strong>
            </div>
            <span className="occurrences-tag">Registro persistente</span>
          </div>
          <div className="occurrences-list-box">
            {selected.occurrences.map((occ) => (
              <div key={occ.id} className={`occurrence-detail-card ${occ.status}`}>
                <div className="occ-card-top">
                  <span className="occ-badge-attempts">{occ.attempt_count}ª tentativa incorreta</span>
                  <span className="occ-card-date">{formatDateTime(occ.created_at)}</span>
                  <span className={`occ-status-tag ${occ.status}`}>
                    {occ.status === "resolved" ? "Resolvida" : occ.status === "email_sent" ? "Notificação enviada" : "Pendente"}
                  </span>
                </div>
                <p className="occ-card-desc">{occ.description}</p>
                <div className="occ-card-footer">
                  <small className="muted">Usuário envolvido: <strong>{occ.user_name}</strong></small>
                  {occ.email_recipient && (
                    <small className="muted"> • Destinatário: {occ.email_recipient}</small>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {divergenceInfo && (
        <section className="divergence-callout">
          <div className="divergence-callout-header">
            <div>
              <AlertTriangle size={20} color="#9f2d3a" />
              <strong>Ordem de Serviço #{selected.code}</strong>
            </div>
            <span className="divergence-tag">Status: Divergente</span>
          </div>
          <div className="divergence-body">
            <div>
              <label>Motivo da divergência:</label>
              <p className="divergence-reason">{divergenceInfo.reason || "Nenhum motivo detalhado informado."}</p>
            </div>
            <dl className="divergence-meta">
              <div>
                <dt>Data:</dt>
                <dd>{formatDateTime(divergenceInfo.createdAt)}</dd>
              </div>
              <div>
                <dt>Validador:</dt>
                <dd>{divergenceInfo.validatorName || "Validador"}{divergenceInfo.validatorEmail ? ` (${divergenceInfo.validatorEmail})` : ""}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      <h3 className="detail-section-title">Dados da ordem</h3>
      <dl className="info-grid">
        <div><dt>Tipo da ordem</dt><dd>{typeLabel(selected.order_type)}</dd></div>
        <div>
          <dt>Equipe executora</dt>
          <dd>
            <span className={`executor-pill ${selected.executor_team || "unassigned"}`}>
              {selected.executor_team === "producao" ? (
                <><Cpu size={12} style={{ marginRight: "4px" }} /> Produção</>
              ) : selected.executor_team === "suporte" ? (
                <><Wrench size={12} style={{ marginRight: "4px" }} /> Suporte</>
              ) : (
                "Não informada"
              )}
            </span>
          </dd>
        </div>
        <div><dt>Modelos</dt><dd>{items.map((item) => item.terminal_model).join(", ")}</dd></div>
        <div><dt>Part Numbers</dt><dd>{items.map((item) => item.part_number).join(", ")}</dd></div>
        <div><dt>Clientes</dt><dd>{items.map((item) => item.client_name).join(", ")}</dd></div>
        <div><dt>Quantia total</dt><dd>{items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)}</dd></div>
        <div><dt>Criada por</dt><dd>{selected.requester_name}</dd></div>
        <div><dt>Data da solicitação</dt><dd>{formatDate(selected.valid_from)}</dd></div>
        {session.user.role !== "requester" && (
          <div><dt>Destinatário</dt><dd>{destinationLabel(selected.destination_role)}</dd></div>
        )}
        <div><dt>Prazo de assinatura</dt><dd>{formatDateTime(selected.signature_due_at)}</dd></div>
        <div><dt>Aprovação</dt><dd>{signatures.length >= 2 ? "Completa" : `${signatures.length}/2 assinaturas`}</dd></div>
      </dl>

      <section>
        <h3 className="detail-section-title">Itens ({items.length})</h3>
        <div className="items-table">
          {items.map((item, idx) => (
            <div className="item-detail-card" key={item.id || idx}>
              <div className="item-card-head">
                <div>
                  <strong>{item.terminal_model || "—"}</strong>
                  <span className="muted"> · PN {item.part_number || "—"}</span>
                </div>
                <span className="item-qty">
                  Qtd {item.quantity}
                  {item.stock_checked_quantity != null && (
                    <small className={`stock-checked-qty ${item.stock_checked_quantity < item.quantity ? "short" : "ok"}`}>
                      {" "}· conferido {item.stock_checked_quantity}
                    </small>
                  )}
                </span>
              </div>
              <dl className="item-card-fields">
                <div><dt>Cliente</dt><dd>{item.client_name || "—"}</dd></div>
                <div><dt>Nota</dt><dd>{item.item_name || "—"}</dd></div>
                {!isSpectator && (
                  <div className="item-card-field-wide"><dt>Configuração</dt><dd>{item.configuration || "—"}</dd></div>
                )}
              </dl>
              {item.stock_accessories && (
                <p className="stock-item-note">
                  Acompanha o terminal: {item.stock_accessories.length
                    ? item.stock_accessories.map(stockAccessoryLabel).join(", ")
                    : "nenhum acessório"}
                </p>
              )}
              {item.stock_note && <p className="stock-item-note">Estoque: {item.stock_note}</p>}
              {(item.packaging || item.battery || item.terminal_opening || item.manual || item.charger || item.minbase || item.label || item.aesthetic_cover) && (
                <div className="item-detail-options-chips">
                  <span className="item-opt-chip"><strong>Embalagem:</strong> {item.packaging || "—"}</span>
                  <span className="item-opt-chip"><strong>Bateria:</strong> {item.battery || "—"}</span>
                  <span className="item-opt-chip"><strong>Abertura Terminal:</strong> {item.terminal_opening || item.terminalOpening || "—"}</span>
                  <span className="item-opt-chip"><strong>Manual:</strong> {item.manual || "—"}</span>
                  <span className="item-opt-chip"><strong>Carregador:</strong> {item.charger || "—"}</span>
                  <span className="item-opt-chip"><strong>Minbase:</strong> {item.minbase || "—"}</span>
                  <span className="item-opt-chip"><strong>Label:</strong> {item.label || "—"}</span>
                  <span className="item-opt-chip"><strong>Cobre Estético:</strong> {item.aesthetic_cover || item.aestheticCover || "—"}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="actions">
        {canSubmit && (
          <button type="button" className="primary" onClick={() => runHandled(onSubmit)}>
            <Send size={18} />
            Enviar
          </button>
        )}
      </div>

      {hasStockCheck && selected.stock_result && (
        <p className="inline-note">
          Conferência do estoque: <strong>{stockResultOptions.find((o) => o.value === selected.stock_result)?.label ?? selected.stock_result}</strong>
          {selected.stock_accessories_note ? ` | Acessórios: ${selected.stock_accessories_note}` : ""}
        </p>
      )}

      {canStockAct && (
        <StockCheckPanel key={`${selected.id}-${selected.status}`} order={selected} items={items} onAction={onOrderAction} />
      )}

      {canDecideStockReturn && (
        <StockReturnDecisionPanel key={selected.id} onAction={onOrderAction} onEdit={() => onEdit(selected)} canEdit={allowEdit} />
      )}

      {selected.status === "pending_signature" && hasCurrentUserSigned && (
        <p className="inline-note">Sua assinatura ja foi registrada. A ordem ainda aguarda a outra assinatura.</p>
      )}

      {canReview && (
        <section className="validation-decision-panel">
          <div className="signer-pill">
            <span>Assinante:</span>
            <strong>{session.user.name}</strong>
          </div>

          <div className="decision-prompt">
            <h4>A ordem está correta?</h4>
            <div className="decision-options">
              <label className={`decision-label ${validationDecision === "yes" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name={`decision-${selected.id}`}
                  value="yes"
                  checked={validationDecision === "yes"}
                  onChange={() => setValidationDecision("yes")}
                />
                <CheckCircle2 size={18} />
                <span>SIM</span>
              </label>
              <label className={`decision-label ${validationDecision === "no" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name={`decision-${selected.id}`}
                  value="no"
                  checked={validationDecision === "no"}
                  onChange={() => setValidationDecision("no")}
                />
                <XCircle size={18} />
                <span>NÃO</span>
              </label>
            </div>
          </div>

          {validationDecision === "yes" && (
            <div className="decision-step-yes">
              <label>
                Quantidade de chaves
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="numeric-input"
                  placeholder="Quantia de chaves"
                  value={keyCount}
                  onKeyDown={(e) => {
                    if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  onChange={(event) => {
                    const cleaned = event.target.value.replace(/\D/g, "").replace(/^0+/, "");
                    setKeyCount(cleaned);
                  }}
                  required
                />
              </label>
              <button
                className="success"
                type="button"
                disabled={!keyCount || Number(keyCount) <= 0}
                onClick={() => {
                  // Só limpa depois que a API aceitar: em caso de erro, a quantidade digitada continua na tela
                  runHandled(async () => {
                    await onSign(keyCount);
                    setValidationDecision(null);
                    setKeyCount("");
                  });
                }}
              >
                <CheckCircle2 size={18} />
                Confirmar validação
              </button>
            </div>
          )}

          {validationDecision === "no" && (
            <div className="decision-step-no">
              <label>
                Informe o que precisa ser corrigido
                <textarea
                  placeholder="Descreva detalhadamente o que precisa ser corrigido na OS..."
                  value={correctionMsg}
                  onChange={(event) => setCorrectionMsg(event.target.value)}
                  required
                />
              </label>
              {correctionMsg.trim().length > 0 && correctionMsg.trim().length < MIN_CORRECTION_LENGTH && (
                <small className="muted">Descreva a correção com pelo menos {MIN_CORRECTION_LENGTH} caracteres.</small>
              )}
              <button
                className="danger"
                type="button"
                disabled={correctionMsg.trim().length < MIN_CORRECTION_LENGTH}
                onClick={() => {
                  // Só limpa depois que a API aceitar: em caso de erro, o texto digitado continua na tela
                  runHandled(async () => {
                    await onCorrection(correctionMsg.trim());
                    setValidationDecision(null);
                    setCorrectionMsg("");
                  });
                }}
              >
                <RefreshCw size={18} />
                Enviar para correção
              </button>
            </div>
          )}
        </section>
      )}

      <section className="signature-list">
        <h3 className="detail-section-title">Assinaturas ({signatures.length}/2)</h3>
        {signatures.length === 0 && <p className="muted">Nenhuma assinatura registrada.</p>}
        {signatures.map((signature, index) => {
          const isCurrentUser = signature.signer_id === session.user.id;
          const isAdmin = session.user.role === "admin";
          const isSigned = selected.status === "signed";
          const realName = signature.signer_email ?? signature.display_signer_name ?? signature.user_name ?? signature.signer_name;
          const displayName = (isAdmin || isSigned) && realName
            ? realName
            : isCurrentUser
              ? (realName ? `Sua assinatura registrada (${realName})` : "Sua assinatura registrada")
              : (realName || `Assinatura ${index + 1} registrada`);

          return (
            <article className="signature-box" key={signature.id || index}>
              <ShieldCheck size={20} />
              <div>
                <strong>{displayName}</strong>
                {signature.key_count != null && <span> | {signature.key_count} chave(s)</span>}
                <span>{formatDateTime(signature.signed_at)}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section>
        <h3 className="detail-section-title">Histórico</h3>
        {!selected.events?.length && <p className="muted">Nenhum evento registrado.</p>}
        <ol className="timeline">
          {selected.events?.map((event) => {
            const actorName = event.actor_name || "Sistema";
            const type = (event.event_type || "").toLowerCase();
            const tone = /diverg|incorret|correç|correc|devolv|retorn/.test(type)
              ? "tone-danger"
              : /assin|aprov|conclu/.test(type)
                ? "tone-success"
                : /cria/.test(type)
                  ? "tone-neutral"
                  : "tone-info";

            return (
              <li key={event.id} className={`timeline-item ${tone}`}>
                <span className="timeline-dot" aria-hidden="true" />
                <div className="timeline-content">
                  <div className="timeline-head">
                    <strong>{event.event_type}</strong>
                    <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                  </div>
                  {event.message && <p>{event.message}</p>}
                  <small>por {actorName}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}

function AdminPanel({ users, currentUserId, newUser, setNewUser, onSubmit, onUpdateUser, onRemoveUser }) {
  const [userStatusFilter, setUserStatusFilter] = useState("active");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const normalizedSearch = userSearch.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matchesStatus = userStatusFilter === "active" ? user.active : !user.active;
    const matchesRole = userRoleFilter === "all" || user.role === userRoleFilter;
    const matchesSearch = !normalizedSearch ||
      user.name.toLowerCase().includes(normalizedSearch) ||
      user.email.toLowerCase().includes(normalizedSearch) ||
      roleLabel(user.role).toLowerCase().includes(normalizedSearch);

    return matchesStatus && matchesRole && matchesSearch;
  });

  function update(field, value) {
    setNewUser((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="panel admin-panel">
      <div className="panel-title">
        <UserPlus size={18} />
        <h3>Usuarios</h3>
      </div>
      <form className="stack" onSubmit={onSubmit}>
        <input placeholder="Nome" value={newUser.name} onChange={(event) => update("name", event.target.value)} required />
        <input placeholder="Email" value={newUser.email} onChange={(event) => update("email", event.target.value)} required />
        <input placeholder="Senha inicial" value={newUser.password} onChange={(event) => update("password", event.target.value)} required />
        <select value={newUser.role} onChange={(event) => update("role", event.target.value)}>
          {roleOptions.map((role) => (
            <option key={role.value} value={role.value}>{role.label}</option>
          ))}
        </select>
        <button className="primary" type="submit">
          <UserPlus size={18} />
          Criar
        </button>
      </form>
      <div className="user-tools">
        <div className="search-field">
          <Search size={17} />
          <input
            placeholder="Pesquisar usuario"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
          />
        </div>
        <div className="segmented-control">
          <button className={userStatusFilter === "active" ? "active" : ""} onClick={() => setUserStatusFilter("active")}>
            Ativos
          </button>
          <button className={userStatusFilter === "deleted" ? "active" : ""} onClick={() => setUserStatusFilter("deleted")}>
            Excluidos
          </button>
        </div>
        <select value={userRoleFilter} onChange={(event) => setUserRoleFilter(event.target.value)} title="Filtrar por tipo">
          <option value="all">Todos os tipos</option>
          {roleOptions.map((role) => (
            <option key={role.value} value={role.value}>{role.label}</option>
          ))}
        </select>
      </div>
      <div className="user-list">
        {filteredUsers.map((user) => (
          <article className={!user.active ? "inactive-user" : ""} key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email} | {roleLabel(user.role)} | {user.active ? "ativo" : "removido"}</small>
            </div>
            <select
              value={user.role}
              disabled={user.id === currentUserId || !user.active}
              onChange={(event) => onUpdateUser(user.id, { role: event.target.value })}
              title="Alterar tipo"
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            {user.active ? (
              <button
                className="danger icon-button"
                disabled={user.id === currentUserId}
                onClick={() => onRemoveUser(user.id)}
                title="Remover usuario"
              >
                <Trash2 size={18} />
              </button>
            ) : (
              <button
                className="ghost icon-button"
                onClick={() => onUpdateUser(user.id, { active: true })}
                title="Reativar usuario"
              >
                <Save size={18} />
              </button>
            )}
          </article>
        ))}
        {filteredUsers.length === 0 && <p className="muted">Nenhum usuario encontrado.</p>}
      </div>
    </section>
  );
}

function typeLabel(value) {
  return orderTypeOptions.find((option) => option.value === value)?.label ?? value ?? "-";
}

function roleLabel(value) {
  return roleOptions.find((option) => option.value === value)?.label ?? value ?? "-";
}

function destinationLabel(value) {
  return destinationOptions.find((option) => option.value === value)?.label ?? roleLabel(value);
}

function orderValidationHint(order) {
  const signatures = Number(order.signature_count ?? 0);

  if (order.status === "signed") {
    return "Aprovada com duas assinaturas";
  }

  if (order.status === "pending_signature") {
    if (signatures === 0) {
      return "Pendente Validação";
    }
    return `Faltam ${Math.max(2 - signatures, 0)} assinatura(s)`;
  }

  if (order.status === "correction_requested") {
    return "Aguardando correcao";
  }

  if (order.status === "awaiting_stock_check" || order.status === "stock_checking") {
    return "Conferência do estoque";
  }

  if (order.status === "stock_picking") {
    return "Separação do material";
  }

  if (order.status === "stock_returned") {
    return "Decisão de Operações sobre falta de material";
  }

  if (order.status === "divergent") {
    return "Correção de Operações (divergência na assinatura)";
  }

  if (order.status === "draft") {
    return "Ainda nao enviada";
  }

  return "Sem pendencia ativa";
}

// Intervalo [início, fim] em datas "AAAA-MM-DD" do calendário de Brasília,
// tomando como "hoje" a hora oficial obtida pela rede.
function periodDateKeys(period, customStart, customEnd) {
  const today = todayKey();

  if (period === "today") return [today, today];
  if (period === "7d") return [addDaysToKey(today, -6), today];
  if (period === "30d") return [addDaysToKey(today, -29), today];
  if (period === "month") return [`${today.slice(0, 7)}-01`, today];
  if (period === "custom") {
    const start = customStart || addDaysToKey(today, -6);
    const end = customEnd || today;
    return start > end ? [end, start] : [start, end];
  }
  return null;
}

function formatPeriodRange(period, customStart, customEnd) {
  if (period === "all" || !period) return "Todas as datas";
  if (period === "custom" && !(customStart && customEnd)) return "Personalizado";

  const range = periodDateKeys(period, customStart, customEnd);
  if (!range) return "Todas as datas";
  return `${keyToBr(range[0])} até ${keyToBr(range[1])}`;
}

function orderMatchesPeriod(order, period, startDate, endDate) {
  if (period === "all" || !period) return true;

  const rawDate = order.created_at || order.valid_from;
  if (!rawDate) return true;
  const orderDate = new Date(rawDate);
  if (isNaN(orderDate.getTime())) return true;

  const range = periodDateKeys(period, startDate, endDate);
  if (!range) return true;

  const orderKey = brasiliaDateKey(orderDate);
  return orderKey >= range[0] && orderKey <= range[1];
}

// Converte a chave de status clicada no dashboard no filtro do "Histórico de ordens"
function dashboardStatusToUserFilter(statusKey) {
  return {
    total: "todas",
    pending_signature: "pendente_validacao",
    correction_requested: "recertificar",
    signed: "signed",
    divergent: "divergent",
    awaiting_stock_check: "estoque",
    stock_picking: "em_separacao",
    stock_returned: "retorno_estoque"
  }[statusKey] || "todas";
}

function userOrderMatchesFilter(order, filter) {
  const signatureCount = Number(order.signature_count ?? 0);

  if (filter === "todas" || filter === "all" || filter === "total") {
    return true;
  }

  if (filter === "draft") {
    return order.status === "draft";
  }

  if (filter === "pending_signature") {
    return order.status === "pending_signature";
  }

  if (filter === "pendente_validacao" || filter === "sem_assinatura") {
    return order.status === "pending_signature" && signatureCount === 0;
  }

  if (filter === "aguardando_1") {
    return order.status === "pending_signature" && signatureCount === 1;
  }

  if (filter === "signed") {
    return order.status === "signed";
  }

  if (filter === "recertificar" || filter === "correction_requested") {
    return order.status === "correction_requested";
  }

  if (filter === "divergent") {
    return order.status === "divergent" || Number(order.incorrect_signatures ?? 0) > 0;
  }

  if (filter === "estoque") {
    return ["awaiting_stock_check", "stock_checking"].includes(order.status);
  }

  if (filter === "em_separacao") {
    return order.status === "stock_picking";
  }

  if (filter === "retorno_estoque") {
    return order.status === "stock_returned";
  }

  return true;
}

function orderMatchesSearch(order, search) {
  const searchableText = [
    order.code,
    order.authorized_person_document,
    order.order_type,
    typeLabel(order.order_type),
    order.executor_team,
    order.executor_team === "producao" ? "produção producao" : order.executor_team === "suporte" ? "suporte" : "",
    order.terminal_models,
    order.item_identifier,
    order.client_names,
    order.authorized_person_name,
    order.requester_name,
    order.part_numbers
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchableText.includes(search);
}

function exportOrdersToExcel(ordersToExport, scope) {
  if (!ordersToExport.length) return;

  const headers = [
    "Codigo",
    "Numero OS",
    "Tipo",
    "Equipe executora",
    "Status",
    "Modelos",
    "Part Numbers",
    "Clientes",
    "Solicitante",
    "Criada por",
    "Quantia total",
    "Assinaturas",
    "Assinaturas incorretas",
    "Pendencia",
    "Data solicitacao",
    "Prazo assinatura"
  ];
  const rows = ordersToExport.map((order) => [
    order.code,
    order.authorized_person_document,
    typeLabel(order.order_type),
    order.executor_team === "producao" ? "Produção" : order.executor_team === "suporte" ? "Suporte" : "Não informada",
    statusLabels[order.status] ?? order.status,
    order.terminal_models ?? order.item_identifier ?? "",
    order.part_numbers ?? "",
    order.client_names ?? "",
    order.authorized_person_name,
    order.requester_name,
    order.total_quantity ?? "",
    `${order.signature_count ?? 0}/2`,
    order.incorrect_signatures ?? 0,
    orderValidationHint(order),
    formatDate(order.valid_from),
    formatDateTime(order.signature_due_at)
  ]);
  const tableRows = [
    `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`,
    ...rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(excelSafeValue(value))}</td>`).join("")}</tr>`)
  ].join("");
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `ordens-servico-${scope}-${todayKey()}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function excelSafeValue(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  // Data pura (coluna DATE, "AAAA-MM-DD"): formata sem conversão de fuso
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  // Data com horário (timestamp ISO em UTC): converte para o dia de Brasília
  return new Intl.DateTimeFormat("pt-BR", { timeZone: BRASILIA_TIMEZONE }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: BRASILIA_TIMEZONE }).format(new Date(value));
}

// Só renderiza depois de obter a hora oficial (com limite de espera, para não travar a tela).
Promise.race([syncOfficialTime(), new Promise((resolve) => setTimeout(resolve, 5000))])
  .catch((error) => console.error("[Hora oficial]", error.message))
  .finally(() => {
    startOfficialTimeSync();
    createRoot(document.getElementById("root")).render(<App />);
  });
