"use client";

import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { mockNewsStories, mockMarkets } from "../../data/mockData";
import { ConfidenceBadge } from "../../components/ConfidenceBadge";
import { formatDistanceToNow } from "date-fns";

export default function NewsFeed() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Clearline Daily
        </h1>
        <p className="text-gray-600">
          Expert analysis of prediction market movements across politics,
          crypto, economics, and more — what moved, why it moved, and whether
          you should believe it
        </p>
      </div>

      {/* Newsletter Signup */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 mb-8 text-white">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-semibold mb-2">
              Get Clearline Daily in your inbox
            </h2>
            <p className="text-blue-100">
              3–5 interpreted market stories delivered every morning, free.
            </p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <input
              type="email"
              placeholder="your@email.com"
              className="flex-1 md:w-64 px-4 py-2 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button className="px-6 py-2 bg-white text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap">
              Subscribe
            </button>
          </div>
        </div>
      </div>

      {/* Stories */}
      <div className="space-y-6">
        {mockNewsStories.map((story) => {
          const market = mockMarkets.find((m) => m.id === story.marketId);

          return (
            <article
              key={story.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4 mb-4">
                <ConfidenceBadge confidence={story.confidence} size="sm" />
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4" />
                  {formatDistanceToNow(story.timestamp, { addSuffix: true })}
                </div>
                <div className="ml-auto text-sm text-gray-500">
                  {story.readTime} min read
                </div>
              </div>

              <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                {story.title}
              </h2>

              <p className="text-gray-700 mb-4 leading-relaxed">
                {story.summary}
              </p>

              {market && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Market</div>
                      <div className="font-medium text-gray-900">
                        {market.title}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500 mb-1">
                        Current Odds
                      </div>
                      <div className="text-2xl font-semibold text-gray-900">
                        {(market.currentOdds * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-500">By {story.author}</div>
                <Link
                  href={`/market/${story.marketId}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  View full diagnostic
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>

              {/* Paywall Hint */}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-900">
                    <strong>Pro subscribers</strong> get access to full wallet
                    breakdowns and historical data
                  </p>
                  <button className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
                    Upgrade
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Load More */}
      <div className="mt-8 text-center">
        <button className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Load more stories
        </button>
      </div>
    </div>
  );
}
