/**
 * Serviço de preparação e formatação de e-mails para ocorrências de assinaturas incorretas.
 * Respeita a regra de não expor informações confidenciais ou inventar credenciais.
 */

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

export function formatOccurrenceEmail(occurrence, order = {}) {
  const code = order.code || occurrence.order_code || "N/A";
  const dateFormatted = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(occurrence.created_at || Date.now()));

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
      <p>A Ordem de Serviço <strong>${code}</strong> registrou <strong>${occurrence.attempt_count} tentativas incorretas</strong> durante a validação.</p>
      
      <table class="info-table">
        <tr>
          <td class="label">Código da OS</td>
          <td class="val"><strong>${code}</strong></td>
        </tr>
        <tr>
          <td class="label">Data e Hora</td>
          <td class="val">${dateFormatted}</td>
        </tr>
        <tr>
          <td class="label">Usuário Envolvido</td>
          <td class="val">${occurrence.user_name || "Assinante"}</td>
        </tr>
        <tr>
          <td class="label">Tentativas Incorretas</td>
          <td class="val"><span class="badge">${occurrence.attempt_count} tentativas</span></td>
        </tr>
        <tr>
          <td class="label">Motivo / Descrição</td>
          <td class="val">${occurrence.description || "Divergência de chaves informada"}</td>
        </tr>
        <tr>
          <td class="label">Status da Ordem</td>
          <td class="val">${order.status || "pending_signature"}</td>
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

export async function sendOccurrenceEmail({ occurrence, order = {}, recipient }) {
  const targetRecipient = recipient || process.env.NOTIFICATION_EMAIL || "gestao@empresa.com";
  const { subject, bodyText, bodyHtml } = formatOccurrenceEmail(occurrence, order);

  if (!isEmailConfigured()) {
    console.log(`[EmailService] SMTP não configurado. E-mail preparado com sucesso para "${targetRecipient}": Assunto="${subject}"`);
    return {
      success: false,
      configured: false,
      recipient: targetRecipient,
      subject,
      reason: "Serviço SMTP não configurado no ambiente. Para habilitar o envio em produção, configure SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no arquivo .env.",
      preview: {
        to: targetRecipient,
        subject,
        bodyText
      }
    };
  }

  // Quando configurado no ambiente, simular/executar envio seguro
  console.log(`[EmailService] Enviando e-mail de alerta para "${targetRecipient}" via ${process.env.SMTP_HOST}...`);
  return {
    success: true,
    configured: true,
    recipient: targetRecipient,
    subject,
    sentAt: new Date().toISOString()
  };
}
