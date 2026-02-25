import { Bell, Plus, Trash2, Mail, Smartphone } from "lucide-react";
import { ConfidenceBadge } from "../../components/ConfidenceBadge";

const mockAlerts = [
  {
    id: "1",
    name: "Michigan Senate high-confidence moves",
    description:
      "Alert me when Michigan Senate market has a high-confidence move",
    type: "market",
    channel: "email",
    enabled: true,
  },
  {
    id: "2",
    name: "Top wallet activity",
    description: "Alert me when wallet w-4d5e6f enters a new position",
    type: "wallet",
    channel: "push",
    enabled: true,
  },
  {
    id: "3",
    name: "Presidential markets volume spikes",
    description:
      "Alert me when any presidential market has a volume spike >$1M",
    type: "volume",
    channel: "email",
    enabled: false,
  },
];

export default function Alerts() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Alert System
        </h1>
        <p className="text-gray-600">
          Configure custom alerts for market movements, wallet activity, and
          volume spikes
        </p>
      </div>

      {/* Pro Feature Lock */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-8 mb-8 text-white text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 bg-white/20 rounded-full mb-4">
          <Bell className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-semibold mb-3">
          Custom alerts are a Pro feature
        </h2>
        <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
          Upgrade to Clearline Pro to receive instant notifications when
          high-confidence moves happen, when specific wallets trade, or when
          markets experience unusual volume.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button className="px-8 py-3 bg-white text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors">
            Upgrade to Pro — $30/month
          </button>
          <button className="px-8 py-3 bg-transparent border-2 border-white text-white font-medium rounded-lg hover:bg-white/10 transition-colors">
            View Pro features
          </button>
        </div>
      </div>

      {/* Alert Configuration Preview */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Your Alerts</h2>
            <button
              disabled
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-400 font-medium rounded-lg cursor-not-allowed"
            >
              <Plus className="h-4 w-4" />
              Create alert
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-200">
          {mockAlerts.map((alert) => (
            <div key={alert.id} className="p-6 opacity-50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-medium text-gray-900">{alert.name}</h3>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        alert.enabled
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {alert.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    {alert.description}
                  </p>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1 text-gray-500">
                      {alert.channel === "email" ? (
                        <Mail className="h-4 w-4" />
                      ) : (
                        <Smartphone className="h-4 w-4" />
                      )}
                      <span className="capitalize">{alert.channel}</span>
                    </div>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-500 capitalize">
                      {alert.type} alert
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled
                    className="p-2 text-gray-300 hover:bg-gray-50 rounded-lg transition-colors cursor-not-allowed"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert Types Info */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <ConfidenceBadge confidence="high" size="sm" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Market Moves</h3>
          <p className="text-sm text-gray-600">
            Get notified when markets you care about have high-confidence
            movements
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-10 w-10 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <Bell className="h-5 w-5 text-green-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Wallet Activity</h3>
          <p className="text-sm text-gray-600">
            Track when specific high-accuracy wallets enter new positions
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-10 w-10 bg-yellow-100 rounded-lg flex items-center justify-center mb-4">
            <Bell className="h-5 w-5 text-yellow-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Volume Spikes</h3>
          <p className="text-sm text-gray-600">
            Be alerted when markets experience unusual trading volume
          </p>
        </div>
      </div>
    </div>
  );
}
