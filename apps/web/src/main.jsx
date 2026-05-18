import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Edit3,
  FileSignature,
  History,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  UserPlus,
  XCircle
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

const statusLabels = {
  draft: "Rascunho",
  pending_signature: "Aguardando assinaturas",
  correction_requested: "Correcao solicitada",
  signed: "Aprovada",
  cancelled: "Cancelada"
};

const statusIcons = {
  draft: Edit3,
  pending_signature: Clock3,
  correction_requested: RefreshCw,
  signed: CheckCircle2,
  cancelled: XCircle
};

const orderTypeOptions = [
  { value: "Reparo", label: "Reparo" },
  { value: "Atualizacao", label: "Atualiza\u00e7\u00e3o" },
  { value: "Teste", label: "Teste" }
];

const defaultCatalog = {
  orderTypes: orderTypeOptions.map((option) => ({ id: option.value, name: option.value })),
  terminalModels: ["D195", "S920", "Q92x", "A910", "P2"].map((name) => ({ id: name, name }))
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

const emptyOrder = createEmptyOrder();

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

function createEmptyOrder() {
  return {
    orderType: "Reparo",
    authorizedPersonName: "",
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

function Login({ onLogin }) {
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
      <section className="login-panel">
        <div>
          <p className="eyebrow">Controle de autorizacoes</p>
          <h1>Ordens de Servico Digitais</h1>
          <p className="muted">Crie, acompanhe, devolva para correcao e assine ordens com trilha de auditoria.</p>
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
  const [session, setSession] = useState(() => {
    const stored = localStorage.getItem("ordens:session");
    return stored ? JSON.parse(stored) : null;
  });
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(defaultCatalog);
  const [form, setForm] = useState(emptyOrder);
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "requester" });
  const [newCatalogItem, setNewCatalogItem] = useState({ orderType: "", terminalModel: "" });
  const [message, setMessage] = useState("");
  const [adminMenu, setAdminMenu] = useState("orders");

  const api = useApi(session, logout);

  function logout() {
    localStorage.removeItem("ordens:session");
    setSession(null);
  }

  function login(data) {
    localStorage.setItem("ordens:session", JSON.stringify(data));
    setSession(data);
    setSignatureName(data.user.name);
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

    setForm(createEmptyOrder());
    setEditingId(null);
    await loadData();
    await selectOrder(saved);
    setMessage("Ordem salva.");
  }

  async function runOrderAction(path, body) {
    setMessage("");
    await api.request(path, {
      method: "POST",
      body: JSON.stringify(body ?? {})
    });
    await loadData();
    if (selected) {
      setSelected(await api.request(`/orders/${selected.id}`));
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
    return <Login onLogin={login} />;
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
        <button className="ghost" onClick={loadData}>
          <RefreshCw size={18} />
          Atualizar
        </button>
        {isAdmin && (
          <nav className="sidebar-menu" aria-label="Menus do admin">
            <button className={adminMenu === "orders" ? "active" : ""} onClick={() => setAdminMenu("orders")}>
              <ClipboardList size={18} />
              Ordens de servicos
            </button>
            <button className={adminMenu === "users" ? "active" : ""} onClick={() => setAdminMenu("users")}>
              <Users size={18} />
              Usuarios
            </button>
            <button className={adminMenu === "items" ? "active" : ""} onClick={() => setAdminMenu("items")}>
              <Plus size={18} />
              Inclusao de item
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
          {message && <span className="toast">{message}</span>}
        </header>

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
            onSignOrder={() => runOrderAction(`/orders/${selected.id}/sign`, { signerName: signatureName })}
            onCorrection={() => {
              runOrderAction(`/orders/${selected.id}/request-correction`, { message: feedback });
              setFeedback("");
            }}
            onEditOrder={startEdit}
            session={session}
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
                    setForm(createEmptyOrder());
                  }}
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
              onSign={() => runOrderAction(`/orders/${selected.id}/sign`, { signerName: signatureName })}
              onCorrection={() => {
                runOrderAction(`/orders/${selected.id}/request-correction`, { message: feedback });
                setFeedback("");
              }}
              onEdit={startEdit}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function OrderForm({ form, setForm, catalog, editingId, onSubmit, onCancel }) {
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
    setForm((current) => ({ ...current, items: [...current.items, createEmptyItem()] }));
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
          Solicitante
          <input value={form.authorizedPersonName} onChange={(event) => update("authorizedPersonName", event.target.value)} required />
        </label>
        <label>
          N OS
          <input value={form.authorizedPersonDocument} onChange={(event) => update("authorizedPersonDocument", event.target.value)} required />
        </label>
        <label>
          Data Solicitacao
          <input type="date" value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)} required />
        </label>
        <label>
          Destinatario
          <select value={form.destinationRole} onChange={(event) => update("destinationRole", event.target.value)} required>
            {destinationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="auto-field">
        <span>Prazo Assinatura</span>
        <strong>{editingId && form.signatureDueAt ? formatDateTime(form.signatureDueAt) : formatDate(tomorrow())}</strong>
      </div>
      <section className="order-items-editor">
        <div className="panel-title">
          <FileSignature size={18} />
          <h3>Itens da OS</h3>
        </div>
        {form.items.map((item, index) => (
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
                <select value={item.itemIdentifier} onChange={(event) => updateItem(index, "itemIdentifier", event.target.value)} required>
                  {catalog.terminalModels.map((model) => (
                    <option key={model.id} value={model.name}>{model.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Part Number
                <input value={item.partNumber} onChange={(event) => updateItem(index, "partNumber", event.target.value)} required />
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
        ))}
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
  const counts = orders.reduce(
    (acc, order) => {
      acc.total += 1;
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      return acc;
    },
    { total: 0, draft: 0, pending_signature: 0, correction_requested: 0, signed: 0, cancelled: 0 }
  );
  const filteredOrders = statusFilter === "total"
    ? orders
    : orders.filter((order) => order.status === statusFilter);

  return (
    <section className="panel admin-orders-panel">
      <div className="panel-title">
        <ClipboardList size={18} />
        <h3>Ordens de servicos</h3>
      </div>

      <div className="status-summary">
        <button className={statusFilter === "total" ? "active" : ""} onClick={() => setStatusFilter("total")}>
          <strong>{counts.total}</strong><span>Total</span>
        </button>
        <button className={statusFilter === "pending_signature" ? "active" : ""} onClick={() => setStatusFilter("pending_signature")}>
          <strong>{counts.pending_signature}</strong><span>Aguardando</span>
        </button>
        <button className={statusFilter === "correction_requested" ? "active" : ""} onClick={() => setStatusFilter("correction_requested")}>
          <strong>{counts.correction_requested}</strong><span>Correcao</span>
        </button>
        <button className={statusFilter === "signed" ? "active" : ""} onClick={() => setStatusFilter("signed")}>
          <strong>{counts.signed}</strong><span>Aprovadas</span>
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

function AdminItemsPanel({ catalog, newCatalogItem, setNewCatalogItem, onCreateCatalogItem }) {
  function update(field, value) {
    setNewCatalogItem((current) => ({ ...current, [field]: value }));
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

      <dl className="info-grid">
        <div><dt>Tipo da ordem</dt><dd>{typeLabel(selected.order_type)}</dd></div>
        <div><dt>Modelos</dt><dd>{items.map((item) => item.terminal_model).join(", ")}</dd></div>
        <div><dt>Part Numbers</dt><dd>{items.map((item) => item.part_number).join(", ")}</dd></div>
        <div><dt>Clientes</dt><dd>{items.map((item) => item.client_name).join(", ")}</dd></div>
        <div><dt>Quantia total</dt><dd>{items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)}</dd></div>
        <div><dt>Solicitante</dt><dd>{selected.authorized_person_name}</dd></div>
        <div><dt>Nº OS</dt><dd>{selected.authorized_person_document}</dd></div>
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
        <div className="feedback-box">
          <label>
            Nome de quem assinou
            <input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} />
          </label>
          <button className="success" onClick={onSign} disabled={signatureName.trim().length < 2}>
            <CheckCircle2 size={18} />
            Assinar
          </button>
          <textarea
            placeholder="Descreva o que precisa ser corrigido"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
          <button className="danger" onClick={onCorrection}>
            <RefreshCw size={18} />
            Pedir correcao
          </button>
        </div>
      )}

      <section className="signature-list">
        <h3>Assinaturas registradas</h3>
        {signatures.length === 0 && <p className="muted">Nenhuma assinatura registrada.</p>}
        {signatures.map((signature) => (
          <article className="signature-box" key={signature.id}>
            <ShieldCheck size={20} />
            <div>
              <strong>{signature.display_signer_name ?? signature.user_name}</strong>
              <span>{formatDateTime(signature.signed_at)}</span>
              <small>{signature.signature_hash}</small>
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

  if (order.status === "draft") {
    return "Ainda nao enviada";
  }

  return "Sem pendencia ativa";
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
