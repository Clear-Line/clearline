'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Menu, X, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

export function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (pathname.startsWith('/sign-in')) return null;
  if (pathname.startsWith('/explore')) return null;

  const navigation = [
    { name: 'Dashboard', href: '/terminal' },
    { name: 'Wallets', href: '/wallets' },
    { name: 'Alerts', href: '/alerts' },
    { name: 'Crypto', href: '/crypto' },
    { name: 'Pricing', href: '/pricing' },
    { name: 'Case Studies', href: '/case-studies' },
  ];

  return (
    <header className="bg-[#04040B]/80 backdrop-blur-md border-b border-white/[0.06] sticky top-0 z-40">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
                <Activity className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-bold text-white tracking-tight text-lg">clearline</span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-[#94a3b8] hover:text-white'
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="redirect">
                <button className="hidden md:block px-3 py-1.5 text-[13px] font-medium text-[#94a3b8] hover:text-white transition-colors">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/sign-in" />
            </SignedIn>
            <Link
              href="/explore"
              className="hidden md:inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-bold text-[#04040B] bg-[#00d4ff] hover:bg-[#22ddff] rounded-md transition-colors"
            >
              Launch App
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

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
        <div className="lg:hidden border-t border-white/[0.06] bg-[#04040B]">
          <nav className="px-4 py-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white bg-white/5'
                      : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
            <div className="pt-3 flex flex-col gap-2">
              <SignedOut>
                <SignInButton mode="redirect">
                  <button className="w-full px-4 py-2 text-sm font-medium text-[#94a3b8] border border-white/10 rounded-md">
                    Sign In
                  </button>
                </SignInButton>
              </SignedOut>
              <Link
                href="/explore"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full px-4 py-2 text-center text-sm font-bold text-[#04040B] bg-[#00d4ff] rounded-md"
              >
                Launch App
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
