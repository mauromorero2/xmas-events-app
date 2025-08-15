export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7);
  const sample = [
    {
      date: `${month}-20`,
      handle: 'evento-20',
      day_type: 'weekday',
      available: true,
      remaining: 260,
      slots: [
        { label: '14:00', id: 11111111111111, rem: 50, available: true },
        { label: '14:30', id: 22222222222222, rem: 10, available: true },
        { label: '15:00', id: 33333333333333, rem: 0,  available: false }
      ]
    }
  ];
  return new Response(JSON.stringify({ month, events: sample }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
