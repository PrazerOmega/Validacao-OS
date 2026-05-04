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
  Send,
  ShieldCheck,
  UserPlus,
  XCircle
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

const statusLabels = {
  draft: "Rascunho",
  pending_signature: "Aguardando assinatura",
  correction_requested: "Correcao solicitada",
  signed: "Assinada",
  cancelled: "Cancelada"
};

const statusIcons = {
  draft: Edit3,
  pending_signature: Clock3,
  correction_requested: RefreshCw,
  signed: CheckCircle2,
  cancelled: XCircle
};

const emptyOrder = {
  itemName: "",
  itemIdentifier: "",
  authorizedPersonName: "",
  authorizedPersonDocument: "",
  usageReason: "",
  validFrom: "",
  validUntil: "",
  signerId: ""
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
  const [signers, setSigners] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyOrder);
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState("");
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
  }

  async function loadData() {
    if (!session) return;

    const [orderList, signerList] = await Promise.all([
      api.request("/orders"),
      api.request("/users/signers")
    ]);
    setOrders(orderList);
    setSigners(signerList);

    if (session.user.role === "admin") {
      setUsers(await api.request("/users"));
    }
  }

  useEffect(() => {
    loadData().catch((err) => setMessage(err.message));
  }, [session]);

  async function selectOrder(order) {
    setSelected(await api.request(`/orders/${order.id}`));
  }

  function startEdit(order) {
    setEditingId(order.id);
    setForm({
      itemName: order.item_name,
      itemIdentifier: order.item_identifier,
      authorizedPersonName: order.authorized_person_name,
      authorizedPersonDocument: order.authorized_person_document,
      usageReason: order.usage_reason,
      validFrom: order.valid_from?.slice(0, 10),
      validUntil: order.valid_until?.slice(0, 10),
      signerId: order.signer_id ?? ""
    });
  }

  async function saveOrder(event) {
    event.preventDefault();
    setMessage("");
    const method = editingId ? "PUT" : "POST";
    const path = editingId ? `/orders/${editingId}` : "/orders";
    const saved = await api.request(path, {
      method,
      body: JSON.stringify({ ...form, signerId: form.signerId || null })
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
            <p className="muted">Acoes e assinaturas ficam registradas em cada ordem.</p>
          </div>
          {message && <span className="toast">{message}</span>}
        </header>

        <div className="content-grid">
          <section className="orders-column">
            {canCreate && (
              <OrderForm
                form={form}
                setForm={setForm}
                signers={signers}
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
            onSubmit={() => runOrderAction(`/orders/${selected.id}/submit`)}
            onSign={() => runOrderAction(`/orders/${selected.id}/sign`)}
            onCorrection={() => {
              runOrderAction(`/orders/${selected.id}/request-correction`, { message: feedback });
              setFeedback("");
            }}
            onEdit={startEdit}
          />

          {session.user.role === "admin" && (
            <AdminPanel users={users} newUser={newUser} setNewUser={setNewUser} onSubmit={createUser} />
          )}
        </div>
      </section>
    </main>
  );
}

function OrderForm({ form, setForm, signers, editingId, onSubmit, onCancel }) {
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
          Item
          <input value={form.itemName} onChange={(event) => update("itemName", event.target.value)} required />
        </label>
        <label>
          Identificador
          <input value={form.itemIdentifier} onChange={(event) => update("itemIdentifier", event.target.value)} required />
        </label>
        <label>
          Pessoa autorizada
          <input value={form.authorizedPersonName} onChange={(event) => update("authorizedPersonName", event.target.value)} required />
        </label>
        <label>
          Documento
          <input value={form.authorizedPersonDocument} onChange={(event) => update("authorizedPersonDocument", event.target.value)} required />
        </label>
        <label>
          Valida de
          <input type="date" value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)} required />
        </label>
        <label>
          Valida ate
          <input type="date" value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)} required />
        </label>
      </div>
      <label>
        Assinante
        <select value={form.signerId} onChange={(event) => update("signerId", event.target.value)}>
          <option value="">Selecionar depois</option>
          {signers.map((signer) => (
            <option key={signer.id} value={signer.id}>{signer.name}</option>
          ))}
        </select>
      </label>
      <label>
        Justificativa de uso
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
        <small>{order.item_name} · {order.authorized_person_name}</small>
      </span>
      <em>{statusLabels[order.status]}</em>
    </button>
  );
}

function OrderDetails({ session, selected, feedback, setFeedback, onSubmit, onSign, onCorrection, onEdit }) {
  if (!selected) {
    return (
      <section className="panel empty-state">
        <History size={34} />
        <h3>Selecione uma ordem</h3>
        <p className="muted">O detalhe mostra dados, assinatura e historico da autorizacao.</p>
      </section>
    );
  }

  const canEdit = ["admin", "requester"].includes(session.user.role) && ["draft", "correction_requested"].includes(selected.status);
  const canSubmit = canEdit && selected.signer_id;
  const canReview = ["admin", "signer"].includes(session.user.role) && selected.status === "pending_signature";

  return (
    <section className="panel detail-panel">
      <div className="detail-head">
        <div>
          <p className="eyebrow">{selected.code}</p>
          <h2>{selected.item_name}</h2>
          <p className="muted">{statusLabels[selected.status]}</p>
        </div>
        {canEdit && (
          <button className="ghost icon-button" onClick={() => onEdit(selected)} title="Editar">
            <Edit3 size={18} />
          </button>
        )}
      </div>

      <dl className="info-grid">
        <div><dt>Identificador</dt><dd>{selected.item_identifier}</dd></div>
        <div><dt>Pessoa autorizada</dt><dd>{selected.authorized_person_name}</dd></div>
        <div><dt>Documento</dt><dd>{selected.authorized_person_document}</dd></div>
        <div><dt>Solicitante</dt><dd>{selected.requester_name}</dd></div>
        <div><dt>Assinante</dt><dd>{selected.signer_name ?? "Nao definido"}</dd></div>
        <div><dt>Validade</dt><dd>{formatDate(selected.valid_from)} ate {formatDate(selected.valid_until)}</dd></div>
      </dl>

      <div>
        <h3>Justificativa</h3>
        <p>{selected.usage_reason}</p>
      </div>

      <div className="actions">
        {canSubmit && (
          <button className="primary" onClick={onSubmit}>
            <Send size={18} />
            Enviar
          </button>
        )}
        {canReview && (
          <button className="success" onClick={onSign}>
            <CheckCircle2 size={18} />
            Assinar
          </button>
        )}
      </div>

      {canReview && (
        <div className="feedback-box">
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

      {selected.signatures?.length > 0 && (
        <section className="signature-box">
          <ShieldCheck size={20} />
          <div>
            <strong>Assinatura digital registrada</strong>
            <small>{selected.signatures[0].signature_hash}</small>
          </div>
        </section>
      )}

      <section>
        <h3>Historico</h3>
        <div className="timeline">
          {selected.events?.map((event) => (
            <article key={event.id}>
              <span />
              <div>
                <strong>{event.event_type}</strong>
                <p>{event.message}</p>
                <small>{event.actor_name} · {formatDateTime(event.created_at)}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function AdminPanel({ users, newUser, setNewUser, onSubmit }) {
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
          <option value="requester">Solicitante</option>
          <option value="signer">Assinante</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary" type="submit">
          <UserPlus size={18} />
          Criar
        </button>
      </form>
      <div className="user-list">
        {users.map((user) => (
          <div key={user.id}>
            <strong>{user.name}</strong>
            <small>{user.email} · {user.role}</small>
          </div>
        ))}
      </div>
    </section>
  );
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
