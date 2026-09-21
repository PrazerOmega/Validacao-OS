import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Edit3,
  FileSignature,
  History,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  UserPlus,
  XCircle
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

const statusLabels = {
  draft: "Rascunho",
  pending_signature: "Aguardando validação",
  correction_requested: "Aguardando correção",
  divergent: "Divergente",
  signed: "Aprovada",
  cancelled: "Cancelada"
};

const statusIcons = {
  draft: Edit3,
  pending_signature: Clock3,
  correction_requested: RefreshCw,
  divergent: AlertTriangle,
  signed: CheckCircle2,
  cancelled: XCircle
};

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
  { value: "spectator", label: "Espectador" },
  { value: "admin", label: "Admin" }
];

const destinationOptions = [
  { value: "signer", label: "Suporte" }
];

function createEmptyItem() {
  return {
    itemName: "",
    itemIdentifier: "D195",
    partNumber: "",
    clientName: "",
    quantity: 1,
    configuration: ""
  };
}

function createEmptyOrder(userName = "") {
  return {
    orderType: "Reparo",
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
  const [adminMenu, setAdminMenu] = useState("orders");
  const [userMenu, setUserMenu] = useState("create");

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
    setSignatureName(data.user.name);
    setForm(createEmptyOrder(data.user.name));
  }

  async function loadData() {
    if (!session) return;

    const [orderList, catalogList] = await Promise.all([
      api.request("/orders"),
      api.request("/catalog")
    ]);
    setOrders(orderList);
    setCatalog(catalogList);

    if (session.user.role === "admin") {
      setUsers(await api.request("/users"));
    }
  }

  useEffect(() => {
    if (session && !signatureName) {
      setSignatureName(session.user.name);
    }
    loadData().catch((err) => setMessage(err.message));
  }, [session]);

  async function selectOrder(order) {
    setSelected(await api.request(`/orders/${order.id}`));
  }

  function startEdit(order) {
    setEditingId(order.id);
    setForm({
      orderType: order.order_type ?? "Reparo",
      authorizedPersonName: order.authorized_person_name,
      authorizedPersonDocument: order.authorized_person_document,
      validFrom: order.valid_from?.slice(0, 10),
      validUntil: order.valid_until?.slice(0, 10),
      signatureDueAt: order.signature_due_at,
      destinationRole: order.destination_role ?? "signer",
      items: order.items?.length
        ? order.items.map((item) => ({
          itemName: item.item_name,
          itemIdentifier: item.terminal_model,
          partNumber: item.part_number,
          clientName: item.client_name,
          quantity: item.quantity,
          configuration: item.configuration
        }))
        : [{
          itemName: order.item_name,
          itemIdentifier: order.item_identifier,
          partNumber: "-",
          clientName: "-",
          quantity: 1,
          configuration: order.usage_reason
        }]
    });
  }

  async function saveOrder(event) {
    event.preventDefault();
    setMessage("");
    const method = editingId ? "PUT" : "POST";
    const path = editingId ? `/orders/${editingId}` : "/orders";
    const saved = await api.request(path, {
      method,
      body: JSON.stringify({
        ...form,
        validUntil: form.validUntil || null
      })
    });

    setForm(createEmptyOrder(session?.user?.name ?? ""));
    setEditingId(null);
    await loadData();
    await selectOrder(saved);
    setMessage("Ordem salva.");
  }

  async function runOrderAction(path, body) {
    setMessage("");
    try {
      const result = await api.request(path, {
        method: "POST",
        body: JSON.stringify(body ?? {})
      });
      if (result?.divergent) {
        setNotification({
          type: "warning",
          title: "Divergência identificada",
          message: result.message || "A contagem informada diverge da validação anterior. A ordem foi encaminhada para a lista de divergências."
        });
      } else {
        setNotification(null);
      }
      await loadData();
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
    await api.request("/users", {
      method: "POST",
      body: JSON.stringify(newUser)
    });
    setNewUser({ name: "", email: "", password: "", role: "requester" });
    setUsers(await api.request("/users"));
  }

  async function updateUser(userId, changes) {
    await api.request(`/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    setUsers(await api.request("/users"));
  }

  async function removeUser(userId) {
    await api.request(`/users/${userId}`, { method: "DELETE" });
    setUsers(await api.request("/users"));
  }

  async function createCatalogItem(kind, event) {
    event.preventDefault();
    if (kind === "part-numbers") {
      const { modelName, partNumber } = newPartNumberItem;
      if (!modelName || !partNumber.trim()) return;

      await api.request("/catalog/part-numbers", {
        method: "POST",
        body: JSON.stringify({ modelName, partNumber: partNumber.trim() })
      });

      setNewPartNumberItem((current) => ({ ...current, partNumber: "" }));
      setCatalog(await api.request("/catalog"));
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
        {isAdmin && (
          <nav className="sidebar-menu" aria-label="Menus do admin">
            <button className={adminMenu === "orders" ? "active" : ""} onClick={() => setAdminMenu("orders")}>
              <ClipboardList size={18} />
              Ordens
            </button>
            <button className={adminMenu === "users" ? "active" : ""} onClick={() => setAdminMenu("users")}>
              <Users size={18} />
              Usuários
            </button>
            <button className={adminMenu === "items" ? "active" : ""} onClick={() => setAdminMenu("items")}>
              <Plus size={18} />
              Itens
            </button>
          </nav>
        )}
        {!isAdmin && (
          <nav className="sidebar-menu" aria-label="Menus do usuario">
            <button className={userMenu === "orders" ? "active" : ""} onClick={() => setUserMenu("orders")}>
              <ClipboardList size={18} />
              Ordens de servico
            </button>
          </nav>
        )}
        <button className="ghost" onClick={logout}>
          <LogOut size={18} />
          Sair
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{isAdmin ? "Admin" : "Historico de ordens"}</h1>
            <p className="muted">
              {isAdmin ? "Gerencie usuarios e acompanhe todas as ordens de servico." : "A aprovacao exige duas assinaturas registradas."}
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
            onEditOrder={startEdit}
            session={session}
          />
        ) : userMenu === "orders" || !canCreate ? (
          <UserOrdersPanel
            orders={orders}
            selected={selected}
            session={session}
            feedback={feedback}
            setFeedback={setFeedback}
            signatureName={signatureName}
            setSignatureName={setSignatureName}
            onSelectOrder={selectOrder}
            onNewOrder={() => setUserMenu("create")}
            onSubmit={() => runOrderAction(`/orders/${selected.id}/submit`)}
            onSign={(keyCount) => runOrderAction(`/orders/${selected.id}/sign`, { keyCount: Number(keyCount) })}
            onCorrection={(msg) => runOrderAction(`/orders/${selected.id}/request-correction`, { message: msg })}
            onEdit={startEdit}
          />
        ) : (
          <div className="content-grid">
            <section className="orders-column">
              {canCreate && (
                <OrderForm
                  form={form}
                  setForm={setForm}
                  catalog={catalog}
                  editingId={editingId}
                  onSubmit={saveOrder}
                  onCancel={() => {
                    setEditingId(null);
                    setForm(createEmptyOrder(session?.user?.name ?? ""));
                  }}
                  session={session}
                  api={api}
                />
              )}

              <div className="list-header">
                <h3>Ordens</h3>
                <span>{orders.length}</span>
              </div>
              <div className="order-list">
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    active={selected?.id === order.id}
                    onClick={() => selectOrder(order)}
                  />
                ))}
              </div>
            </section>

            <OrderDetails
              session={session}
              selected={selected}
              feedback={feedback}
              setFeedback={setFeedback}
              signatureName={signatureName}
              setSignatureName={setSignatureName}
              onSubmit={() => runOrderAction(`/orders/${selected.id}/submit`)}
              onSign={(keyCount) => runOrderAction(`/orders/${selected.id}/sign`, { keyCount: Number(keyCount) })}
              onCorrection={(msg) => runOrderAction(`/orders/${selected.id}/request-correction`, { message: msg })}
              onEdit={startEdit}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function OrderForm({ form, setForm, catalog, editingId, onSubmit, onCancel, session, api }) {
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
          const allowed = catalog.partNumbers.filter((pn) => (pn.model_name || pn.terminal_model_name) === item.itemIdentifier);
          const hasValid = allowed.some((pn) => pn.part_number === item.partNumber);
          if (!hasValid && allowed.length > 0) {
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
          clientName: "",
          quantity: 1,
          configuration: ""
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
        <div className="auto-field">
          <span>Destinatario</span>
          <strong>Suporte</strong>
        </div>
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
                  <input value={item.itemName} onChange={(event) => updateItem(index, "itemName", event.target.value)} required />
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
                          i === index ? { ...it, itemIdentifier: newModel, partNumber: defaultPn } : it
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
                  {allowedPns.length > 0 ? (
                    <select
                      value={item.partNumber}
                      onChange={(event) => updateItem(index, "partNumber", event.target.value)}
                      required
                    >
                      <option value="" disabled>Selecione o Part Number</option>
                      {allowedPns.map((pn) => (
                        <option key={pn.id} value={pn.part_number}>
                          {pn.part_number}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="no-pn-warning">
                      Nenhum Part Number cadastrado para este modelo.
                    </div>
                  )}
                </label>
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
      </div>
    </form>
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
  onEdit
}) {
  const [filter, setFilter] = useState("sem_assinatura");
  const filteredOrders = orders.filter((order) => userOrderMatchesFilter(order, filter));
  const filterOptions = [
    { value: "sem_assinatura", label: "SEM ASSINATURA" },
    { value: "aguardando_1", label: "AGUARDANDO 1 ASSINATURA" },
    { value: "signed", label: "ASSINADAS" },
    { value: "recertificar", label: "RESERTIFICAR" },
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
          {filteredOrders.length === 0 && <p className="muted">Nenhuma ordem encontrada neste filtro.</p>}
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
  onEditOrder,
  session
}) {
  return (
    <section className="admin-console">
      {activeMenu === "users" ? (
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
          <AdminOrdersPanel orders={orders} selected={selected} onSelectOrder={onSelectOrder} />
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
            onEdit={onEditOrder}
            allowEdit={false}
          />
        </div>
      )}
    </section>
  );
}

function AdminOrdersPanel({ orders, selected, onSelectOrder }) {
  const [statusFilter, setStatusFilter] = useState("total");
  const [orderSearch, setOrderSearch] = useState("");
  const normalizedSearch = orderSearch.trim().toLowerCase();
  const counts = orders.reduce(
    (acc, order) => {
      acc.total += 1;
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      return acc;
    },
    { total: 0, draft: 0, pending_signature: 0, correction_requested: 0, divergent: 0, signed: 0, cancelled: 0 }
  );
  const statusFilteredOrders = statusFilter === "total"
    ? orders
    : orders.filter((order) => order.status === statusFilter);
  const filteredOrders = normalizedSearch
    ? statusFilteredOrders.filter((order) => orderMatchesSearch(order, normalizedSearch))
    : statusFilteredOrders;

  return (
    <section className="panel admin-orders-panel">
      <div className="panel-title">
        <ClipboardList size={18} />
        <h3>Ordens de servicos</h3>
      </div>

      <div className="status-summary">
        <button className={statusFilter === "total" ? "active" : ""} onClick={() => setStatusFilter("total")}>
          <strong>{counts.total}</strong><span>Todas</span>
        </button>
        <button className={statusFilter === "pending_signature" ? "active" : ""} onClick={() => setStatusFilter("pending_signature")}>
          <strong>{counts.pending_signature}</strong><span>Aguardando validação</span>
        </button>
        <button className={statusFilter === "correction_requested" ? "active" : ""} onClick={() => setStatusFilter("correction_requested")}>
          <strong>{counts.correction_requested}</strong><span>Aguardando correção</span>
        </button>
        <button className={statusFilter === "signed" ? "active" : ""} onClick={() => setStatusFilter("signed")}>
          <strong>{counts.signed}</strong><span>Aprovadas</span>
        </button>
        <button className={statusFilter === "divergent" ? "active" : ""} onClick={() => setStatusFilter("divergent")}>
          <strong>{counts.divergent}</strong><span>Divergências</span>
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

      <div className="admin-order-list">
        {filteredOrders.map((order) => (
          <button
            className={`admin-order-row ${selected?.id === order.id ? "active" : ""}`}
            key={order.id}
            onClick={() => onSelectOrder(order)}
          >
            <span>
              <strong>{order.code}</strong>
              <small>{orderSummary(order)} | {order.authorized_person_name}</small>
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
        <small>{typeLabel(order.order_type)} | {orderSummary(order)} | {order.authorized_person_name}</small>
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
  const canEdit = allowEdit && ["admin", "requester"].includes(session.user.role) && ["draft", "correction_requested"].includes(selected.status);
  const canSubmit = canEdit;
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
          <button className="ghost icon-button" onClick={() => onEdit(selected)} title="Editar">
            <Edit3 size={18} />
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
        <div><dt>Modelos</dt><dd>{items.map((item) => item.terminal_model).join(", ")}</dd></div>
        <div><dt>Part Numbers</dt><dd>{items.map((item) => item.part_number).join(", ")}</dd></div>
        <div><dt>Clientes</dt><dd>{items.map((item) => item.client_name).join(", ")}</dd></div>
        <div><dt>Quantia total</dt><dd>{items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)}</dd></div>
        <div><dt>Criada por</dt><dd>{selected.requester_name}</dd></div>
        <div><dt>Data Solicitacao</dt><dd>{formatDate(selected.valid_from)}</dd></div>
        <div><dt>Destinatario</dt><dd>{destinationLabel(selected.destination_role)}</dd></div>
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
          {items.map((item) => (
            <div className={`items-table-row ${isSpectator ? "spectator" : ""}`} key={item.id}>
              <span>{item.terminal_model}</span>
              <span>{item.part_number}</span>
              <span>{item.client_name}</span>
              <span>{item.item_name}</span>
              <span>{item.quantity}</span>
              {!isSpectator && <span>{item.configuration}</span>}
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
        {signatures.map((signature) => (
          <article className="signature-box" key={signature.id}>
            <ShieldCheck size={20} />
            <div>
              <strong>{signature.display_signer_name ?? signature.user_name}</strong>
              {signature.key_count != null && <span> | {signature.key_count} chave(s)</span>}
              <span>{formatDateTime(signature.signed_at)}</span>
            </div>
          </article>
        ))}
      </section>

      <section>
        <h3>Historico</h3>
        <div className="timeline">
          {selected.events?.map((event) => (
            <article key={event.id}>
              <span />
              <div>
                <strong>{event.event_type}</strong>
                <p>{event.message}</p>
                <small>{event.actor_name} | {formatDateTime(event.created_at)}</small>
              </div>
            </article>
          ))}
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
    return `Faltam ${Math.max(2 - signatures, 0)} assinatura(s)`;
  }

  if (order.status === "correction_requested") {
    return "Aguardando correcao";
  }

  if (order.status === "divergent") {
    return "Divergência apontada";
  }

  if (order.status === "draft") {
    return "Ainda nao enviada";
  }

  return "Sem pendencia ativa";
}

function userOrderMatchesFilter(order, filter) {
  const signatureCount = Number(order.signature_count ?? 0);

  if (filter === "sem_assinatura") {
    return order.status === "pending_signature" && signatureCount === 0;
  }

  if (filter === "aguardando_1") {
    return order.status === "pending_signature" && signatureCount === 1;
  }

  if (filter === "signed") {
    return order.status === "signed";
  }

  if (filter === "recertificar") {
    return order.status === "correction_requested";
  }

  if (filter === "divergent") {
    return order.status === "divergent";
  }

  return true;
}

function orderMatchesSearch(order, search) {
  const searchableText = [
    order.code,
    order.authorized_person_document,
    order.order_type,
    typeLabel(order.order_type),
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
    "Status",
    "Modelos",
    "Part Numbers",
    "Clientes",
    "Solicitante",
    "Criada por",
    "Quantia total",
    "Assinaturas",
    "Pendencia",
    "Data solicitacao",
    "Prazo assinatura"
  ];
  const rows = ordersToExport.map((order) => [
    order.code,
    order.authorized_person_document,
    typeLabel(order.order_type),
    statusLabels[order.status] ?? order.status,
    order.terminal_models ?? order.item_identifier ?? "",
    order.part_numbers ?? "",
    order.client_names ?? "",
    order.authorized_person_name,
    order.requester_name,
    order.total_quantity ?? "",
    `${order.signature_count ?? 0}/2`,
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
  if (order.items?.length) {
    const models = [...new Set(order.items.map((item) => item.terminal_model))].join(", ");
    const pns = [...new Set(order.items.map((item) => item.part_number))].join(", ");
    const clients = [...new Set(order.items.map((item) => item.client_name))].join(", ");
    const quantity = order.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

    return `${models}${pns ? ` | PN ${pns}` : ""}${clients ? ` | ${clients}` : ""} | Qtd ${quantity}`;
  }

  const models = order.terminal_models ?? order.item_identifier ?? "-";
  const pns = order.part_numbers ? ` | PN ${order.part_numbers}` : "";
  const clients = order.client_names ? ` | ${order.client_names}` : "";
  const quantity = order.total_quantity ? ` | Qtd ${order.total_quantity}` : "";

  return `${models}${pns}${clients}${quantity}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
