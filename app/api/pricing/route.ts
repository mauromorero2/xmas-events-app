export const runtime = 'nodejs';

import { shopifyAdminGraphQL as gql } from '@/lib/shopify-admin';
import { sql } from '@/lib/db';

/**
 * Normalizza il JSON prezzi in una forma stabile per storefront e function:
 * {
 *   version: 1,
 *   currency: 'EUR',
 *   weekday: { mode: 'single' | 'tiered', prices: { ... } },
 *   holiday: { mode: 'single' | 'tiered', prices: { ... } }
 * }
 */
function normalizePricing(input?: string) {
  let j: any;
  try { j = input ? JSON.parse(input) : null; } catch { j = null; }

  const currency = (j?.currency || 'EUR').toUpperCase();

  function normSide(side: any, _fallback: 'single'|'tiered') {
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

/** Accetta un oggetto JS e lo porta nella stessa forma del normalizePricing */
function normalizeFromObject(obj: any) {
  // Semplicemente serializziamo e riutilizziamo la stessa logica
  return normalizePricing(JSON.stringify(obj || {}));
}

/* =========================
   GET /api/pricing
   ========================= */
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

/* =========================
   PUT /api/pricing
   Body JSON: forma "admin" o già normalizzata.
   Salva in shop.metafields (namespace "custom", key "ticket_pricing", type "json")
   ========================= */
export async function PUT(req: Request) {
  try {
    // 1) leggi body
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    // 2) normalizza e fai qualche guardia minima
    const cfg = normalizeFromObject(body);
    if (!cfg || !cfg.currency || !cfg.weekday || !cfg.holiday) {
      return new Response(JSON.stringify({ error: 'Invalid pricing config' }), { status: 400 });
    }

    // 3) shop + token
    const { rows } = await sql`SELECT shop, access_token FROM shops LIMIT 1`;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'No installed shop found' }), { status: 500 });
    }
    const { shop, access_token: token } = rows[0] as { shop: string; access_token: string };

    // 4) id dello shop (ownerId per metafieldsSet)
    const q = await gql(shop, token, `query { shop { id } }`);
    const shopId = q?.shop?.id;
    if (!shopId) {
      return new Response(JSON.stringify({ error: 'Cannot resolve shop id' }), { status: 500 });
    }

    // 5) salvataggio metafield (type: json)
    const value = JSON.stringify(cfg);
    const mut = await gql(shop, token, `
      mutation SavePricing($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key namespace type value }
          userErrors { field message code }
        }
      }
    `, {
      metafields: [{
        namespace: "custom",
        key: "ticket_pricing",
        type: "json",
        value,
        ownerId: shopId
      }]
    });

    const errs = mut?.metafieldsSet?.userErrors || [];
    if (errs.length) {
      return new Response(JSON.stringify({ error: errs[0]?.message || 'metafieldsSet error', details: errs }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, pricing: cfg }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}

/* =========================
   OPTIONS (CORS)
   ========================= */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
