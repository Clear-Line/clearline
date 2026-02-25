'use client';

import { usePathname } from 'next/navigation';
import { Activity } from 'lucide-react';

export function AppFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/sign-in')) return null;

  return (
    <footer className="bg-white border-t border-gray-200 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 bg-blue-600 rounded flex items-center justify-center">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold">Clearline</span>
          </div>
          <div className="text-sm text-gray-500">
            The intelligence layer for prediction markets
          </div>
        </div>
      </div>
    </footer>
  );
}
