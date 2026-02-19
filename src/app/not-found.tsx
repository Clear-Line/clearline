import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 bg-gray-100 rounded-full mb-6">
          <AlertCircle className="h-8 w-8 text-gray-600" />
        </div>
        <h1 className="text-4xl font-semibold text-gray-900 mb-3">Page not found</h1>
        <p className="text-gray-600 mb-8 max-w-md mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
