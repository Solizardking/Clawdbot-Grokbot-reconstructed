import { Text, View } from 'react-native'
import Svg, { Polyline, Line } from 'react-native-svg'
import type { Market } from '@/utils/clawd-api'
export function MarketChart({ market }: { market: Market }) {
  const rows = market.candles
    .filter((r) => Number.isFinite(r.close) && Number.isFinite(r.time) && r.close >= 0)
    .sort((a, b) => a.time - b.time)
  if (rows.length < 2) return <Text style={{ color: '#bcb2ca' }}>No chart history available.</Text>
  const lo = Math.min(...rows.map((r) => r.close)),
    hi = Math.max(...rows.map((r) => r.close)),
    span = hi - lo || Math.max(hi * 0.01, 1e-9)
  const points = rows
    .map(
      (r) =>
        `${8 + ((r.time - rows[0].time) / (rows.at(-1)!.time - rows[0].time || 1)) * 304},${112 - ((r.close - lo) / span) * 96}`,
    )
    .join(' ')
  return (
    <View accessible accessibilityLabel={`${market.symbol} hourly close prices; low ${lo} USD, high ${hi} USD.`}>
      <Svg width="100%" height={128} viewBox="0 0 320 128">
        <Line x1={8} y1={112} x2={312} y2={112} stroke="#3d304e" />
        <Polyline points={points} fill="none" stroke="#b490fa" strokeWidth={2} />
      </Svg>
      <Text style={{ color: '#bcb2ca', fontSize: 11 }}>Hourly closes · USD · missing intervals are not filled</Text>
    </View>
  )
}
