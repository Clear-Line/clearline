import { ConstellationMap } from '@/components/explore/ConstellationMap';

export const metadata = {
  title: 'Explore - Clearline',
  description: 'Interactive constellation map of the prediction market ecosystem.',
};

export default function ExplorePage() {
  return <ConstellationMap />;
}
