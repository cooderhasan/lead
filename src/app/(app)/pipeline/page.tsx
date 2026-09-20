import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Pipeline" };

export default function Page() {
  return (
    <ComingSoon
      title="Pipeline"
      phase={4}
      description="Sade CRM: yeni → nitelikli → iletişim → ilgili → teklif → pazarlık → kazanıldı/kaybedildi."
      bullets={["Kanban görünümü", "Lead kartında AI özeti", "Kayıp nedeni analizi", "Görev ve teklif bağlantısı"]}
    />
  );
}
