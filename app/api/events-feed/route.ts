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

function toISO(dateStr: string): string | null {
  if (!dateStr) return null;
  return dateStr.slice(0, 10); // "YYYY-MM-DD"
}

function isWeekend(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const w = d.getDay(); // 0=Dom,6=Sab
  return w === 0 || w === 6;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = (url.searchParams.get('month') || new Date().toISOString().slice(0,7)) as string; // "YYYY-MM"
    const collectionHandle =
      url.searchParams.get('collection') ||
      process.env.EVENTS_COLLECTION_HANDLE; // es. "il-viaggio-incantato-del-natale"

    if (!collectionHandle) {
      return new Response(JSON.stringify({ error: 'Missing collection handle' }), { status: 400 });
    }

    // 1) prendi lo shop installato (token salvato alla installazione)
    const { rows } = await sql`SELECT shop, access_token FROM shops LIMIT 1`;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'No installed shop found' }), { status: 500 });
    }
    const { shop, access_token: token } = rows[0] as { shop: string; access_token: string };

    // 2) prova a leggere i festivi dal metafield di negozio (facoltativo)
    let holidays: string[] = [];
    try {
      const d = await gql(shop, token, `
        query {
          shop {
            metafield(namespace:"custom", key:"public_holidays"){ value }
          }
        }`);
      const raw = d?.shop?.metafield?.value as string | undefined;
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) holidays = arr.map((x: string) => toISO(x)).filter(Boolean) as string[];
        } catch {
          holidays = raw.split(/[,\s]+/).map(toISO).filter(Boolean) as string[];
        }
      }
    } catch { /* ok se non esiste */ }

    // 3) pagina i prodotti della collection
    const events: any[] = [];
    let cursor: string | null = null;

    do {
      const data = await gql(shop, token, `
        query Fetch($handle:String!, $cursor:String) {
          collection(handle:$handle){
            products(first: 100, after: $cursor) {
              edges {
                cursor
                node {
                  handle
                  tags
                  metafield(namespace:"custom", key:"event_date"){ value }
                  variants(first: 100) {
                    edges {
                      node {
                        id
                        title
                        availableForSale
                        inventoryQuantity
                        selectedOptions { name value }
                      }
                    }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `, { handle: collectionHandle, cursor });

      const edges = data?.collection?.products?.edges || [];
      const pageInfo = data?.collection?.products?.pageInfo;

      for (const e of edges) {
        const p = e.node;
        const iso = toISO(p?.metafield?.value);
        if (!iso) continue;
        if (iso.slice(0,7) !== month) continue;

        const tags = (p.tags || []).map((t: string) => String(t).toLowerCase());
        const hasTag = tags.includes('festivo');
        const inList = holidays.includes(iso);
        const day_type = (hasTag || inList || isWeekend(iso)) ? 'holiday' : 'weekday';

        let remaining = 0;
        const slots: any[] = [];
        for (const ve of (p.variants?.edges || [])) {
          const n = ve.node;
          const opt1 = (n.selectedOptions || []).find((o:any) => /option ?1/i.test(o.name))?.value || n.title;
          const qty = Math.max(0, Number(n.inventoryQuantity ?? 0));
          remaining += qty;
          if (opt1) {
            slots.push({
              label: opt1,
              id: Number(n.id.replace(/\D/g,'')),
              rem: qty,
              available: n.availableForSale
            });
          }
        }

        events.push({
          date: iso,
          handle: p.handle,
          day_type,
          available: remaining > 0,
          remaining,
          slots
        });
      }

      cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : null;
    } while (cursor);

    return new Response(JSON.stringify({ month, events }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}
