import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db";
import { __setAIProviderForTests } from "@/server/ai";
import { drainInlineJobs } from "@/server/jobs/queue";
import type { ImapAccount, MailboxSinceReader } from "@/server/providers/email/imap";
import {
  __setInquiryReaderForTests,
  getInquiryMailbox,
  getInquiryReport,
  getLastInquiryAnalysis,
  isAutomatedMail,
  redactPersonalData,
  saveInquiryMailbox,
  setInquiryStatus,
  startInquiryAnalysis,
} from "@/server/services/inquiry-insights";
import { createTenant, MockAIProvider, resetDb } from "./helpers";

const mail = (uid: number, from: string, subject: string, body: string, extraHeaders = "") => ({
  uid,
  source: Buffer.from(
    `From: ${from}\r\nTo: teklif@aktifyay.com.tr\r\nSubject: ${subject}\r\nDate: Mon, 05 Oct 2026 10:00:00 +0300\r\nMessage-ID: <m${uid}@x>\r\n${extraHeaders}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`,
  ),
});

const MESSAGES = [
  mail(1, "Ali <ali@tarimmak.com.tr>", "Yay teklifi", "Merhaba, ekim makinamızın tohum bölmesi için 5.000 adet basma yay fiyatı rica ediyoruz. Tarım Mak A.Ş. Konya. Tel: 0532 111 22 33, ali@tarimmak.com.tr"),
  mail(2, "Satış <satis@aktifyay.com.tr>", "Teklifimiz", "Ekte teklifimizi bulabilirsiniz."),
  mail(3, "Otomatik <info@baska.com>", "Ofis dışındayım", "Şu an ofis dışındayım.", "Auto-Submitted: auto-replied\r\n"),
  mail(4, "Muhasebe <muhasebe@kargo.com>", "Fatura", "Ekte faturanız bulunmaktadır."),
  mail(5, "Can <can@hidrolikvalf.com>", "Fiyat", "Valf gövdemiz için çekme yayı ihtiyacımız var, teklif alabilir miyiz?"),
];

// Mesaj 1: gerçek talep. Mesaj 4: talep değil. Mesaj 5: AI firma adını uydurur → kaydedilmez; kanıt metinde var.
const AI_ANSWER = JSON.stringify({
  items: [
    { n: 1, isInquiry: true, companyName: "Tarım Mak A.Ş.", category: "Tarım makinaları", purpose: "seri üretim", sector: "ekim makinası üretimi", application: "ekim makinası tohum bölmesi", springTypes: ["basma"], quantity: "5.000 adet", city: "Konya", country: null, evidence: "5.000 adet basma yay fiyatı rica ediyoruz" },
    { n: 2, isInquiry: false },
    { n: 3, isInquiry: true, companyName: "Uydurma Hidrolik Ltd.", category: "Hidrolik ve pnömatik", purpose: "listede olmayan amaç", sector: "valf", application: "valf gövdesi", springTypes: ["çekme"], quantity: null, city: null, country: null, evidence: "çekme yayı ihtiyacımız var" },
  ],
});

function fakeReader(opts: { failAuth?: boolean } = {}) {
  const reads: ImapAccount[] = [];
  const factory = (acc: ImapAccount): MailboxSinceReader => ({
    async check() {
      reads.push(acc);
      if (opts.failAuth) throw Object.assign(new Error("Command failed"), { authenticationFailed: true });
      return { messages: MESSAGES.length };
    },
    async readSince() {
      reads.push(acc);
      return { uidValidity: 7n, messages: MESSAGES };
    },
  });
  return { factory, reads };
}

const INPUT = { host: "mail.aktifyay.com.tr", port: 993, secure: true, user: "teklif@aktifyay.com.tr", pass: "gizli-sifre", mailbox: "INBOX" };
const balance = async (companyId: string) => (await rawDb.company.findUniqueOrThrow({ where: { id: companyId }, select: { creditBalance: true } })).creditBalance;

beforeEach(resetDb);
afterEach(() => {
  __setInquiryReaderForTests(null);
  __setAIProviderForTests(null);
});
afterAll(async () => {
  await rawDb.$disconnect();
});

describe("teklif kutusu: yardımcılar", () => {
  it("e-posta ve telefon maskelenir; adet ve ölçüler korunur", () => {
    const out = redactPersonalData("Tel: 0532 111 22 33 / +49 30 1234 5678 · ali@firma.com · 5.000 adet, Ø12 x 45 mm, 100.000-200.000 adet");
    expect(out).not.toMatch(/0532|1234 5678|ali@firma/);
    expect(out).toContain("[telefon]");
    expect(out).toContain("[e-posta]");
    expect(out).toContain("5.000 adet");
    expect(out).toContain("100.000-200.000 adet");
  });

  it("otomatik / toplu iletiler tanınır", () => {
    expect(isAutomatedMail(new Map([["auto-submitted", "auto-replied"]]), "a@b.com")).toBe(true);
    expect(isAutomatedMail(new Map([["list-unsubscribe", "<x>"]]), "a@b.com")).toBe(true);
    expect(isAutomatedMail(new Map(), "noreply@b.com")).toBe(true);
    expect(isAutomatedMail(new Map([["auto-submitted", "no"]]), "ali@b.com")).toBe(false);
  });
});

describe("teklif kutusu analizi", () => {
  it("bağlantı denenir; şifre şifrelenmiş saklanır ve geri okunmaz; hatalı şifre anlaşılır mesaj verir", async () => {
    const a = await createTenant("Aktif Yay");
    __setInquiryReaderForTests(fakeReader({ failAuth: true }).factory);
    await expect(saveInquiryMailbox(a, INPUT)).rejects.toThrow(/şifre hatalı/);
    expect(await getInquiryMailbox(a)).toBeNull();

    const r = fakeReader();
    __setInquiryReaderForTests(r.factory);
    expect(await saveInquiryMailbox(a, INPUT)).toEqual({ messages: 5 });
    const rec = await rawDb.integration.findFirstOrThrow({ where: { companyId: a.companyId, provider: "inquiry_mailbox" } });
    expect(rec.secretsEncrypted).toBeTruthy();
    expect(rec.secretsEncrypted).not.toContain("gizli-sifre");
    expect(JSON.stringify(rec.config)).not.toContain("gizli-sifre");
    expect(await getInquiryMailbox(a)).not.toHaveProperty("pass");

    // Şifre boş bırakılırsa kayıtlı şifre kullanılır
    await saveInquiryMailbox(a, { ...INPUT, pass: "" });
    expect(r.reads.at(-1)!.pass).toBe("gizli-sifre");

    const member = await createTenant("Üye", "MEMBER");
    await expect(saveInquiryMailbox(member, INPUT)).rejects.toThrow(/yetkiniz yok/);
  });

  it("kendi gönderimleri ve otomatik yanıtlar AI'ya gitmez; kişisel bilgi maskelenir; uydurma ad ve kanıtsız talep kaydedilmez", async () => {
    const a = await createTenant("Aktif Yay");
    await rawDb.company.update({ where: { id: a.companyId }, data: { website: "https://www.aktifyay.com.tr" } });
    __setInquiryReaderForTests(fakeReader().factory);
    await saveInquiryMailbox(a, INPUT);
    const ai = new MockAIProvider(() => AI_ANSWER);
    __setAIProviderForTests(ai);
    const before = await balance(a.companyId);

    await startInquiryAnalysis(a);
    await drainInlineJobs();

    // Yalnızca 3 ileti (1, 4, 5) tek grupta AI'ya gitti → 1 kredi
    expect(ai.calls).toHaveLength(1);
    const sent = JSON.stringify(ai.calls[0]!.messages);
    expect(sent).not.toMatch(/0532|ali@tarimmak|Ekte teklifimizi|ofis dışındayım/i);
    expect(sent).toContain("[telefon]");
    expect(await balance(a.companyId)).toBe(before - 1);

    const rows = await rawDb.inboundInquiry.findMany({ where: { companyId: a.companyId }, orderBy: { sourceKey: "asc" } });
    expect(rows).toHaveLength(5);
    const bySource = Object.fromEntries(rows.map((r) => [r.sourceKey, r]));
    expect(bySource["7:1"]).toMatchObject({ isInquiry: true, companyName: "Tarım Mak A.Ş.", category: "Tarım makinaları", purpose: "seri üretim", springTypes: ["basma"], senderDomain: "tarimmak.com.tr", status: "PENDING" });
    expect(bySource["7:2"]).toMatchObject({ isInquiry: false, sector: null });
    expect(bySource["7:3"]).toMatchObject({ isInquiry: false });
    expect(bySource["7:4"]).toMatchObject({ isInquiry: false });
    // İletide geçmeyen firma adı kaydedilmez; kanıt metinde olduğu için talep sayılır
    // Liste dışı amaç "belirsiz" olur
    expect(bySource["7:5"]).toMatchObject({ isInquiry: true, companyName: null, category: "Hidrolik ve pnömatik", purpose: "belirsiz" });

    const report = await getInquiryReport(a);
    expect(report).toMatchObject({ total: 5, inquiries: 2, rejected: 0, serial: 1, maintenance: 0 });
    expect(report.byCategory.map((s) => s.name)).toEqual(["Tarım makinaları", "Hidrolik ve pnömatik"]);
    expect((await getLastInquiryAnalysis(a))!.status).toBe("SUCCEEDED");

    // İkinci çalıştırma: hepsi işlenmiş → AI ve kredi yok
    await startInquiryAnalysis(a);
    await drainInlineJobs();
    expect(ai.calls).toHaveLength(1);
    expect(await balance(a.companyId)).toBe(before - 1);

    // Yanlış kayıt rapordan çıkarılır
    await setInquiryStatus(a, bySource["7:5"]!.id, "REJECTED");
    expect(await getInquiryReport(a)).toMatchObject({ inquiries: 1, rejected: 1 });

    // Başka şirket ne raporu görür ne kaydı değiştirebilir
    const b = await createTenant("B");
    expect(await getInquiryReport(b)).toMatchObject({ total: 0, inquiries: 0 });
    await expect(setInquiryStatus(b, bySource["7:1"]!.id, "REJECTED")).rejects.toThrow(/bulunamadı/);
  });

  it("kategori eklenmeden önce işlenen talepler bir sonraki analizde yeniden sınıflandırılır; durum korunur, diğerleri tekrar işlenmez", async () => {
    const a = await createTenant("Aktif Yay");
    __setInquiryReaderForTests(fakeReader().factory);
    await saveInquiryMailbox(a, INPUT);
    // Eski analizden kalmış kayıtlar: talep (kategorisiz, rapordan çıkarılmış) + talep olmayan
    await rawDb.inboundInquiry.createMany({
      data: [
        { companyId: a.companyId, sourceKey: "7:1", isInquiry: true, sector: "tarım makinaları", evidence: "x", status: "REJECTED" },
        { companyId: a.companyId, sourceKey: "7:4", isInquiry: false },
        { companyId: a.companyId, sourceKey: "7:5", isInquiry: true, category: "Hidrolik ve pnömatik", evidence: "çekme yayı ihtiyacımız var" },
      ],
    });
    const ai = new MockAIProvider(() => AI_ANSWER);
    __setAIProviderForTests(ai);
    await startInquiryAnalysis(a);
    await drainInlineJobs();

    // Yalnızca 7:1 (yeniden) AI'ya gitti; 7:4 ve 7:5 tekrar işlenmedi
    expect(ai.calls).toHaveLength(1);
    expect(JSON.stringify(ai.calls[0]!.messages)).not.toContain("Valf gövdemiz");
    const row = await rawDb.inboundInquiry.findFirstOrThrow({ where: { companyId: a.companyId, sourceKey: "7:1" } });
    expect(row).toMatchObject({ category: "Tarım makinaları", purpose: "seri üretim", status: "REJECTED" });
    expect(await rawDb.inboundInquiry.count({ where: { companyId: a.companyId, sourceKey: "7:1" } })).toBe(1);
    expect((await getLastInquiryAnalysis(a))!.result).toMatchObject({ reclassified: 1 });
  });

  it("kanıtı iletide geçmeyen 'talep' kaydedilmez (AI uydurması)", async () => {
    const a = await createTenant("Aktif Yay");
    __setInquiryReaderForTests(fakeReader().factory);
    await saveInquiryMailbox(a, INPUT);
    __setAIProviderForTests(
      new MockAIProvider(() =>
        JSON.stringify({ items: [{ n: 1, isInquiry: true, companyName: null, sector: "otomotiv", springTypes: ["kurma"], evidence: "1 milyon adet kurma yayı istiyoruz" }] }),
      ),
    );
    await startInquiryAnalysis(a);
    await drainInlineJobs();
    const row = await rawDb.inboundInquiry.findFirstOrThrow({ where: { companyId: a.companyId, sourceKey: "7:1" } });
    expect(row).toMatchObject({ isInquiry: false, sector: null, evidence: null });
  });
});
