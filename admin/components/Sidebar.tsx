'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/users', label: 'Users', icon: '◉' },
  { href: '/providers', label: 'API Providers', icon: '⬡' },
  { href: '/catalog', label: 'Catalog', icon: '▤' },
  { href: '/subscriptions', label: 'Subscriptions', icon: '★' },
  { href: '/settings', label: 'Settings & Flags', icon: '⚙' },
  { href: '/logs', label: 'Logs & Audit', icon: '☰' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = () => {
    clearToken();
    router.push('/login');
  };

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-gray-200 flex flex-col">
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="text-xl font-bold text-white">
          MUSIKU<span className="text-brand-500">+</span>
        </div>
        <div className="text-xs text-gray-400 mt-1">Admin Dashboard</div>
      </div>
      <nav className="flex-1 py-4">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                active ? 'bg-gray-800 text-white border-r-2 border-brand-500' : 'hover:bg-gray-800/60'
              }`}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors">
          ↪ Logout
        </button>
      </div>
    </aside>
  );
}
