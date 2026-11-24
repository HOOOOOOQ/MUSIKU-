interface Props {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}

export default function StatCard({ label, value, sub, accent = 'text-gray-900' }: Props) {
  return (
    <div className="card">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
