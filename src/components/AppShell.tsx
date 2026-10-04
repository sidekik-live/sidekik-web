import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { UserMenu } from "@/components/UserMenu";

type NavItem = { label: string; to: string; params?: Record<string, string>; adminOnly?: boolean };

const navItems: NavItem[] = [
  { label: "Home", to: "/" },
  { label: "Workflows", to: "/workflows" },
  { label: "People", to: "/people" },
  { label: "Work Maps", to: "/workmaps" },
  { label: "Sessions", to: "/sessions" },
  { label: "Costs", to: "/costs" },
  { label: "Settings", to: "/org/settings", adminOnly: true },
  { label: "MiniERP", to: "/sandbox/erp" },
  { label: "Capture (demo)", to: "/capture/$sid", params: { sid: "demo" }, adminOnly: true },
  { label: "Tutor (demo)", to: "/tutor/$sid", params: { sid: "demo" }, adminOnly: true },
];

/** Routes rendered full-screen, without sidebar, and reachable signed out. */
function isBareRoute(path: string) {
  return (
    path === "/login" ||
    path === "/signup" ||
    path === "/sandbox/erp" ||
    path.startsWith("/agent-host/")
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <img src="/logo.png" alt="" width={24} height={24} className="size-6 shrink-0" />
      <span className="text-lg font-bold tracking-tight text-primary">sidekik</span>
    </span>
  );
}

function AppSidebar() {
  const { membership } = useAuth();
  const isAdmin = membership?.role === "admin";
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center px-5">
        <Wordmark />
      </div>
      <nav className="mt-2 flex flex-col gap-0.5 px-3">
        {navItems
          .filter((i) => !i.adminOnly || isAdmin)
          .map((item) => (
            <Link
              key={item.label}
              to={item.to as never}
              params={(item.params ?? {}) as never}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              }}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
      </nav>
    </aside>
  );
}

function TopBar() {
  const { membership } = useAuth();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <span className="text-sm font-semibold">{membership?.orgName ?? ""}</span>
      <UserMenu />
    </header>
  );
}

function NoOrg() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        You're not in an organisation yet. Ask an admin to add you.
      </p>
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { ready, session, membership, membershipLoading } = useAuth();
  const bare = isBareRoute(pathname);

  useEffect(() => {
    if (ready && !session && !bare) navigate({ to: "/login", replace: true });
  }, [ready, session, bare, navigate]);

  if (bare) return <Outlet />;

  if (!ready || !session) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">
          {membershipLoading ? null : membership ? <Outlet /> : <NoOrg />}
        </main>
      </div>
    </div>
  );
}
