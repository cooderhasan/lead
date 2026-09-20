import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Messages" };

export default function Page() {
  return (
    <ComingSoon
      title="Messages"
      phase={3}
      description="Giden mesajlar ve gelen cevaplar."
      bullets={["Onay bekleyen taslaklar", "Cevap sınıflandırma (ilgili, fiyat, katalog…)", "AI cevap asistanı — fiyat uydurmaz", "Ret ve engel listesi yönetimi"]}
    />
  );
}
