import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Cpu,
  Edit3,
  ExternalLink,
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
  TrendingUp,
  UserCheck,
  Users,
  UserPlus,
  Wrench,
  XCircle
} from "lucide-react";
import "./styles.css";

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

const STOCK_STATUSES = ["awaiting_stock_check", "stock_checking", "stock_picking", "stock_returned"];

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
  return useMemo(() => {
    async function request(path, options = {}) {
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          ...options.headers
        }
      });

      if (response.status === 401) {
        onUnauthorized();
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? "Erro ao comunicar com a API.");
      }

      return data;
    }

    return { request };
  }, [session, onUnauthorized]);
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
  const [email, setEmail] = useState("solicitante@empresa.com");
  const [password, setPassword] = useState("123456");
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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message);
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
          <p className="muted"></p>
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
    const stored = localStorage.getItem("ordens:session");
    return stored ? JSON.parse(stored) : null;
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
        const mappedFilter = {
          total: "todas",
          pending_signature: "pendente_validacao",
          correction_requested: "recertificar",
          signed: "signed",
          divergent: "divergent",
          awaiting_stock_check: "estoque",
          stock_picking: "em_separacao",
          stock_returned: "retorno_estoque"
        }[statusKey] || "todas";
        setUserStatusFilter(mappedFilter);
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

  function logout() {
    localStorage.removeItem("ordens:session");
    setSession(null);
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
    const fullOrder = await api.request(`/orders/${order.id}`);
    setSelected(fullOrder);
    if (fullOrder?.executor_team && fullOrder.executor_team !== executorTabRef.current) {
      setExecutorTab(fullOrder.executor_team);
      executorTabRef.current = fullOrder.executor_team;
      await loadData(fullOrder.executor_team);
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

      if (!it.packaging || !["CAIXA", "SACO BOLHA"].includes(it.packaging)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Embalagem" (CAIXA ou SACO BOLHA).`);
        return;
      }
      if (!it.battery || !["SIM", "NÃO"].includes(it.battery)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Bateria" (SIM ou NÃO).`);
        return;
      }
      if (!it.terminalOpening || !["SIM", "NÃO"].includes(it.terminalOpening)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Abertura de Terminal" (SIM ou NÃO).`);
        return;
      }
      if (!it.manual || !["SIM", "NÃO"].includes(it.manual)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Manual" (SIM ou NÃO).`);
        return;
      }
      if (!it.charger || !["SIM", "NÃO"].includes(it.charger)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Carregador" (SIM ou NÃO).`);
        return;
      }
      if (!it.minbase || !["SIM", "NÃO"].includes(it.minbase)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Minbase" (SIM ou NÃO).`);
        return;
      }
      if (!it.label || !["SIM", "NÃO"].includes(it.label)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Label" (SIM ou NÃO).`);
        return;
      }
      if (!it.aestheticCover || !["SIM", "NÃO"].includes(it.aestheticCover)) {
        setMessage(`Item ${itemNum}: Selecione a opção obrigatória "Cobre Estético" (SIM ou NÃO).`);
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
        setSelected(await api.request(`/orders/${selected.id}`));
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
            <button className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={() => safeNavigate(logout)}>
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
            <button
              className={`sidebar-btn sidebar-btn-primary ${userMenu === "create" ? "active" : ""}`}
              onClick={() => {
                safeNavigate(() => {
                  setEditingId(null);
                  setForm(createEmptyOrder(session?.user?.name ?? ""));
                  setUserMenu("create");
                });
              }}
            >
              <Plus size={16} />
              <span>Criar ordem</span>
            </button>
            <button
              className={`sidebar-btn sidebar-btn-secondary ${userMenu === "orders" ? "active" : ""}`}
              onClick={() => safeNavigate(() => setUserMenu("orders"))}
            >
              <ClipboardList size={16} />
              <span>Histórico de ordens</span>
            </button>
            <button className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={() => safeNavigate(logout)}>
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
            <button className="sidebar-btn sidebar-btn-secondary sidebar-logout" onClick={logout}>
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
            onSelectOrder={async (orderId) => {
              setUserMenu("orders");
              try {
                const fullOrder = await api.request(`/orders/${orderId}`);
                await selectOrder(fullOrder);
              } catch (err) {
                console.error("Erro ao carregar ordem da ocorrência:", err);
              }
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
                    if (result?.order) {
                      await selectOrder(result.order);
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
    </main>
  );
}

function OrderForm({ form, setForm, catalog, editingId, onSubmit, onCancel, onDirectSubmit, session, api }) {
  const [nextCode, setNextCode] = useState("");

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
    <form className="panel order-form" onSubmit={onSubmit}>
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
          <strong>{editingId && form.validFrom ? formatDate(form.validFrom) : formatDate(today())}</strong>
        </div>
        <div className="auto-field">
          <span>Prazo Assinatura</span>
          <strong>{editingId && form.signatureDueAt ? formatDateTime(form.signatureDueAt) : formatDate(tomorrow())}</strong>
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
        <button className="primary" type="submit">
          <FileSignature size={18} />
          Salvar
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
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
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


function DashboardPanel({ session, api, onNavigateOrders }) {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  const fetchDashboard = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.request("/dashboard");
      setDashboardData(data);
    } catch (err) {
      console.error("Erro ao carregar dados do dashboard:", err);
      setError(err?.message ?? "Falha ao carregar indicadores.");
    } finally {
      setLoading(false);
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
  const showStockMetrics = ["admin", "requester", "stock"].includes(userRole);

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

        <button
          type="button"
          className="dashboard-refresh-btn"
          onClick={fetchDashboard}
          disabled={loading}
          title="Atualizar dados agora"
          aria-label="Atualizar dados agora"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          <span>Atualizar</span>
        </button>
      </div>

      {error && (
        <div className="notification-banner warning">
          <div className="notification-content">
            <strong>Aviso</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Grid com os 5 cards simples e objetivos */}
      <section className="dashboard-metrics-section">
        <div className="dashboard-metrics-grid">
          <DashboardMetricCard
            title="Total de OS"
            value={metrics.totalOrders}
            icon={<ClipboardList size={18} />}
            variant="primary"
            onClick={() => onNavigateOrders && onNavigateOrders("total")}
          />
          <DashboardMetricCard
            title="Aguardando validação"
            value={metrics.awaitingValidation}
            icon={<Clock3 size={18} />}
            variant="warning"
            onClick={() => onNavigateOrders && onNavigateOrders("pending_signature")}
          />
          <DashboardMetricCard
            title="Aguardando correção"
            value={metrics.awaitingCorrection}
            icon={<RefreshCw size={18} />}
            variant="info"
            onClick={() => onNavigateOrders && onNavigateOrders("correction_requested")}
          />
          <DashboardMetricCard
            title="Aprovadas"
            value={metrics.approved}
            icon={<CheckCircle2 size={18} />}
            variant="success"
            onClick={() => onNavigateOrders && onNavigateOrders("signed")}
          />
          <DashboardMetricCard
            title="Divergências"
            value={metrics.divergent}
            icon={<AlertTriangle size={18} />}
            variant="danger"
            onClick={() => onNavigateOrders && onNavigateOrders("divergent")}
          />
          {showStockMetrics && (
            <>
              <DashboardMetricCard
                title="Aguardando conferência"
                value={metrics.awaitingStockCheck}
                icon={<Inbox size={18} />}
                variant="info"
                onClick={() => onNavigateOrders && onNavigateOrders("awaiting_stock_check")}
              />
              <DashboardMetricCard
                title="Em separação"
                value={metrics.stockPicking}
                icon={<Activity size={18} />}
                variant="primary"
                onClick={() => onNavigateOrders && onNavigateOrders("stock_picking")}
              />
              <DashboardMetricCard
                title="Retorno do estoque"
                value={metrics.stockReturned}
                icon={<AlertTriangle size={18} />}
                variant="warning"
                onClick={() => onNavigateOrders && onNavigateOrders("stock_returned")}
              />
            </>
          )}
        </div>
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

function OccurrencesPanel({ api, onSelectOrder }) {
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedForEmail, setSelectedForEmail] = useState(null);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailResponse, setEmailResponse] = useState(null);
  const [notificationMsg, setNotificationMsg] = useState(null);

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
  };

  const handleSendEmail = async () => {
    if (!selectedForEmail) return;
    try {
      setEmailSending(true);
      const res = await api.request(`/orders/occurrences/${selectedForEmail.id}/send-email`, {
        method: "POST",
        body: JSON.stringify({ recipient: emailRecipient || undefined })
      });
      setEmailResponse(res);
      fetchOccurrences();
    } catch (err) {
      console.error("Erro ao enviar e-mail:", err);
      setNotificationMsg({ type: "error", text: err?.message || "Erro ao preparar/enviar e-mail." });
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
        <div className={`occ-summary-card total ${filterStatus === "all" ? "active" : ""}`} onClick={() => setFilterStatus("all")}>
          <span className="occ-summary-label">Total de Ocorrências</span>
          <strong className="occ-summary-value">{occurrences.length}</strong>
        </div>
        <div className={`occ-summary-card pending ${filterStatus === "pending" ? "active" : ""}`} onClick={() => setFilterStatus("pending")}>
          <span className="occ-summary-label">Pendentes de Ação</span>
          <strong className="occ-summary-value text-warning">{pendingCount}</strong>
        </div>
        <div className={`occ-summary-card sent ${filterStatus === "email_sent" ? "active" : ""}`} onClick={() => setFilterStatus("email_sent")}>
          <span className="occ-summary-label">Notificadas por E-mail</span>
          <strong className="occ-summary-value text-info">{sentCount}</strong>
        </div>
        <div className={`occ-summary-card resolved ${filterStatus === "resolved" ? "active" : ""}`} onClick={() => setFilterStatus("resolved")}>
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

      <div className="occurrences-table-wrapper">
        {filtered.length === 0 ? (
          <div className="occurrences-empty">
            <Inbox size={36} className="muted" />
            <p>Nenhuma ocorrência encontrada para os filtros selecionados.</p>
          </div>
        ) : (
          <table className="occurrences-table">
            <thead>
              <tr>
                <th>Ordem de Serviço</th>
                <th>Data / Hora</th>
                <th>Usuário Envolvido</th>
                <th>Tipo do Erro & Descrição</th>
                <th>Tentativas</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((occ) => (
                <tr key={occ.id} className={`occ-row ${occ.status}`}>
                  <td className="occ-cell-os">
                    <button
                      type="button"
                      className="occ-os-btn"
                      onClick={() => onSelectOrder && onSelectOrder(occ.service_order_id)}
                      title="Abrir detalhes desta OS"
                    >
                      <ClipboardList size={14} />
                      <strong>{occ.order_code}</strong>
                    </button>
                    <small className="muted">{occ.order_type} ({occ.executor_team || "suporte"})</small>
                  </td>
                  <td className="occ-cell-date">
                    <span>{formatDateTime(occ.created_at)}</span>
                  </td>
                  <td className="occ-cell-user">
                    <strong>{occ.user_name}</strong>
                  </td>
                  <td className="occ-cell-desc">
                    <span className="occ-error-type-tag">{occ.error_type}</span>
                    <p className="occ-desc-text">{occ.description}</p>
                  </td>
                  <td className="occ-cell-attempts">
                    <span className="occ-attempt-badge">{occ.attempt_count} tentativas</span>
                  </td>
                  <td className="occ-cell-status">
                    <span className={`occ-status-badge ${occ.status}`}>
                      {occ.status === "resolved"
                        ? "Resolvida"
                        : occ.status === "email_sent"
                          ? "E-mail Enviado"
                          : "Pendente"}
                    </span>
                    {occ.email_sent_at && (
                      <small className="muted block">
                        Envio: {formatDateTime(occ.email_sent_at)}
                      </small>
                    )}
                  </td>
                  <td className="occ-cell-actions">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  Deixe em branco para usar o destinatário padrão configurado no sistema.
                </small>
              </div>

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
                  <p><strong>Tipo de Erro:</strong> {selectedForEmail.error_type}</p>
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
                    <span>Disparar Notificação</span>
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

function PeriodFilterControl({
  period,
  onPeriodChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onApplyCustom
}) {
  const periodButtons = [
    { value: "all", label: "Todas" },
    { value: "today", label: "Hoje" },
    { value: "7d", label: "Últimos 7 dias" },
    { value: "30d", label: "Últimos 30 dias" },
    { value: "month", label: "Este mês" },
    { value: "custom", label: "Personalizado" }
  ];

  return (
    <div className="orders-period-filter-wrapper">
      <div className="orders-period-filter-header">
        <span className="filter-label">
          <Calendar size={14} />
          <span>Período</span>
        </span>
        <span className="period-range-indicator">
          {formatPeriodRange(period, startDate, endDate)}
        </span>
      </div>

      <div className="orders-period-controls">
        <div className="dashboard-period-tabs" role="tablist">
          {periodButtons.map((btn) => (
            <button
              key={btn.value}
              type="button"
              role="tab"
              aria-selected={period === btn.value}
              className={`period-tab-btn ${period === btn.value ? "active" : ""}`}
              onClick={() => onPeriodChange(btn.value)}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="dashboard-custom-dates">
            <label className="date-picker-label">
              <span>De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="dashboard-date-input"
              />
            </label>
            <label className="date-picker-label">
              <span>Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="dashboard-date-input"
              />
            </label>
            {onApplyCustom && (
              <button
                type="button"
                className="dashboard-apply-btn"
                onClick={onApplyCustom}
              >
                Filtrar
              </button>
            )}
          </div>
        )}
      </div>
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
  initialFilter = "pendente_validacao"
}) {
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  const filteredOrders = periodFilteredOrders.filter((order) =>
    userOrderMatchesFilter(order, filter)
  );

  const isRequester = session?.user?.role === "requester";
  const seesStockFlow = ["requester", "stock", "spectator"].includes(session?.user?.role);
  const filterOptions = [
    { value: "todas", label: "TODAS" },
    ...(isRequester ? [{ value: "draft", label: "RASCUNHOS" }] : []),
    ...(seesStockFlow
      ? [
        { value: "estoque", label: "CONFERÊNCIA ESTOQUE" },
        { value: "em_separacao", label: "EM SEPARAÇÃO" },
        { value: "retorno_estoque", label: "RETORNO DO ESTOQUE" }
      ]
      : []),
    { value: "pendente_validacao", label: "PENDENTE VALIDAÇÃO" },
    { value: "aguardando_1", label: "AGUARDANDO 1 ASSINATURA" },
    { value: "signed", label: "ASSINADAS" },
    { value: "recertificar", label: "RECERTIFICAR" },
    { value: "divergent", label: "DIVERGÊNCIAS" }
  ];

  return (
    <div className="content-grid user-orders-layout">
      <section className="orders-column">
        <div className="panel user-orders-panel">
          <div className="panel-title">
            <ClipboardList size={18} />
            <h3>Ordens de servico</h3>
          </div>

          <div className="orders-executor-tabs" role="tablist" aria-label="Equipe executora">
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

          <PeriodFilterControl
            period={period}
            onPeriodChange={setPeriod}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            onApplyCustom={() => setAppliedCustomDates({ start: startDate, end: endDate })}
          />

          <div className="user-order-filters">
            {filterOptions.map((option) => (
              <button
                className={filter === option.value ? "active" : ""}
                key={option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {session.user.role === "requester" && (
            <button className="primary" onClick={onNewOrder}>
              <Plus size={18} />
              Nova ordem
            </button>
          )}
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
          {filteredOrders.length === 0 && <p className="muted">Nenhuma ordem encontrada neste período e filtro.</p>}
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
          onSelectOrder={(orderId) => {
            const found = orders.find((o) => o.id === orderId);
            if (found) {
              onSelectOrder(found);
              onNavigateToOrdersTab && onNavigateToOrdersTab();
            }
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
        <div className="admin-orders-layout">
          <AdminOrdersPanel
            orders={orders}
            selected={selected}
            onSelectOrder={onSelectOrder}
            onClearAllOrders={onClearAllOrders}
            executorTab={executorTab}
            onExecutorTabChange={onExecutorTabChange}
            counts={counts}
            initialStatusFilter={initialStatusFilter}
          />
          <OrderDetails
            session={session}
            selected={selected}
            feedback={feedback}
            setFeedback={setFeedback}
            signatureName={signatureName}
            setSignatureName={setSignatureName}
            onSubmit={onSubmitOrder}
            onSign={onSignOrder}
            onCorrection={onCorrection}
            onIncorrectSignature={onIncorrectSignature}
            onOrderAction={onOrderAction}
            onEdit={onEditOrder}
            allowEdit={false}
          />
        </div>
      )}
    </section>
  );
}

function AdminOrdersPanel({
  orders,
  selected,
  onSelectOrder,
  onClearAllOrders,
  executorTab = "suporte",
  onExecutorTabChange,
  counts,
  initialStatusFilter = "total"
}) {
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [appliedCustomDates, setAppliedCustomDates] = useState({ start: startDate, end: endDate });
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "total");
  const [orderSearch, setOrderSearch] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const normalizedSearch = orderSearch.trim().toLowerCase();

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

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

  const countsByStatus = periodFilteredOrders.reduce(
    (acc, order) => {
      acc.total += 1;
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      if (order.status !== "divergent" && Number(order.incorrect_signatures) > 0) {
        acc.divergent = (acc.divergent ?? 0) + 1;
      }
      return acc;
    },
    {
      total: 0, draft: 0, pending_signature: 0, correction_requested: 0, divergent: 0, signed: 0, cancelled: 0,
      awaiting_stock_check: 0, stock_checking: 0, stock_picking: 0, stock_returned: 0
    }
  );

  const statusFilteredOrders = statusFilter === "total"
    ? periodFilteredOrders
    : statusFilter === "divergent"
      ? periodFilteredOrders.filter((order) => order.status === "divergent" || Number(order.incorrect_signatures) > 0)
      : statusFilter === "awaiting_stock_check"
        ? periodFilteredOrders.filter((order) => ["awaiting_stock_check", "stock_checking"].includes(order.status))
        : periodFilteredOrders.filter((order) => order.status === statusFilter);

  const filteredOrders = normalizedSearch
    ? statusFilteredOrders.filter((order) => orderMatchesSearch(order, normalizedSearch))
    : statusFilteredOrders;

  return (
    <section className="panel admin-orders-panel">
      <div className="panel-title">
        <ClipboardList size={18} />
        <h3>Ordens de servicos</h3>
      </div>

      <div className="orders-executor-tabs" role="tablist" aria-label="Equipe executora">
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

      <PeriodFilterControl
        period={period}
        onPeriodChange={setPeriod}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        onApplyCustom={() => setAppliedCustomDates({ start: startDate, end: endDate })}
      />

      <div className="status-summary">
        <button className={statusFilter === "total" ? "active" : ""} onClick={() => setStatusFilter("total")}>
          <strong>{countsByStatus.total}</strong><span>Todas</span>
        </button>
        <button className={statusFilter === "draft" ? "active" : ""} onClick={() => setStatusFilter("draft")}>
          <strong>{countsByStatus.draft}</strong><span>Rascunhos</span>
        </button>
        <button className={statusFilter === "awaiting_stock_check" ? "active" : ""} onClick={() => setStatusFilter("awaiting_stock_check")}>
          <strong>{countsByStatus.awaiting_stock_check + countsByStatus.stock_checking}</strong><span>Conferência estoque</span>
        </button>
        <button className={statusFilter === "stock_picking" ? "active" : ""} onClick={() => setStatusFilter("stock_picking")}>
          <strong>{countsByStatus.stock_picking}</strong><span>Em separação</span>
        </button>
        <button className={statusFilter === "stock_returned" ? "active" : ""} onClick={() => setStatusFilter("stock_returned")}>
          <strong>{countsByStatus.stock_returned}</strong><span>Retorno do estoque</span>
        </button>
        <button className={statusFilter === "pending_signature" ? "active" : ""} onClick={() => setStatusFilter("pending_signature")}>
          <strong>{countsByStatus.pending_signature}</strong><span>Pendente Validação</span>
        </button>
        <button className={statusFilter === "correction_requested" ? "active" : ""} onClick={() => setStatusFilter("correction_requested")}>
          <strong>{countsByStatus.correction_requested}</strong><span>Aguardando correção</span>
        </button>
        <button className={statusFilter === "signed" ? "active" : ""} onClick={() => setStatusFilter("signed")}>
          <strong>{countsByStatus.signed}</strong><span>Aprovadas</span>
        </button>
        <button className={statusFilter === "divergent" ? "active" : ""} onClick={() => setStatusFilter("divergent")}>
          <strong>{countsByStatus.divergent}</strong><span>Divergências</span>
        </button>
      </div>

      <div className="search-field orders-search">
        <Search size={17} />
        <input
          placeholder="Pesquisar por OS, tipo, modelo, cliente ou solicitante"
          value={orderSearch}
          onChange={(event) => setOrderSearch(event.target.value)}
        />
      </div>

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
                  Todos os itens associados, assinaturas, divergências e registros de auditoria serão removidos. A sequência anual de OS será reiniciada a partir do #0001.
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

      <div className="admin-order-list">
        {filteredOrders.map((order) => (
          <button
            className={`admin-order-row ${selected?.id === order.id ? "active" : ""}`}
            key={order.id}
            onClick={() => onSelectOrder(order)}
          >
            <span>
              <strong>{order.code}</strong>
              <span className={`badge-executor-team ${order.executor_team === "producao" ? "producao" : order.executor_team === "suporte" ? "suporte" : "unassigned"}`}>
                {order.executor_team === "producao" ? "Produção" : order.executor_team === "suporte" ? "Suporte" : "Sem equipe"}
              </span>
              <small>{orderSummary(order)} | {order.authorized_person_name}</small>
              {Number(order.incorrect_signatures) > 0 && (
                <span className="badge-incorrect-attempt" title={`${order.incorrect_signatures} tentativa(s) incorreta(s)`}>
                  ⚠️ {order.incorrect_signatures} {Number(order.incorrect_signatures) === 1 ? "tentativa incorreta" : "tentativas incorretas"}
                </span>
              )}
            </span>
            <span>
              <em>{statusLabels[order.status]}</em>
              <small>{orderValidationHint(order)}</small>
            </span>
          </button>
        ))}
        {filteredOrders.length === 0 && <p className="muted">Nenhuma ordem encontrada neste filtro.</p>}
      </div>
    </section>
  );
}

function OrderRow({ order, active, onClick }) {
  const Icon = statusIcons[order.status] ?? FileSignature;

  return (
    <button className={`order-row ${active ? "active" : ""}`} onClick={onClick}>
      <span className={`status-dot ${order.status}`}><Icon size={15} /></span>
      <span>
        <strong>{order.code}</strong>
        <span className={`badge-executor-team ${order.executor_team === "producao" ? "producao" : order.executor_team === "suporte" ? "suporte" : "unassigned"}`}>
          {order.executor_team === "producao" ? "Produção" : order.executor_team === "suporte" ? "Suporte" : "Sem equipe"}
        </span>
        <small>{typeLabel(order.order_type)} | {orderSummary(order)} | {order.authorized_person_name}</small>
        {Number(order.incorrect_signatures) > 0 && (
          <span className="badge-incorrect-attempt" title={`${order.incorrect_signatures} tentativa(s) incorreta(s)`}>
            ⚠️ {order.incorrect_signatures} {Number(order.incorrect_signatures) === 1 ? "tentativa incorreta" : "tentativas incorretas"}
          </span>
        )}
      </span>
      <em>{statusLabels[order.status]} ({order.signature_count ?? 0}/2)</em>
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
        <form className="catalog-form" onSubmit={(event) => onCreateCatalogItem("part-numbers", event)}>
          <select
            value={newPartNumberItem?.modelName || (catalog.terminalModels[0]?.name ?? "")}
            onChange={(e) => updatePartNumber("modelName", e.target.value)}
            style={{ minWidth: "120px" }}
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
        <div className="catalog-list">
          {(catalog.partNumbers ?? []).map((pn) => (
            <span key={pn.id}><strong>{pn.model_name || pn.terminal_model_name}</strong>: {pn.part_number}</span>
          ))}
        </div>
      </section>
    </section>
  );
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
        <p className="muted">Marque o que está sendo enviado junto. Os itens com * foram pedidos na OS.</p>
        {items.map((item, index) => (
          <div className="stock-accessories-line" key={item.id}>
            <strong>Item {index + 1}: {item.terminal_model}</strong>
            <div className="stock-accessories-options">
              {stockAccessoryOptions.map((option) => {
                const checked = (accessories[item.id] ?? []).includes(option.key);
                const requested = option.requestedBy(item);
                return (
                  <label
                    key={option.key}
                    className={`stock-accessory-chip ${checked ? "checked" : ""} ${requested && !checked ? "missing" : ""}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleAccessory(item.id, option.key)} />
                    <span>{option.label}{requested ? " *" : ""}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
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

function StockReturnDecisionPanel({ onAction, onEdit }) {
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
        <button type="button" className="ghost" onClick={onEdit}>
          <Edit3 size={16} />
          Editar OS
        </button>
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
        <p className="muted">O detalhe mostra dados, assinaturas e historico da autorizacao.</p>
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
  const canEdit = allowEdit && ["admin", "requester"].includes(session.user.role) && ["draft", "correction_requested", "stock_returned"].includes(selected.status);
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
        <div>
          <p className="eyebrow">{selected.code}</p>
          <h2>{orderSummary(selected)}</h2>
          <p className="muted">{statusLabels[selected.status]} | {signatures.length}/2 assinaturas</p>
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
              <strong>⚠️ Assinatura incorreta — {selected.incorrect_signatures} {Number(selected.incorrect_signatures) === 1 ? "tentativa" : "tentativas"}</strong>
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
        <div><dt>Data Solicitacao</dt><dd>{formatDate(selected.valid_from)}</dd></div>
        {session.user.role !== "requester" && (
          <div><dt>Destinatario</dt><dd>{destinationLabel(selected.destination_role)}</dd></div>
        )}
        <div><dt>Prazo Assinatura</dt><dd>{formatDateTime(selected.signature_due_at)}</dd></div>
        <div><dt>Aprovacao</dt><dd>{signatures.length >= 2 ? "Completa" : `${signatures.length}/2 assinaturas`}</dd></div>
      </dl>

      <section>
        <h3>Itens</h3>
        <div className="items-table">
          <div className={`items-table-head ${isSpectator ? "spectator" : ""}`}>
            <span>Modelo</span>
            <span>PN</span>
            <span>Cliente</span>
            <span>Nota</span>
            <span>Quantia</span>
            {!isSpectator && <span>Configuracao</span>}
          </div>
          {items.map((item, idx) => (
            <div className="item-detail-card" key={item.id || idx}>
              <div className={`items-table-row ${isSpectator ? "spectator" : ""}`}>
                <span>{item.terminal_model}</span>
                <span>{item.part_number}</span>
                <span>{item.client_name}</span>
                <span>{item.item_name || "—"}</span>
                <span>
                  {item.quantity}
                  {item.stock_checked_quantity != null && (
                    <small className={`stock-checked-qty ${item.stock_checked_quantity < item.quantity ? "short" : "ok"}`}>
                      {" "}conferido {item.stock_checked_quantity}
                    </small>
                  )}
                </span>
                {!isSpectator && <span>{item.configuration}</span>}
              </div>
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
          <button className="primary" onClick={onSubmit}>
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
        <StockReturnDecisionPanel key={selected.id} onAction={onOrderAction} onEdit={() => onEdit(selected)} />
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
                  onSign(keyCount);
                  setValidationDecision(null);
                  setKeyCount("");
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
              <button
                className="danger"
                type="button"
                disabled={!correctionMsg.trim()}
                onClick={() => {
                  onCorrection(correctionMsg);
                  setValidationDecision(null);
                  setCorrectionMsg("");
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
        <h3>Assinaturas registradas</h3>
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
        <h3>Historico</h3>
        <div className="timeline">
          {selected.events?.map((event) => {
            const actorName = event.actor_name || "Sistema";

            return (
              <article key={event.id}>
                <span />
                <div>
                  <strong>{event.event_type}</strong>
                  <p>{event.message}</p>
                  <small>{actorName} | {formatDateTime(event.created_at)}</small>
                </div>
              </article>
            );
          })}
        </div>
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

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

function today() {
  return new Date();
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
    return "Divergência apontada";
  }

  if (order.status === "draft") {
    return "Ainda nao enviada";
  }

  return "Sem pendencia ativa";
}

function formatPeriodRange(period, customStart, customEnd) {
  const now = new Date();
  let start;
  let end;

  if (period === "all" || !period) return "Todas as datas";
  if (period === "today") {
    start = now;
    end = now;
  } else if (period === "7d") {
    start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    end = now;
  } else if (period === "30d") {
    start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    end = now;
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = now;
  } else if (period === "custom") {
    if (customStart && customEnd) {
      const s = customStart.split("-").reverse().join("/");
      const e = customEnd.split("-").reverse().join("/");
      return `${s} até ${e}`;
    }
    return "Personalizado";
  }

  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return `${fmt(start)} até ${fmt(end)}`;
}

function orderMatchesPeriod(order, period, startDate, endDate) {
  if (period === "all" || !period) return true;

  const rawDate = order.created_at || order.valid_from;
  if (!rawDate) return true;
  const orderDate = new Date(rawDate);
  if (isNaN(orderDate.getTime())) return true;

  const now = new Date();
  let start;
  let end;

  if (period === "today") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === "7d") {
    start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === "30d") {
    start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === "custom") {
    if (startDate) {
      start = new Date(`${startDate}T00:00:00`);
    } else {
      start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    }
    if (endDate) {
      end = new Date(`${endDate}T23:59:59.999`);
    } else {
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (start.getTime() > end.getTime()) {
      const temp = start;
      start = end;
      end = temp;
    }
  } else {
    return true;
  }

  const time = orderDate.getTime();
  return time >= start.getTime() && time <= end.getTime();
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
  link.download = `ordens-servico-${scope}-${new Date().toISOString().slice(0, 10)}.xls`;
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

function orderSummary(order) {
  if (!order) return "-";

  if (order.items?.length) {
    const models = [...new Set(order.items.map((item) => item.terminal_model || item.itemIdentifier || item.item_identifier).filter(Boolean))].join(", ");
    const pns = [...new Set(order.items.map((item) => item.part_number || item.partNumber).filter(Boolean).filter((pn) => pn !== "-"))].join(", ");
    const clients = [...new Set(order.items.map((item) => item.client_name || item.clientName).filter(Boolean).filter((c) => c !== "-"))].join(", ");
    const quantity = order.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

    return `${models || "-"}${pns ? ` | PN ${pns}` : ""}${clients ? ` | ${clients}` : ""}${quantity > 0 ? ` | Qtd ${quantity}` : ""}`;
  }

  const models = order.terminal_models || order.item_identifier || "-";
  const pns = order.part_numbers && order.part_numbers !== "-" ? ` | PN ${order.part_numbers}` : "";
  const clients = order.client_names && order.client_names !== "-" ? ` | ${order.client_names}` : "";
  const quantity = order.total_quantity ? ` | Qtd ${order.total_quantity}` : "";

  return `${models}${pns}${clients}${quantity}`;
}

function formatDate(value) {
  if (!value) return "-";
  if (typeof value === "string") {
    const trimmed = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-");
      return `${day}/${month}/${year}`;
    }
  }
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
