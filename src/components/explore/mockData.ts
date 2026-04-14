import type { Category, MapNode, MapEdge, MapGraph, ConnectedMarket } from './mapTypes';
import { computeRadius } from './mapConstants';

// Seeded pseudo-random for deterministic data
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

const MARKET_QUESTIONS: Record<Category, string[]> = {
  politics: [
    'Will Trump win the 2028 presidential election?',
    'Will Democrats win the Senate in 2028?',
    'Will Gavin Newsom run for President in 2028?',
    'Will Ron DeSantis win the Republican primary?',
    'PA Senate race — Democrat or Republican?',
    'GA Senate race — Democrat or Republican?',
    'Will the Supreme Court overturn Chevron?',
    'Will Biden endorse Newsom?',
    'AZ gubernatorial race — Dem or GOP?',
    'NV Senate race — Dem or GOP?',
    'Will AOC run for Senate in 2028?',
    'Will a third-party candidate get >5% in 2028?',
    'Will Congress pass the SAVE Act?',
    'TX gubernatorial race 2028',
    'Will Speaker Johnson keep the gavel?',
    'Will the House flip in 2028?',
    'MI Senate race — Dem or GOP?',
    'Will Trump face criminal sentencing before 2028?',
    'Will the filibuster be abolished?',
    'OH Senate race — Dem or GOP?',
    'Will Kamala Harris run again in 2028?',
    'WI gubernatorial race 2028',
    'Will RFK Jr. hold a cabinet position?',
    'NC Senate race 2028',
    'Will a Gen Z candidate win a Senate seat?',
  ],
  crypto: [
    'Will BTC be above $150K by Dec 2026?',
    'Will ETH reach $10K in 2026?',
    'Will Solana flip Ethereum in market cap?',
    'Will a Bitcoin spot ETF reach $100B AUM?',
    'Will the SEC approve a Solana ETF?',
    'Will Tether lose its peg in 2026?',
    'Will Dogecoin reach $1?',
    'Will Bitcoin halving cause a 50% rally?',
    'Will MicroStrategy buy more BTC in Q3?',
    'Will DeFi TVL exceed $500B?',
    'Will an altcoin flip BTC in daily volume?',
    'Will Coinbase stock hit $400?',
    'Will the EU ban proof-of-work mining?',
    'Will a CBDC launch in the US by 2027?',
    'Will NFT volume recover to 2021 levels?',
    'Will Ripple win its SEC appeal?',
    'Will Base become the #1 L2 by TVL?',
    'Will stablecoin market cap hit $300B?',
    'Will a major CEX go bankrupt in 2026?',
    'Will Bitcoin dominance drop below 40%?',
    'Will Ethereum complete its next major upgrade?',
    'Will AI tokens outperform BTC in 2026?',
    'Will Binance re-enter the US market?',
    'Will crypto total market cap hit $5T?',
    'Will a country adopt BTC as legal tender?',
  ],
  economics: [
    'Will the Fed cut rates in June 2026?',
    'Will US CPI drop below 2% in 2026?',
    'Will US GDP grow more than 3% in Q3?',
    'Will unemployment rise above 5%?',
    'Will the US enter a recession in 2026?',
    'Will the housing market crash 20%+?',
    'Will the 10-year yield drop below 3%?',
    'Will gold hit $3000/oz?',
    'Will consumer confidence index rise above 110?',
    'Will the trade deficit narrow in 2026?',
    'Will the dollar index fall below 95?',
    'Will student loan forgiveness pass?',
    'Will the national debt exceed $40T?',
    'Will oil drop below $50/barrel?',
    'Will the S&P 500 hit 6000?',
    'Will the VIX spike above 40 in 2026?',
    'Will a major bank fail in 2026?',
    'Will real wages grow faster than inflation?',
    'Will the Fed pause rate changes for 6+ months?',
    'Will US manufacturing PMI stay above 50?',
    'Will the yield curve un-invert in 2026?',
    'Will retail sales grow YoY in Q4?',
    'Will corporate earnings beat estimates in Q3?',
    'Will the ECB cut rates before the Fed?',
    'Will Japan end negative interest rates permanently?',
  ],
  geopolitics: [
    'Will there be a Ukraine ceasefire by Dec 2026?',
    'Will China invade Taiwan by 2028?',
    'Will Iran develop a nuclear weapon?',
    'Will North Korea conduct a nuclear test?',
    'Will the Israel-Palestine conflict see a peace deal?',
    'Will sanctions on Russia be lifted?',
    'Will Turkey leave NATO?',
    'Will there be a military coup in a G20 nation?',
    'Will the Red Sea shipping crisis resolve?',
    'Will the US impose new China tariffs?',
    'Will the Iran nuclear deal be revived?',
    'Will Venezuela hold free elections?',
    'Will the Arctic shipping route open year-round?',
    'Will a new BRICS currency launch?',
    'Will EU expand to include a new member?',
    'Will the South China Sea see a naval conflict?',
    'Will global military spending exceed $2.5T?',
    'Will a major cyberattack disrupt infrastructure?',
    'Will the US withdraw from a major alliance?',
    'Will India-Pakistan tensions escalate militarily?',
    'Will Africa see a new interstate conflict?',
    'Will the Suez Canal face another blockage?',
    'Will European gas prices drop below $25/MWh?',
    'Will a Middle East peace summit occur?',
    'Will the US-China trade war de-escalate?',
  ],
  culture: [
    'Will an AI-generated film win an Oscar?',
    'Will Taylor Swift announce a retirement?',
    'Will the next Marvel movie gross $1B?',
    'Will Elon Musk step down as CEO of X?',
    'Will a deepfake cause a major scandal?',
    'Will TikTok be banned in the US?',
    'Will the NYT paywall pass 20M subscribers?',
    'Will a streaming service merge with another?',
    'Will AGI be declared achieved by 2027?',
    'Will Apple release AR glasses?',
    'Will a celebrity run for political office?',
    'Will the Grammys change their voting process?',
    'Will a major social media platform shut down?',
    'Will lab-grown meat go mainstream?',
    'Will a space tourist reach Mars orbit?',
    'Will OpenAI go public?',
    'Will the SAG-AFTRA strike happen again?',
    'Will print newspapers go fully digital?',
    'Will VR headsets outsell consoles?',
    'Will a podcast surpass 1B total downloads?',
    'Will college enrollment decline 10%+?',
    'Will a universal basic income trial launch in the US?',
    'Will the Met Gala be canceled?',
    'Will autonomous vehicles be legal in all 50 states?',
    'Will Threads surpass Twitter/X in users?',
  ],
};

function generateNodes(): MapNode[] {
  const nodes: MapNode[] = [];
  const categories: Category[] = ['politics', 'crypto', 'economics', 'geopolitics', 'culture'];

  for (const cat of categories) {
    const questions = MARKET_QUESTIONS[cat];
    for (let i = 0; i < questions.length; i++) {
      // Log-distributed volume: mostly small, a few large
      const volExponent = rand() * 5 + 2.7; // 10^2.7 to 10^7.7 (~$500 to ~$50M)
      const totalVolume = Math.round(Math.pow(10, volExponent));
      const volume24h = Math.round(totalVolume * (rand() * 0.15 + 0.01));
      const probability = Math.round((rand() * 80 + 10)) / 100; // 0.10 - 0.90
      const change = (rand() - 0.5) * 0.2; // -10% to +10%

      const label = questions[i].length > 36 ? questions[i].slice(0, 36) + '...' : questions[i];

      nodes.push({
        id: `${cat}-${i}`,
        label,
        fullLabel: questions[i],
        category: cat,
        probability,
        volume24h,
        totalVolume,
        liquidity: Math.round(totalVolume * (rand() * 0.3 + 0.05)),
        change24h: Math.round(change * 10000) / 10000,
        smartWalletCount: Math.floor(rand() * 40 + 2),
        insiderCount: Math.floor(rand() * 6),
        signal: rand() > 0.6 ? 'BUY' : rand() > 0.3 ? 'NEUTRAL' : 'SELL',
        endDate: new Date(Date.now() + rand() * 180 * 86400000).toISOString(),
        radius: computeRadius(totalVolume),
      });
    }
  }

  return nodes;
}

function generateEdges(nodes: MapNode[]): MapEdge[] {
  const edges: MapEdge[] = [];
  const seen = new Set<string>();

  const byCategory = new Map<Category, MapNode[]>();
  for (const n of nodes) {
    const arr = byCategory.get(n.category) || [];
    arr.push(n);
    byCategory.set(n.category, arr);
  }

  // Intra-category edges (~240)
  for (const [, catNodes] of byCategory) {
    for (let i = 0; i < catNodes.length; i++) {
      // Each node connects to 2-5 others in same category
      const numEdges = Math.floor(rand() * 4) + 2;
      for (let e = 0; e < numEdges; e++) {
        const j = Math.floor(rand() * catNodes.length);
        if (j === i) continue;
        const key = [catNodes[i].id, catNodes[j].id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: catNodes[i].id,
          target: catNodes[j].id,
          weight: rand() * 0.6 + 0.3,
          type: 'same-category',
        });
      }
    }
  }

  // Cross-category bridges (~60)
  for (let i = 0; i < 60; i++) {
    const a = nodes[Math.floor(rand() * nodes.length)];
    let b = nodes[Math.floor(rand() * nodes.length)];
    let attempts = 0;
    while (b.category === a.category && attempts < 10) {
      b = nodes[Math.floor(rand() * nodes.length)];
      attempts++;
    }
    if (b.category === a.category) continue;

    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source: a.id,
      target: b.id,
      weight: rand() * 0.3 + 0.1,
      type: rand() > 0.5 ? 'shared-wallet' : 'correlated',
    });
  }

  return edges;
}

let cachedGraph: MapGraph | null = null;

export function getMockGraph(): MapGraph {
  if (cachedGraph) return cachedGraph;
  const nodes = generateNodes();
  const edges = generateEdges(nodes);
  cachedGraph = { nodes, edges };
  return cachedGraph;
}

export function getMockConnected(nodeId: string, graph: MapGraph): ConnectedMarket[] {
  const connected: ConnectedMarket[] = [];
  for (const edge of graph.edges) {
    const otherId = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
    if (!otherId) continue;
    const other = graph.nodes.find((n) => n.id === otherId);
    if (!other) continue;
    connected.push({
      id: other.id,
      label: other.fullLabel,
      category: other.category,
      probability: other.probability,
      overlapStrength: edge.weight,
    });
  }
  return connected.sort((a, b) => b.overlapStrength - a.overlapStrength).slice(0, 15);
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
