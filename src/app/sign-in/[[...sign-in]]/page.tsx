import { SignIn } from '@clerk/nextjs';
import { Activity } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-8">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <span className="font-semibold text-xl">Clearline</span>
      </div>
      <SignIn />
    </div>
  );
}
