import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Clock3,
  Edit3,
  FileSignature,
  History,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
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

const terminalModelOptions = ["D195", "S920", "Q92x", "A910", "P2"];

const roleOptions = [
  { value: "requester", label: "Solicitante" },
  { value: "signer", label: "Assinador" },
  { value: "admin", label: "Admin" }
];

const destinationOptions = [
  { value: "signer", label: "Assinadores" }
];

const emptyOrder = {
  orderType: "Reparo",
  itemName: "",
  itemIdentifier: "D195",
  authorizedPersonName: "",
  authorizedPersonDocument: "",
  usageReason: "",
  validFrom: "",
  validUntil: "",
  signatureDueAt: "",
  destinationRole: "signer"
};

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
  const [form, setForm] = useState(emptyOrder);
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "requester" });
  const [message, setMessage] = useState("");

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

    const orderList = await api.request("/orders");
    setOrders(orderList);

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
      itemName: order.item_name,
      itemIdentifier: order.item_identifier,
      authorizedPersonName: order.authorized_person_name,
      authorizedPersonDocument: order.authorized_person_document,
      usageReason: order.usage_reason,
      validFrom: order.valid_from?.slice(0, 10),
      validUntil: order.valid_until?.slice(0, 10),
      signatureDueAt: order.signature_due_at,
      destinationRole: order.destination_role ?? "signer"
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

    setForm(emptyOrder);
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

  if (!session) {
    return <Login onLogin={login} />;
  }

  const canCreate = ["requester", "admin"].includes(session.user.role);

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
        <button className="ghost" onClick={logout}>
          <LogOut size={18} />
          Sair
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Historico de ordens</h1>
            <p className="muted">A aprovacao exige duas assinaturas registradas.</p>
          </div>
          {message && <span className="toast">{message}</span>}
        </header>

        <div className="content-grid">
          <section className="orders-column">
            {canCreate && (
              <OrderForm
                form={form}
                setForm={setForm}
                editingId={editingId}
                onSubmit={saveOrder}
                onCancel={() => {
                  setEditingId(null);
                  setForm(emptyOrder);
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

          {session.user.role === "admin" && (
            <AdminPanel
              users={users}
              currentUserId={session.user.id}
              newUser={newUser}
              setNewUser={setNewUser}
              onSubmit={createUser}
              onUpdateUser={updateUser}
              onRemoveUser={removeUser}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function OrderForm({ form, setForm, editingId, onSubmit, onCancel }) {
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
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
            {orderTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Nota do Pedido
          <input value={form.itemName} onChange={(event) => update("itemName", event.target.value)} required />
        </label>
        <label>
          Modelo do Terminal
          <select value={form.itemIdentifier} onChange={(event) => update("itemIdentifier", event.target.value)} required>
            {terminalModelOptions.map((model) => (
              <option key={model} value={model}>{model}</option>
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
      </div>
      <div className="auto-field">
        <span>Prazo Assinatura</span>
        <strong>{editingId && form.signatureDueAt ? formatDateTime(form.signatureDueAt) : formatDate(tomorrow())}</strong>
      </div>
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
      <label>
        Configuracao
        <textarea value={form.usageReason} onChange={(event) => update("usageReason", event.target.value)} required />
      </label>
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

function OrderRow({ order, active, onClick }) {
  const Icon = statusIcons[order.status] ?? FileSignature;

  return (
    <button className={`order-row ${active ? "active" : ""}`} onClick={onClick}>
      <span className={`status-dot ${order.status}`}><Icon size={15} /></span>
      <span>
        <strong>{order.code}</strong>
        <small>{typeLabel(order.order_type)} | {order.item_name} | {order.authorized_person_name}</small>
      </span>
      <em>{statusLabels[order.status]} ({order.signature_count ?? 0}/2)</em>
    </button>
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
  onEdit
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
  const signedUserIds = signatures.map((signature) => signature.signer_id);
  const isRecipient = selected.destination_role === session.user.role;
  const hasCurrentUserSigned = signedUserIds.includes(session.user.id);
  const canEdit = ["admin", "requester"].includes(session.user.role) && ["draft", "correction_requested"].includes(selected.status);
  const canSubmit = canEdit;
  const canReview = selected.status === "pending_signature" && !hasCurrentUserSigned && isRecipient;

  return (
    <section className="panel detail-panel">
      <div className="detail-head">
        <div>
          <p className="eyebrow">{selected.code}</p>
          <h2>{selected.item_name}</h2>
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
        <div><dt>Modelo do Terminal</dt><dd>{selected.item_identifier}</dd></div>
        <div><dt>Solicitante</dt><dd>{selected.authorized_person_name}</dd></div>
        <div><dt>N OS</dt><dd>{selected.authorized_person_document}</dd></div>
        <div><dt>Criada por</dt><dd>{selected.requester_name}</dd></div>
        <div><dt>Data Solicitacao</dt><dd>{formatDate(selected.valid_from)}</dd></div>
        <div><dt>Destinatario</dt><dd>{destinationLabel(selected.destination_role)}</dd></div>
        <div><dt>Prazo Assinatura</dt><dd>{formatDateTime(selected.signature_due_at)}</dd></div>
        <div><dt>Aprovacao</dt><dd>{signatures.length >= 2 ? "Completa" : `${signatures.length}/2 assinaturas`}</dd></div>
      </dl>

      <div>
        <h3>Configuracao</h3>
        <p>{selected.usage_reason}</p>
      </div>

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
      <div className="user-list">
        {users.map((user) => (
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

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
