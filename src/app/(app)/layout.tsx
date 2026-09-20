import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins, LogOut, ShieldCheck } from "lucide-react";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { requireTenantPage, requireUserPage, listUserCompanies } from "@/server/tenancy/context";
import { logoutAction, switchCompanyAction } from "@/app/actions/auth";
import { AppShell } from "@/components/app-shell";
import { formatNumber } from "@/lib/cn";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const ctx = await requireTenantPage();
  const [company, companies] = await Promise.all([
    tenantDb(ctx).company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { name: true, creditBalance: true, onboardingCompletedAt: true, onboardingStep: true },
    }),
    listUserCompanies(user.userId),
  ]);

  // Kurulum tamamlanmadıysa önce "Önce şirketini tanıyalım."
  if (!company.onboardingCompletedAt && company.onboardingStep === 0) redirect("/onboarding");

  const topbar = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      {companies.length > 1 ? (
        <form action={switchCompanyAction} className="min-w-0">
          <label htmlFor="company-switch" className="sr-only">Şirket</label>
          <select
            id="company-switch"
            name="companyId"
            defaultValue={ctx.companyId}
            className="h-9 max-w-[50vw] truncate rounded-lg border border-border bg-surface px-2 text-sm font-medium"
          >
            {companies.map((c) => (
              <option key={c.company.id} value={c.company.id}>{c.company.name}</option>
            ))}
          </select>
          <button type="submit" className="ml-2 text-xs text-accent">Geç</button>
        </form>
      ) : (
        <p className="truncate text-sm font-semibold text-text">{company.name}</p>
      )}
      <div className="flex items-center gap-2">
        {user.isPlatformAdmin && (
          <Link href="/admin" className="hidden items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-2 sm:flex">
            <ShieldCheck className="size-4" aria-hidden /> Admin
          </Link>
        )}
        <Link
          href="/settings/usage"
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-2"
          title="Kalan kredi"
        >
          <Coins className="size-3.5" aria-hidden /> {formatNumber(company.creditBalance)} kredi
        </Link>
      </div>
    </div>
  );

  const footer = (
    <div className="border-t border-border pt-3">
      <p className="truncate px-2.5 text-sm font-medium text-text">{user.name}</p>
      <p className="truncate px-2.5 text-xs text-text-3">{user.email}</p>
      <form action={logoutAction} className="mt-2">
        <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
          <LogOut className="size-4" aria-hidden /> Çıkış yap
        </button>
      </form>
    </div>
  );

  return (
    <AppShell topbar={topbar} footer={footer}>
      {children}
    </AppShell>
  );
}
