import type { Metadata } from "next";
import { CheckCircle2, MailX } from "lucide-react";
import { describeUnsubscribe } from "@/server/services/unsubscribe";
import { unsubscribeAction } from "@/app/actions/unsubscribe";
import { Button, Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "E-posta aboneliği / Email subscription" };

/** İletinin diliyle (yurt dışı kampanyalarda İngilizce) gösterilen metinler */
const COPY = {
  tr: {
    doneTitle: "Listeden çıkarıldınız",
    done: (address: string, company: string) => (
      <>
        <strong>{address}</strong> adresine <strong>{company}</strong> tarafından bu sistem üzerinden başka ticari ileti gönderilmeyecek.
      </>
    ),
    askTitle: "E-posta almayı durdur",
    ask: (address: string, company: string) => (
      <>
        <strong>{address}</strong> adresine <strong>{company}</strong> tarafından gönderilen ticari iletileri almak istemiyor musunuz?
      </>
    ),
    confirm: "Evet, listeden çıkar",
  },
  en: {
    doneTitle: "You have been unsubscribed",
    done: (address: string, company: string) => (
      <>
        <strong>{company}</strong> will not send any further business emails to <strong>{address}</strong> through this system.
      </>
    ),
    askTitle: "Unsubscribe",
    ask: (address: string, company: string) => (
      <>
        Do you want to stop receiving business emails from <strong>{company}</strong> at <strong>{address}</strong>?
      </>
    ),
    confirm: "Yes, unsubscribe me",
  },
} as const;

/**
 * Herkese açık ret sayfası. Oturum gerektirmez; GET ile işlem yapılmaz (bağlantı önizleyicileri
 * yanlışlıkla ret yapmasın) — kullanıcı düğmeye basar.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const info = await describeUnsubscribe(token);
  const t = COPY[info?.lang ?? "tr"];

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
          {!info ? (
            <>
              <MailX className="size-10 text-text-3" aria-hidden />
              <h1 className="text-lg font-semibold text-text">Bağlantı geçersiz</h1>
              <p className="text-sm text-text-2">Bu ret bağlantısı geçersiz veya süresi dolmuş. Gönderene yanıt vererek de listeden çıkabilirsiniz.</p>
              <p className="text-sm text-text-3">This link is invalid or has expired. You can also unsubscribe by replying to the sender.</p>
            </>
          ) : done === "1" || info.alreadyUnsubscribed ? (
            <>
              <CheckCircle2 className="size-10 text-success" aria-hidden />
              <h1 className="text-lg font-semibold text-text">{t.doneTitle}</h1>
              <p className="text-sm text-text-2">{t.done(info.address, info.companyName)}</p>
            </>
          ) : (
            <>
              <MailX className="size-10 text-text-2" aria-hidden />
              <h1 className="text-lg font-semibold text-text">{t.askTitle}</h1>
              <p className="text-sm text-text-2">{t.ask(info.address, info.companyName)}</p>
              <form action={unsubscribeAction}>
                <input type="hidden" name="token" value={token} />
                <Button type="submit">{t.confirm}</Button>
              </form>
            </>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
