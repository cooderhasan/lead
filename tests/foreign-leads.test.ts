import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLangForCountry, websiteQuery } from "@/server/services/lead-intelligence";
import { isMessageLanguage, languageInstruction } from "@/server/ai/prompts/campaign";
import { isDomesticCountry, TURKEY_COUNTRY_VARIANTS } from "@/lib/market";
import { isNonCompanyHost } from "@/server/providers/lead-source/apify-web";
import { __setRendererForTests } from "@/server/providers/render";
import { fetchListPage } from "@/server/web/fetch-site";
import { startSite } from "./helpers";

describe("yurt dışı arama sorgusu", () => {
  it("Türkçe ve yabancı ünvan eklerini atar", () => {
    expect(websiteQuery("ÖZKAN MAKİNA SAN. TİC. LTD. ŞTİ.", "Konya")).toBe("ÖZKAN MAKİNA Konya resmi web sitesi");
    expect(websiteQuery("Mayer Industries Inc.", "Ohio", "en")).toBe("Mayer Industries Ohio official website");
    expect(websiteQuery("Baumann Federn GmbH & Co. KG", null, "en")).toBe("Baumann Federn & official website");
  });

  it("ad tamamen ünvan ekinden oluşuyorsa orijinali kullanır (boş sorgu üretmez)", () => {
    expect(websiteQuery("Ltd. Şti.", null)).toContain("Ltd. Şti.");
  });

  it("ülkeye göre dil seçer; ülke yoksa Türkiye varsayılır", () => {
    expect(searchLangForCountry(null)).toBe("tr");
    expect(searchLangForCountry("TR")).toBe("tr");
    expect(searchLangForCountry("Türkiye")).toBe("tr");
    expect(searchLangForCountry("US")).toBe("en");
    expect(searchLangForCountry("Germany")).toBe("en");
  });

  it("yurt içi / yurt dışı ayrımı farklı yazımları tanır (kampanya pazarı)", () => {
    for (const c of [null, "", "  ", "TR", "tr", "Türkiye", "TÜRKİYE", "TURKIYE", "Turkey", "TUR"]) expect(isDomesticCountry(c)).toBe(true);
    for (const c of ["US", "Germany", "DE", "Azerbaijan"]) expect(isDomesticCountry(c)).toBe(false);
    for (const v of ["TR", "Türkiye", "TÜRKİYE", "Turkey", "TURKEY"]) expect(TURKEY_COUNTRY_VARIANTS).toContain(v);
  });

  it("yurt dışı firma dizinleri, veri satıcıları ve kamu siteleri firma sitesi sayılmaz", () => {
    const blocked = [
      "www.zoominfo.com", "dnb.com", "thomasnet.com", "importyeti.com", "uk.linkedin.com",
      // Canlıda yanlış eşleşen gerçek örnekler
      "bizapedia.com", "business.huntingtonchamber.org", "deq.louisiana.gov",
      "rocketreach.co", "apollo.io", "owler.com",
    ];
    for (const h of blocked) expect(isNonCompanyHost(h), h).toBe(true);
  });

  it("gerçek firma alan adlarını elemez", () => {
    const allowed = [
      "mayerindustries.com",
      // "chamber" çıplak eklenirse bu üretici elenirdi (garaj kapısı motoru)
      "chamberlaingroup.com",
      "borgwarner.com", "overheaddoor.com", "tksna.com", "elgiloy.com",
    ];
    for (const h of allowed) expect(isNonCompanyHost(h), h).toBe(false);
  });
});

describe("kampanya dili", () => {
  it("dil talimatı seçilen dile göre değişir ve cinsiyet varsaymaz", () => {
    expect(languageInstruction("en")).toContain("Hello");
    expect(languageInstruction("en")).not.toContain("Merhaba");
    expect(languageInstruction("tr")).toContain("Merhaba");
    // İki dilde de unvanla hitap yasak
    expect(languageInstruction("en")).toMatch(/Mr\.\/Ms\./);
    expect(languageInstruction("tr")).toMatch(/Bey\/Hanım/);
  });

  it("geçersiz dil değeri kabul edilmez (eski kayıtlar Türkçe'ye düşer)", () => {
    expect(isMessageLanguage("tr")).toBe(true);
    expect(isMessageLanguage("en")).toBe(true);
    expect(isMessageLanguage("de")).toBe(false);
    expect(isMessageLanguage(null)).toBe(false);
  });
});

afterEach(() => __setRendererForTests(null));

describe("liste sayfasını tarayıcıyla açma", () => {
  it("render seçiliyse sayfa tarayıcıdan gelir; sunucudaki boş HTML kullanılmaz", async () => {
    const site = await startSite({
      "/robots.txt": "User-agent: *\nAllow: /",
      // Gerçek fuar siteleri gibi: liste JavaScript ile yükleniyor, HTML'de yok
      "/exhibitors": "<html><body><div id='list'></div><script>loadExhibitors()</script></body></html>",
    });
    try {
      __setRendererForTests({ render: async () => "Alfa Federn GmbH\nBeta Springs Ltd\nGamma Yay San. Tic. A.Ş." });
      const page = await fetchListPage(`${site.url}/exhibitors`, { allowPrivateHosts: true, render: true });
      expect(page.rendered).toBe(true);
      expect(page.text).toContain("Alfa Federn GmbH");
      expect(page.records).toBeNull();
    } finally {
      site.server.close();
    }
  });

  it("render seçili olsa da DataTables kaynağı varsa tüm satırlar oradan alınır (tarayıcı yalnızca ilk sayfayı görür)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ company_name: `Firma ${i + 1} San. Tic. Ltd. Şti.`, sector_name: "Makina" }));
    const site = await startSite({
      "/robots.txt": "User-agent: *\nAllow: /",
      "/osb": "<html><body><table id='t'></table><script>$('#t').DataTable({ ajax: '/osb-data.json' })</script></body></html>",
      "/osb-data.json": JSON.stringify({ data: rows }),
    });
    const render = vi.fn(async () => "Firma 1 San. Tic. Ltd. Şti.");
    try {
      __setRendererForTests({ render });
      const page = await fetchListPage(`${site.url}/osb`, { allowPrivateHosts: true, render: true });
      expect(page.rendered).toBe(false);
      expect(page.records).toHaveLength(25);
      expect(render).not.toHaveBeenCalled();
    } finally {
      site.server.close();
    }
  });

  it("robots.txt kapalıysa tarayıcıyla da açılmaz", async () => {
    const site = await startSite({
      "/robots.txt": "User-agent: *\nDisallow: /exhibitors",
      "/exhibitors": "<html><body>liste</body></html>",
    });
    const render = vi.fn(async () => "olmamalı");
    try {
      __setRendererForTests({ render });
      await expect(fetchListPage(`${site.url}/exhibitors`, { allowPrivateHosts: true, render: true })).rejects.toThrow(/robots\.txt/);
      expect(render).not.toHaveBeenCalled();
    } finally {
      site.server.close();
    }
  });

  it("render kapalıyken sayfa metni sunucudan okunur", async () => {
    const site = await startSite({
      "/robots.txt": "User-agent: *\nAllow: /",
      "/liste": "<html><body><table><tr><td>Delta Yay Sanayi</td></tr></table></body></html>",
    });
    try {
      const page = await fetchListPage(`${site.url}/liste`, { allowPrivateHosts: true });
      expect(page.rendered).toBe(false);
      expect(page.text).toContain("Delta Yay Sanayi");
    } finally {
      site.server.close();
    }
  });
});
