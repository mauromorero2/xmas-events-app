// lib/shopify-admin.ts
const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const token  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const ver    = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-07';

export async function shopifyAdminGraphQL<T>(query: string, variables?: any): Promise<T> {
  if (!domain || !token) {
    throw new Error('Missing env: SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN');
  }

  const res = await fetch(`https://${domain}/admin/api/${ver}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
    // su Vercel è già Node 18+, fetch è nativa
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Admin API ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}
