'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Wallet, Bell, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

export function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (pathname.startsWith('/sign-in')) return null;

  const navigation = [
    { name: 'Terminal', href: '/', icon: Activity },
    { name: 'Wallet Tracker', href: '/wallets', icon: Wallet },
    { name: 'Alerts', href: '/alerts', icon: Bell },
  ];

  return (
    <header className="bg-[#0a0e17] border-b border-[rgba(255,255,255,0.08)] sticky top-0 z-40">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
                <Activity className="h-4.5 w-4.5 text-white" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-white tracking-tight text-lg">CLEARLINE</span>
                <span className="text-[#64748b] text-xs tracking-widest uppercase hidden sm:block">Terminal</span>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-0.5">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium tracking-wide uppercase transition-colors ${
                      isActive
                        ? 'bg-[#00d4ff]/10 text-[#00d4ff]'
                        : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="redirect">
                <button className="hidden md:block px-3 py-1.5 text-xs font-medium tracking-wide uppercase text-[#94a3b8] hover:text-white border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] rounded-md transition-colors">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/sign-in" />
            </SignedIn>
            <button className="hidden md:block px-3 py-1.5 text-xs font-bold tracking-wide uppercase text-[#080b12] bg-[#00d4ff] hover:bg-[#00bde0] rounded-md transition-colors">
              Upgrade Pro
            </button>

            <button
              className="lg:hidden p-2 text-[#94a3b8] hover:text-white hover:bg-white/5 rounded-md"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[rgba(255,255,255,0.08)] bg-[#0a0e17]">
          <nav className="px-4 py-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium tracking-wide uppercase transition-colors ${
                    isActive
                      ? 'bg-[#00d4ff]/10 text-[#00d4ff]'
                      : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <div className="pt-3 flex flex-col gap-2">
              <SignedOut>
                <SignInButton mode="redirect">
                  <button className="w-full px-4 py-2 text-xs font-medium tracking-wide uppercase text-[#94a3b8] border border-[rgba(255,255,255,0.1)] rounded-md">
                    Sign In
                  </button>
                </SignInButton>
              </SignedOut>
              <button className="w-full px-4 py-2 text-xs font-bold tracking-wide uppercase text-[#080b12] bg-[#00d4ff] rounded-md">
                Upgrade Pro
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
