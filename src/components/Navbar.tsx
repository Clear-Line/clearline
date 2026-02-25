'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Wallet, Newspaper, Bell, BarChart3, Users, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

export function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (pathname.startsWith('/sign-in')) return null;

  const navigation = [
    { name: 'Live Markets', href: '/', icon: Activity },
    { name: 'Wallet Tracker', href: '/wallets', icon: Wallet },
    { name: 'News Feed', href: '/news', icon: Newspaper },
    { name: 'Alerts', href: '/alerts', icon: Bell },
    { name: 'Accuracy Tracker', href: '/accuracy', icon: BarChart3 },
    { name: 'About Us', href: '/about', icon: Users },
  ];

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-xl">Clearline</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="redirect">
                <button className="hidden md:block px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <button className="hidden md:block px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                Upgrade to Pro
              </button>
              <UserButton afterSignOutUrl="/sign-in" />
            </SignedIn>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <nav className="px-4 py-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <div className="pt-3 space-y-2">
              <SignedOut>
                <SignInButton mode="redirect">
                  <button className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg">
                    Sign in
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <button className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg">
                  Upgrade to Pro
                </button>
                <div className="flex justify-center pt-1">
                  <UserButton afterSignOutUrl="/sign-in" />
                </div>
              </SignedIn>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
