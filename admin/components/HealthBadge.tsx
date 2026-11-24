export default function HealthBadge({ status }: { status: string }) {
  const cls =
    status === 'healthy'
      ? 'badge-green'
      : status === 'degraded'
        ? 'badge-yellow'
        : status === 'down'
          ? 'badge-red'
          : 'badge-gray';
  return <span className={`badge ${cls}`}>{status}</span>;
}
