const team = [
  {
    name: 'Foster Johnson',
    role: 'Co-Founder',
    bio: 'Passionate about building tools that help people land their dream jobs.',
    initials: 'FJ',
  },
  {
    name: 'Damon Marcou',
    role: 'Co-Founder',
    bio: 'Driven to simplify the job search and make career growth accessible to everyone.',
    initials: 'DM',
  },
  {
    name: 'Raph Hay Tene',
    role: 'Co-Founder',
    bio: 'Focused on creating seamless experiences that connect talent with opportunity.',
    initials: 'RH',
  },
  {
    name: 'Drew Manson',
    role: 'Co-Founder',
    bio: 'Dedicated to empowering job seekers with the right tools and preparation.',
    initials: 'DW',
  },
];

const stats = [
  { label: 'Markets Monitored', value: '500+' },
  { label: 'Signal Accuracy', value: '92%' },
  { label: 'Wallets Tracked', value: '10K+' },
  { label: 'Data Points Daily', value: '1M+' },
];

export default function AboutPage() {
  return (
    <div className="bg-[#0d0d14] min-h-screen text-white">

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-12">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Meet the{' '}
            <span className="text-[#7c6af7]">Team</span>
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            We&apos;re building Clearline to make the signal behind prediction markets
            transparent, verifiable, and accessible to everyone.
          </p>
        </div>
      </div>

      {/* Team Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {team.map((member) => (
            <div
              key={member.name}
              className="bg-[#16162a] border border-[#2a2a45] rounded-2xl p-6 flex flex-col items-center text-center hover:border-[#7c6af7]/60 transition-all duration-200"
            >
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-[#7c6af7] to-[#4f46e5] flex items-center justify-center text-white text-xl font-bold mb-4 shadow-lg shadow-[#7c6af7]/20">
                {member.initials}
              </div>
              <h3 className="text-white font-semibold text-base mb-1">{member.name}</h3>
              <p className="text-[#7c6af7] text-sm font-medium mb-3">{member.role}</p>
              <p className="text-gray-400 text-sm leading-relaxed">{member.bio}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mission Section */}
      <div className="border-t border-[#2a2a45]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-5">
                Why we built{' '}
                <span className="text-[#7c6af7]">Clearline</span>
              </h2>
              <p className="text-gray-400 leading-relaxed mb-4">
                Prediction markets are increasingly cited as authoritative probability sources — by journalists,
                campaigns, and traders. But a market price is only as meaningful as the trading activity behind it.
              </p>
              <p className="text-gray-400 leading-relaxed">
                Clearline was built to answer one question:{' '}
                <span className="text-white font-medium">
                  &ldquo;Should I trust this prediction market price?&rdquo;
                </span>{' '}
                We analyze on-chain behavioral patterns to surface whether a price move reflects genuine collective
                belief or concentrated insider action.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#16162a] border border-[#2a2a45] rounded-2xl p-6 text-center"
                >
                  <div className="text-3xl font-bold text-[#7c6af7] mb-1">{stat.value}</div>
                  <div className="text-gray-400 text-sm">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
