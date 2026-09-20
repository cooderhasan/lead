import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "AI Assistant" };

export default function Page() {
  return (
    <ComingSoon
      title="AI Assistant"
      phase={4}
      description="Doğal dilde soru sorun, AI raporlasın ve işlem yapsın."
      bullets={["\"Bu ay neden az satış yaptık?\" gibi sorulara veriye dayalı cevap", "\"Bursa'daki otomotiv firmalarını bul\" ile kampanya başlatma", "Yetki kontrollü AI araçları (find_leads, create_task…)", "Her AI kararının gerekçesi"]}
    />
  );
}
