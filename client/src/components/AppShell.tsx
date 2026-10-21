import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import GlobalSearch from '@/components/GlobalSearch';
import { CloseIcon, LifeBuoyIcon, LogOutIcon, MenuIcon, MoonIcon, SunIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/nav';
import { applyTheme, loadTheme } from '@/lib/theme';

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const current = loadTheme();
    if (current !== 'system') return current;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export default function AppShell() {
  const { user, logout, hasAnyPermission } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile sidebar on navigation (anchor behavior via NavLink click below).
  useEffect(() => {
    const close = () => setSidebarOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  const workItems = NAV_ITEMS.filter((i) => i.section === 'work' && hasAnyPermission(i.permissions));
  const adminItems = NAV_ITEMS.filter((i) => i.section === 'admin' && hasAnyPermission(i.permissions));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
      isActive
        ? 'bg-primary text-on-primary font-medium'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary">
          <LifeBuoyIcon size={22} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">Yad HelpDesk</p>
          <p className="text-xs text-muted-foreground">IT Service Management</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <div className="space-y-1">
          {workItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass} onClick={() => setSidebarOpen(false)}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </div>
        {adminItems.length > 0 && (
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Administration</p>
            {adminItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={() => setSidebarOpen(false)}>
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-border p-3">
        <p className="truncate px-3 text-sm font-medium text-foreground">{user?.name}</p>
        <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{user?.email}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOutIcon size={18} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">{sidebar}</aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-card shadow-xl">{sidebar}</aside>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="absolute right-4 top-4 cursor-pointer rounded-md p-2 text-white hover:bg-white/10"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <MenuIcon />
          </button>
          <GlobalSearch />
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
