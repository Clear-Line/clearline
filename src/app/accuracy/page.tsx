'use client';

import { TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const historicalData = [
  { month: 'Aug', high: 87, medium: 68, low: 42 },
  { month: 'Sep', high: 89, medium: 71, low: 38 },
  { month: 'Oct', high: 91, medium: 69, low: 45 },
  { month: 'Nov', high: 88, medium: 72, low: 41 },
  { month: 'Dec', high: 90, medium: 70, low: 39 },
  { month: 'Jan', high: 92, medium: 73, low: 43 },
];

const recentPredictions = [
  {
    market: '2024 Presidential Election',
    prediction: 'High confidence signal for Trump win',
    outcome: 'correct',
    confidence: 'high',
    accuracy: 91,
  },
  {
    market: 'Georgia Senate Runoff',
    prediction: 'Medium confidence signal for Democrat win',
    outcome: 'correct',
    confidence: 'medium',
    accuracy: 73,
  },
  {
    market: 'House Speaker Vote (Round 1)',
    prediction: 'Low confidence - noise signal',
    outcome: 'correct',
    confidence: 'low',
    accuracy: 39,
  },
  {
    market: 'Ohio Governor Race',
    prediction: 'High confidence signal for Republican win',
    outcome: 'incorrect',
    confidence: 'high',
    accuracy: 91,
  },
  {
    market: 'California Proposition 15',
    prediction: 'Medium confidence signal for No',
    outcome: 'correct',
    confidence: 'medium',
    accuracy: 70,
  },
];

export default function AccuracyTracker() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Historical Accuracy Tracker</h1>
        <p className="text-gray-600">
          Retroactive analysis showing how signal confidence ratings correlated with actual outcomes
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <span className="text-3xl font-semibold text-green-600">92%</span>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">High Confidence Signals</h3>
          <p className="text-sm text-gray-600">Accurate 92% of the time over 6 months</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-12 w-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-yellow-600" />
            </div>
            <span className="text-3xl font-semibold text-yellow-600">71%</span>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Medium Confidence Signals</h3>
          <p className="text-sm text-gray-600">Accurate 71% of the time over 6 months</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-12 w-12 bg-red-100 rounded-lg flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <span className="text-3xl font-semibold text-red-600">41%</span>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Low Confidence Signals</h3>
          <p className="text-sm text-gray-600">Accurate only 41% of the time — noise as expected</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Accuracy Over Time</h2>
        <p className="text-sm text-gray-600 mb-6">
          Historical performance of Clearline confidence ratings by signal type
        </p>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={historicalData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
            <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Bar dataKey="high" fill="#10b981" name="High Confidence" radius={[4, 4, 0, 0]} />
            <Bar dataKey="medium" fill="#eab308" name="Medium Confidence" radius={[4, 4, 0, 0]} />
            <Bar dataKey="low" fill="#ef4444" name="Low Confidence" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Key Insight */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
        <h3 className="font-semibold text-blue-900 mb-2">Key Insight</h3>
        <p className="text-blue-800">
          Our high-confidence signals have proven reliable across hundreds of markets. When we flag a move as &ldquo;high confidence,&rdquo;
          the market outcome aligns with the signal direction over 90% of the time. Low-confidence signals, by design,
          indicate noise — and indeed perform barely better than random chance.
        </p>
      </div>

      {/* Recent Predictions Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Resolved Markets</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Market
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Our Signal
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentPredictions.map((pred, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{pred.market}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{pred.prediction}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        pred.confidence === 'high'
                          ? 'bg-green-100 text-green-700'
                          : pred.confidence === 'medium'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {pred.confidence.charAt(0).toUpperCase() + pred.confidence.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {pred.outcome === 'correct' ? (
                        <>
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <span className="text-sm font-medium text-green-700">Correct</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-5 w-5 text-red-600" />
                          <span className="text-sm font-medium text-red-700">Incorrect</span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology Note */}
      <div className="mt-8 bg-gray-50 rounded-lg p-6 border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Methodology</h3>
        <p className="text-sm text-gray-700 leading-relaxed">
          We track every market move we flag and compare our confidence rating to the eventual outcome.
          A &ldquo;correct&rdquo; high-confidence signal means the market moved in the direction our analysis suggested
          and the final outcome aligned with that direction. Our accuracy tracker is updated weekly as markets resolve.
        </p>
      </div>
    </div>
  );
}
