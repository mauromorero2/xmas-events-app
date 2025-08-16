export const runtime = 'nodejs';

import { sql } from '@/lib/db';

type GQL = (shop: string, token: string, query: string, vars?: Record<string, any>) => Promise<any>;
const API_VERSION = '2024-07';

const gql: GQL = async (shop, token, query, vars = {}) => {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      'Accept': 'application/json'
    },
    body: JSON.stringify({ query, variables: vars })
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};

function normalizePricing(input?: string){
  let j: any;
  try { j = input ? JSON.parse(input) : null; } catch { j = null; }

  const currency = (j?.currency || 'EUR').toUpperCase();

  function normSide(side: any, fallbackMode: 'single'|'tiered'){
    const mode: 'single'|'tiered' = (side?.mode === 'tiered') ? 'tiered' : 'single';

    if (mode === 'single') {
      const p = Number(side?.single?.price ?? side?.price ?? 0);
      return { mode: 'single', prices: { 'Normale': isNaN(p) ? 0 : p } };
    } else {
      const src = side?.tiered || {};
      const map: Record<string, number> = {};
      ['Intero','Bambino','Handicap'].forEach(k => {
        const v = Number(src[k]);
        if (!isNaN(v)) map[k] = v;
      });
      // se non troviamo nulla, fallback single=0
      if (Object.keys(map).length === 0) return { mode: 'single', prices: { 'Normale': 0 } };
      return { mode: 'tiered', prices: map };
    }
  }

  return {
    version: 1,
    currency,
    weekday: normSide(j?.weekday, 'single'),
    holiday: normSide(j?.holiday, 'tiered')
  };
}

export async function GET() {
  try {
    const { rows } = await sql`SELECT shop, access_token FROM shops LIMIT 1`;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'No installed shop found' }), { status: 500 });
    }
    const { shop, access_token: token } = rows[0] as { shop: string; access_token: string };

    const data = await gql(shop, token, `
      query {
        shop {
          metafield(namespace:"custom", key:"ticket_pricing"){ value }
        }
      }
    `);

    const raw = data?.shop?.metafield?.value as string | undefined;
    const cfg = normalizePricing(raw);

    return new Response(JSON.stringify(cfg), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}
