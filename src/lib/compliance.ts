/**
 * Gönderim öncesi uyum değerlendirmesi (spec §24, §57). Saf fonksiyon — AI kullanılmaz.
 *
 * Bu kurallar hukuki danışmanlık değildir; belirsiz durumlar "REVIEW_REQUIRED" ile insana bırakılır.
 * Kaynak ilke: 6563 s. Kanun kapsamında tacir/esnafın kurumsal elektronik adreslerine ticari ileti
 * ön onay istisnasına girer ancak ret hakkı her iletide sunulmalıdır; kişisel adresler için KVKK
 * kapsamında iletişim dayanağı gerekir.
 */
import type { CommunicationBasis, ComplianceStatus, ConsentStatus, ContactType } from "@prisma/client";
import { isGenericEmail, normalizeEmail } from "./lead-normalize";

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.tr", "outlook.com", "outlook.com.tr", "live.com",
  "yahoo.com", "yahoo.com.tr", "yandex.com", "yandex.com.tr", "icloud.com", "me.com", "mynet.com", "proton.me", "protonmail.com",
]);

const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i;

/** Aynı adrese iki ileti arasında en az bu kadar gün (frekans sınırı) */
export const MIN_DAYS_BETWEEN_CONTACTS = 3;

export interface ComplianceInput {
  address: string | null | undefined;
  contactType: ContactType;
  basis: CommunicationBasis;
  consent: ConsentStatus;
  optOut: boolean;
  suppressed: boolean;
  lastContactedAt?: Date | null;
  /** Bir kullanıcı adresi inceleyip dayanak seçtiyse (ComplianceRecord.reviewedAt) */
  reviewed?: boolean;
  now?: Date;
}

export interface ComplianceResult {
  status: ComplianceStatus;
  reasons: string[];
}

export function evaluateEmailCompliance(i: ComplianceInput): ComplianceResult {
  const address = normalizeEmail(i.address);
  if (!address) return { status: "DO_NOT_SEND", reasons: ["Geçersiz e-posta adresi."] };
  if (i.suppressed) return { status: "DO_NOT_SEND", reasons: ["Adres, alan adı veya firma ret/engel listesinde."] };
  if (i.optOut || i.consent === "DENIED" || i.consent === "WITHDRAWN") {
    return { status: "DO_NOT_SEND", reasons: ["Alıcı iletişim istemediğini bildirdi."] };
  }
  const [local, domain = ""] = address.split("@");
  if (NO_REPLY.test(local ?? "")) return { status: "DO_NOT_SEND", reasons: ["Yanıt kabul etmeyen sistem adresi."] };

  const reasons: string[] = [];
  const now = i.now ?? new Date();
  if (i.lastContactedAt && now.getTime() - i.lastContactedAt.getTime() < MIN_DAYS_BETWEEN_CONTACTS * 86_400_000) {
    return { status: "REVIEW_REQUIRED", reasons: [`Son ${MIN_DAYS_BETWEEN_CONTACTS} gün içinde bu adrese ileti gönderildi.`] };
  }

  if (i.reviewed && i.basis !== "NONE") {
    return { status: "SENDABLE", reasons: [`İnsan incelemesiyle onaylandı: ${BASIS_LABELS[i.basis]}. Ret bağlantısı eklenir.`] };
  }
  if (i.basis === "EXPLICIT_CONSENT" || i.basis === "EXISTING_RELATIONSHIP" || i.basis === "INBOUND_REQUEST") {
    return { status: "SENDABLE", reasons: ["İletişim dayanağı mevcut (onay / mevcut ilişki / gelen talep). Ret bağlantısı eklenir."] };
  }

  const generic = i.contactType === "COMPANY_GENERIC" || isGenericEmail(address);
  if (FREE_MAIL_DOMAINS.has(domain)) {
    reasons.push("Ücretsiz e-posta servisi adresi — kişiye ait olabilir; tacir adresi olduğunu doğrulayın.");
    return { status: "REVIEW_REQUIRED", reasons };
  }
  if (generic) {
    return {
      status: "SENDABLE",
      reasons: ["Kurumsal genel adres (tacir/esnaf istisnası). Her iletide ret bağlantısı ve gönderici kimliği bulunur."],
    };
  }
  if (i.basis === "B2B_TRADER_ADDRESS") {
    return { status: "SENDABLE", reasons: ["Kişi adresi, kullanıcı tarafından tacir kurumsal adresi olarak işaretlendi. Ret bağlantısı eklenir."] };
  }
  return {
    status: "REVIEW_REQUIRED",
    reasons: ["Kişiye ait adres: iletişim dayanağı belirtilmeden gönderilmez (KVKK). İnceleyip dayanak seçin."],
  };
}

export const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  SENDABLE: "Gönderilebilir",
  REVIEW_REQUIRED: "İnceleme gerekli",
  DO_NOT_SEND: "Gönderilmez",
};

export const BASIS_LABELS: Record<CommunicationBasis, string> = {
  NONE: "Dayanak yok",
  B2B_TRADER_ADDRESS: "Tacir kurumsal adresi",
  EXPLICIT_CONSENT: "Açık onay",
  EXISTING_RELATIONSHIP: "Mevcut müşteri ilişkisi",
  INBOUND_REQUEST: "Firmadan gelen talep",
};
