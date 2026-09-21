/** Sol menü (spec §90). `phase` > 1 olan bölümler henüz geliştirilmedi ve "Faz N" etiketiyle gösterilir (1 = kullanılabilir). */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", phase: 1 },
  { href: "/assistant", label: "AI Assistant", icon: "Sparkles", phase: 4 },
  { href: "/leads", label: "Leads", icon: "Building2", phase: 1 },
  { href: "/campaigns", label: "Campaigns", icon: "Megaphone", phase: 3 },
  { href: "/pipeline", label: "Pipeline", icon: "KanbanSquare", phase: 4 },
  { href: "/tasks", label: "Tasks", icon: "ListChecks", phase: 4 },
  { href: "/messages", label: "Messages", icon: "Mail", phase: 3 },
  { href: "/company", label: "Şirketim", icon: "Factory", phase: 1 },
  { href: "/products", label: "Products", icon: "Package", phase: 1 },
  { href: "/knowledge", label: "Knowledge Base", icon: "BookOpen", phase: 1 },
  { href: "/competitors", label: "Competitors", icon: "Swords", phase: 1 },
  { href: "/signals", label: "Signals", icon: "Radar", phase: 1 },
  { href: "/analytics", label: "Analytics", icon: "LineChart", phase: 4 },
  { href: "/reports", label: "Reports", icon: "FileBarChart", phase: 4 },
  { href: "/settings", label: "Settings", icon: "Settings", phase: 1 },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"];
