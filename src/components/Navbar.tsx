"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

const navItems = [
  { label: "Live Markets", href: "/live-markets", icon: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )},
  { label: "Wallet Tracker", href: "/wallet-tracker", icon: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M16 12h2" />
      <path d="M2 10h20" />
    </svg>
  )},
  { label: "News Feed", href: "/news-feed", icon: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" />
    </svg>
  )},
  { label: "Alerts", href: "/alerts", icon: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )},
  { label: "Accuracy Tracker", href: "/accuracy-tracker", icon: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )},
];

interface NavbarProps {
  isLoggedIn?: boolean;
  onAuthAction?: () => void;
}

export default function Navbar({ isLoggedIn = false, onAuthAction }: NavbarProps) {
  const [activeItem, setActiveItem] = useState<string | null>("Live Markets");
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="w-full border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 group">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm group-hover:bg-blue-700 transition-colors">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              </svg>
            </div>
            <span className="text-[17px] font-semibold text-gray-900 tracking-tight">Clearline</span>
          </Link>

          {/* Desktop Nav Items */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setActiveItem(item.label)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150
                  ${activeItem === item.label
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                  }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={onAuthAction}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-3 py-2 rounded-lg hover:bg-gray-50"
            >
              {isLoggedIn ? "Sign out" : "Sign in"}
            </button>
            {!isLoggedIn && (
              <button className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 rounded-full shadow-sm">
                Upgrade to Pro
              </button>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 pt-2 space-y-1 border-t border-gray-100 mt-1">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => { setActiveItem(item.label); setMobileOpen(false); }}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${activeItem === item.label
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            <div className="pt-2 flex items-center gap-2 border-t border-gray-100 mt-2">
              <button
                onClick={onAuthAction}
                className="flex-1 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                {isLoggedIn ? "Sign out" : "Sign in"}
              </button>
              {!isLoggedIn && (
                <button className="flex-1 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors py-2 rounded-full">
                  Upgrade to Pro
                </button>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
