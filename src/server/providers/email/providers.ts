import "server-only";
import { AppError } from "@/lib/errors";
import type { EmailProvider, OutgoingEmail, SendResult } from "./types";

/** RFC 8058 tek tıkla ret başlıkları — Gmail/Yahoo toplu gönderici kuralları bunları zorunlu tutar. */
export function unsubscribeHeaders(email: OutgoingEmail): Record<string, string> {
  return {
    "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-AISalesOS-Message-Id": email.messageId,
    ...(email.headers ?? {}),
  };
}

const fmtFrom = (f: OutgoingEmail["from"]) => (f.name ? `"${f.name.replace(/"/g, "'")}" <${f.email}>` : f.email);

async function postJson(url: string, headers: Record<string, string>, body: unknown, provider: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // 4xx: yapılandırma/adres hatası — tekrar denemek anlamsız; 5xx/429: geçici
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    const err = new AppError("EXTERNAL_FETCH", `${provider} gönderimi reddetti (${res.status}): ${text.slice(0, 300)}`);
    (err as AppError & { retryable?: boolean }).retryable = !permanent;
    throw err;
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new AppError("VALIDATION", "RESEND_API_KEY tanımlı değil.");
  }
  async send(email: OutgoingEmail): Promise<SendResult> {
    const data = await postJson(
      "https://api.resend.com/emails",
      { authorization: `Bearer ${this.apiKey}`, "idempotency-key": email.messageId },
      {
        from: fmtFrom(email.from),
        to: [email.to],
        reply_to: email.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: unsubscribeHeaders(email),
      },
      "Resend",
    );
    return { providerMessageId: String(data.id ?? ""), accepted: true };
  }
}

export class BrevoProvider implements EmailProvider {
  readonly name = "brevo";
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new AppError("VALIDATION", "BREVO_API_KEY tanımlı değil.");
  }
  async send(email: OutgoingEmail): Promise<SendResult> {
    const data = await postJson(
      "https://api.brevo.com/v3/smtp/email",
      { "api-key": this.apiKey },
      {
        sender: { email: email.from.email, name: email.from.name },
        to: [{ email: email.to }],
        replyTo: email.replyTo ? { email: email.replyTo } : undefined,
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
        headers: unsubscribeHeaders(email),
        tags: ["ai-sales-os"],
      },
      "Brevo",
    );
    return { providerMessageId: String(data.messageId ?? ""), accepted: true };
  }
}

export class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  constructor(
    private readonly opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
  ) {
    if (!opts.host) throw new AppError("VALIDATION", "SMTP_HOST tanımlı değil.");
  }
  async send(email: OutgoingEmail): Promise<SendResult> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.secure,
      auth: this.opts.user ? { user: this.opts.user, pass: this.opts.pass ?? "" } : undefined,
      connectionTimeout: 20_000,
      socketTimeout: 30_000,
    });
    try {
      const info = await transport.sendMail({
        from: fmtFrom(email.from),
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: unsubscribeHeaders(email),
        messageId: `<${email.messageId}@${email.from.email.split("@")[1] ?? "localhost"}>`,
      });
      return { providerMessageId: info.messageId ?? email.messageId, accepted: info.accepted.length > 0 };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      const e = new AppError("EXTERNAL_FETCH", `SMTP gönderimi başarısız: ${(err as Error).message.slice(0, 300)}`);
      // 5xx SMTP yanıtı kalıcı (adres yok, reddedildi); diğerleri geçici
      (e as AppError & { retryable?: boolean }).retryable = !(code && code >= 500);
      throw e;
    } finally {
      transport.close();
    }
  }
}
