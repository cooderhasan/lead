# Coolify ile yayına alma (lead.aktifyay.com.tr)

## 1) DNS
Alan adı panelinde (aktifyay.com.tr) bir **A kaydı** ekleyin:

| Tür | Ad | Değer |
|---|---|---|
| A | `lead` | Coolify sunucunuzun IP adresi |

## 2) Coolify'da uygulama
1. **Projects → (proje) → + New → Public/Private Repository** → `cooderhasan/lead`, branch `main`.
2. **Build Pack: Docker Compose** → Docker Compose Location: **`/docker-compose.coolify.yml`**.
3. **Domains** (app servisi): `https://lead.aktifyay.com.tr` — Coolify SSL sertifikasını otomatik alır.
4. **Environment Variables**:
   - `ANTHROPIC_API_KEY` = Anthropic anahtarınız (**zorunlu**, "Is Secret" işaretleyin)
   - `ALLOW_SIGNUP` = `false` → yabancılar kayıt olup AI kredinizi harcayamaz (müşteriye hesap açmak için geçici `true` yapabilirsiniz)
   - `APIFY_TOKEN` = Apify API anahtarı (**isteğe bağlı**, "Is Secret") → Leads ekranında "AI ile lead bul" açılır. Boşsa CSV içe aktarma ve elle ekleme çalışır.
   - `LEAD_SEARCH_MAX` = tek aramada en fazla lead (varsayılan 50; her yeni lead 1 kredi)
   - Diğer her şey otomatik: veritabanı şifresi, demo ve admin parolaları Coolify tarafından üretilir.
5. **Deploy**. İlk açılışta tablolar ve Aktif Yay demo verisi otomatik kurulur (1–3 dk).

## 3) Giriş bilgileri
Coolify → uygulama → **Environment Variables** ekranında otomatik üretilen parolaları görürsünüz:

| Hesap | E-posta | Parola |
|---|---|---|
| Demo (Aktif Yay) | `demo@aktifyay.local` | `SERVICE_PASSWORD_DEMO` değeri |
| Platform yöneticisi | `admin@aisalesos.local` | `SERVICE_PASSWORD_ADMIN` değeri |

## 4) Güncelleme
Kod GitHub'a her gönderildiğinde Coolify'da **Redeploy** (veya otomatik deploy açıksa kendiliğinden).
Veritabanı ve yüklenen dosyalar kalıcı volume'larda durur; güncellemede silinmez.

## Notlar
- Yedekleme: Coolify → Postgres servisi → **Backups** ile günlük yedek açın.
- Sağlık kontrolü: `https://lead.aktifyay.com.tr/api/health` → `{"ok":true}`
- Sorun olursa: Coolify → app → **Logs** (açılışta `[start]` satırları görünür).
