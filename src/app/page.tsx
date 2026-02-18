"use client";

import "@/src/app/globals.css";

export default function Home() {
  return (
    <>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 mb-8 text-white">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold mb-3">
              The intelligence layer for prediction markets
            </h1>
            <p className="text-lg text-blue-100 mb-6">
              Decoding whether odds movements reflect real signal or just noise
              — across politics, crypto, economics, weather, and more. Every
              market move gets a confidence rating backed by on-chain behavioral
              analysis.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
