/**
 * Serviço de preparação e formatação de e-mails para ocorrências de assinaturas incorretas.
 * Respeita a regra de não expor informações confidenciais ou inventar credenciais.
 */
import { BRASILIA_TIMEZONE, networkNow } from "../utils/networkTime.js";

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatOccurrenceEmail(occurrence, order = {}) {
  const code = order.code || occurrence.order_code || "N/A";
  const dateFormatted = occurrence.created_at
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: BRASILIA_TIMEZONE
      }).format(new Date(occurrence.created_at))
    : "N/A";

  const subject = `[Validação de OS] Alerta: ${occurrence.attempt_count}ª Tentativa Incorreta de Assinatura - OS ${code}`;

  const bodyText = `
ALERTA DE OCORRÊNCIA OPERACIONAL - VALIDAÇÃO DE ORDENS DE SERVIÇO
-----------------------------------------------------------------

Identificamos ${occurrence.attempt_count} tentativas consecutivas de assinatura incorreta para a seguinte Ordem de Serviço:

• Ordem de Serviço: ${code}
• Tipo de Ordem: ${order.order_type || "Reparo"}
• Equipe Executora: ${order.executor_team ? (order.executor_team === "producao" ? "Produção" : "Suporte") : "Não definida"}
• Data e Hora: ${dateFormatted}
• Usuário Envolvido: ${occurrence.user_name || "Assinante"}
• Tentativas Incorretas: ${occurrence.attempt_count}
• Tipo do Erro: ${occurrence.error_type || "two_incorrect_attempts"}
• Motivo / Descrição: ${occurrence.description || "Divergência detectada durante o double check"}
• Status Atual da OS: ${order.status || "pending_signature"}

Ação Recomendada:
Acesse o sistema administrativo de Validação de OS para auditar os apontamentos e verificar a integridade da conferência.

-----------------------------------------------------------------
Mensagem gerada automaticamente pelo Sistema de Validação de Ordens de Serviço.
Nenhum dado confidencial, senha ou chave privada é exposto neste e-mail.
`.trim();

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #dc2626; color: #ffffff; padding: 16px 20px; font-size: 18px; font-weight: bold; }
    .content { padding: 24px; font-size: 14px; line-height: 1.6; }
    .info-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .info-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .info-table td.label { font-weight: 600; color: #64748b; width: 38%; }
    .info-table td.val { color: #0f172a; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: #fee2e2; color: #991b1b; }
    .footer { background: #f8fafc; padding: 12px 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      ⚠️ Alerta Operacional: Tentativas Incorretas de Assinatura
    </div>
    <div class="content">
      <p>A Ordem de Serviço <strong>${escapeHtml(code)}</strong> registrou <strong>${escapeHtml(occurrence.attempt_count)} tentativas incorretas</strong> durante a validação.</p>
      
      <table class="info-table">
        <tr>
          <td class="label">Código da OS</td>
          <td class="val"><strong>${escapeHtml(code)}</strong></td>
        </tr>
        <tr>
          <td class="label">Data e Hora</td>
          <td class="val">${escapeHtml(dateFormatted)}</td>
        </tr>
        <tr>
          <td class="label">Usuário Envolvido</td>
          <td class="val">${escapeHtml(occurrence.user_name || "Assinante")}</td>
        </tr>
        <tr>
          <td class="label">Tentativas Incorretas</td>
          <td class="val"><span class="badge">${escapeHtml(occurrence.attempt_count)} tentativas</span></td>
        </tr>
        <tr>
          <td class="label">Motivo / Descrição</td>
          <td class="val">${escapeHtml(occurrence.description || "Divergência de chaves informada")}</td>
        </tr>
        <tr>
          <td class="label">Status da Ordem</td>
          <td class="val">${escapeHtml(order.status || "pending_signature")}</td>
        </tr>
      </table>

      <p style="margin-top: 20px;">Por favor, acesse o painel administrativo para verificar as ocorrências e tomar as providências cabíveis.</p>
    </div>
    <div class="footer">
      Sistema de Validação de OS • Este comunicado foi gerado automaticamente sem exposição de dados sensíveis.
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, bodyText, bodyHtml };
}

/**
 * E-mail de OS divergente: as quantidades de chaves dos dois assinantes não conferem,
 * a OS saiu da etapa de assinatura e voltou ao solicitante.
 * Nunca inclui quantidades de chaves (double check cego).
 */
export function formatDivergenceEmail({ order = {}, attemptNumber, occurredAt }) {
  const code = order.code || "N/A";
  const dateFormatted = occurredAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: BRASILIA_TIMEZONE
      }).format(new Date(occurredAt))
    : "N/A";
  const team = order.executor_team ? (order.executor_team === "producao" ? "Produção" : "Suporte") : "Não definida";
  const requester = order.requester_name || order.authorized_person_name || "Não informado";

  const subject = `[Validação de OS] OS ${code} divergente - devolvida ao solicitante`;

  const bodyText = `
AVISO DE ORDEM DE SERVIÇO DIVERGENTE - VALIDAÇÃO DE ORDENS DE SERVIÇO
-----------------------------------------------------------------

As quantidades de chaves informadas pelos dois assinantes não conferem no double check.
A OS foi retirada da etapa de assinatura e devolvida ao solicitante para correção.

• Ordem de Serviço: ${code}
• Tipo de Ordem: ${order.order_type || "Não informado"}
• Equipe Executora: ${team}
• Solicitante: ${requester}
• Data e Hora: ${dateFormatted}
• Tentativa incorreta nº: ${attemptNumber}

Próximo passo:
O solicitante deve conferir a OS e reenviá-la. A OS passa novamente pela conferência do estoque antes de voltar aos assinantes.

-----------------------------------------------------------------
Mensagem gerada automaticamente pelo Sistema de Validação de Ordens de Serviço.
Nenhum dado confidencial, senha ou chave privada é exposto neste e-mail.
`.trim();

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #d97706; color: #ffffff; padding: 16px 20px; font-size: 18px; font-weight: bold; }
    .content { padding: 24px; font-size: 14px; line-height: 1.6; }
    .info-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .info-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .info-table td.label { font-weight: 600; color: #64748b; width: 38%; }
    .info-table td.val { color: #0f172a; }
    .footer { background: #f8fafc; padding: 12px 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">⚠️ OS divergente devolvida ao solicitante</div>
    <div class="content">
      <p>As quantidades de chaves informadas pelos dois assinantes da OS <strong>${escapeHtml(code)}</strong> não conferem no double check. A OS foi retirada da etapa de assinatura e devolvida ao solicitante para correção.</p>
      <table class="info-table">
        <tr><td class="label">Código da OS</td><td class="val"><strong>${escapeHtml(code)}</strong></td></tr>
        <tr><td class="label">Tipo de Ordem</td><td class="val">${escapeHtml(order.order_type || "Não informado")}</td></tr>
        <tr><td class="label">Equipe Executora</td><td class="val">${escapeHtml(team)}</td></tr>
        <tr><td class="label">Solicitante</td><td class="val">${escapeHtml(requester)}</td></tr>
        <tr><td class="label">Data e Hora</td><td class="val">${escapeHtml(dateFormatted)}</td></tr>
        <tr><td class="label">Tentativa incorreta nº</td><td class="val">${escapeHtml(attemptNumber)}</td></tr>
      </table>
      <p style="margin-top: 20px;">O solicitante deve conferir a OS e reenviá-la. A OS passa novamente pela conferência do estoque antes de voltar aos assinantes.</p>
    </div>
    <div class="footer">
      Sistema de Validação de OS • Este comunicado foi gerado automaticamente sem exposição de dados sensíveis.
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, bodyText, bodyHtml };
}

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const MAX_RECIPIENTS = 30;

/**
 * Normaliza e valida uma lista de destinatários separada por vírgula/ponto e vírgula.
 * Retorna null se algum endereço for inválido.
 */
export function parseRecipients(raw) {
  if (!raw || typeof raw !== "string") return [];
  const list = raw
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length > MAX_RECIPIENTS) return null;
  return list.every((item) => EMAIL_REGEX.test(item)) ? list : null;
}

let cachedTransporter = null;

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const { default: nodemailer } = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT);
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return cachedTransporter;
}

/**
 * Envia (ou apenas prepara, se o SMTP não estiver configurado) o e-mail de uma ocorrência.
 * Nunca inventa destinatários: usa os informados (ou cadastrados pelo admin) ou NOTIFICATION_EMAIL.
 * Só retorna success=true quando o servidor SMTP aceitou a mensagem.
 */
export async function sendOccurrenceEmail({ occurrence, order = {}, recipient }) {
  return sendFormattedEmail(formatOccurrenceEmail(occurrence, order), recipient);
}

/**
 * Envia o aviso de OS divergente (quantidades de chaves diferentes no double check).
 * Mesmas regras de destinatário e de retorno de sendOccurrenceEmail.
 */
export async function sendDivergenceEmail({ order, attemptNumber, occurredAt, recipient }) {
  return sendFormattedEmail(formatDivergenceEmail({ order, attemptNumber, occurredAt }), recipient);
}

async function sendFormattedEmail({ subject, bodyText, bodyHtml }, recipient) {
  const rawRecipient = recipient || process.env.NOTIFICATION_EMAIL || "";
  const recipients = parseRecipients(rawRecipient);

  if (recipients === null) {
    return {
      success: false,
      configured: isEmailConfigured(),
      errorCode: "invalid_recipient",
      reason: "Destinatário de e-mail inválido."
    };
  }

  if (recipients.length === 0) {
    return {
      success: false,
      configured: isEmailConfigured(),
      errorCode: "missing_recipient",
      reason: "Nenhum destinatário informado e nenhum e-mail cadastrado para notificações (aba Ocorrências do Admin).",
      preview: { to: null, subject, bodyText }
    };
  }

  const to = recipients.join(", ");

  if (!isEmailConfigured()) {
    return {
      success: false,
      configured: false,
      errorCode: "smtp_not_configured",
      recipient: to,
      subject,
      reason: "Serviço SMTP não configurado. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM no arquivo .env para habilitar o envio. Nenhum e-mail foi enviado.",
      preview: { to, subject, bodyText }
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: bodyText,
      html: bodyHtml
    });
    return {
      success: true,
      configured: true,
      recipient: to,
      subject,
      messageId: info.messageId,
      sentAt: (await networkNow()).toISOString(),
      preview: { to, subject, bodyText }
    };
  } catch (error) {
    console.error("[EmailService] Falha ao enviar e-mail de ocorrência:", error.message);
    return {
      success: false,
      configured: true,
      errorCode: "send_failed",
      recipient: to,
      subject,
      reason: "Falha ao enviar o e-mail pelo servidor SMTP. Verifique as configurações e tente novamente.",
      preview: { to, subject, bodyText }
    };
  }
}

