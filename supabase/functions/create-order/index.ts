import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type StoreProduct = {
  id: string;
  name: string;
  price: number | string;
  available: boolean;
};

const configuredOrigin = Deno.env.get('PUBLIC_SITE_ORIGIN') || 'https://kbhnights.vercel.app';
const allowedOrigins = new Set([configuredOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173']);
function getCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : configuredOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  const requestOrigin = request.headers.get('origin');
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, requestOrigin);
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) return respond({ error: 'This site is not allowed to submit orders.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rateLimitSecret = Deno.env.get('ORDER_RATE_LIMIT_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !rateLimitSecret) return respond({ error: 'Order service is not configured.' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid request body.' }, 400);
  }

  const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
  const customerPhone = '';
  const customerRoom = typeof body.customer_room === 'string' ? body.customer_room.trim() : '';
  const paymentMethod = body.payment_method;
  const requestedItems = body.items;

  if (!customerName || customerName.length > 100) return respond({ error: 'Enter your name.' }, 400);
  if (!/^[A-E]-(?:[1-9]|[1-9][0-9]|[1-5][0-9]{2}|600)$/.test(customerRoom)) {
    return respond({ error: 'Select a room block from A to E and a room number from 1 to 600.' }, 400);
  }
  if (paymentMethod !== 'cash' && paymentMethod !== 'upi') return respond({ error: 'Choose a supported payment method.' }, 400);
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 30) return respond({ error: 'Your bag is empty or has too many items.' }, 400);

  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!clientIp) return respond({ error: 'Could not verify this request. Refresh the page and try again.' }, 400);

  const itemQuantities = new Map<string, number>();
  for (const item of requestedItems) {
    if (!item || typeof item !== 'object') return respond({ error: 'Invalid product in your bag.' }, 400);
    const productId = (item as Record<string, unknown>).product_id;
    const quantity = (item as Record<string, unknown>).quantity;
    if (typeof productId !== 'string' || !/^[0-9a-f-]{36}$/i.test(productId)) return respond({ error: 'Invalid product in your bag.' }, 400);
    if (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99) return respond({ error: 'Invalid item quantity.' }, 400);
    itemQuantities.set(productId, (itemQuantities.get(productId) || 0) + Number(quantity));
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const rateLimitKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(rateLimitSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const ipHash = toHex(new Uint8Array(await crypto.subtle.sign('HMAC', rateLimitKey, new TextEncoder().encode(clientIp))));
  const { data: withinRateLimit, error: rateLimitError } = await supabase.rpc('consume_order_rate_limit', { p_ip_hash: ipHash, p_limit:600, p_window_seconds: 600 });
  if (rateLimitError) return respond({ error: 'Order service is temporarily unavailable.' }, 500);
  if (!withinRateLimit) return respond({ error: 'Too many order attempts. Please wait a few minutes and try again.' }, 429);

  const { data: settings, error: settingsError } = await supabase
    .from('store_settings')
    .select('is_open,accept_offline,accept_online,upi_id')
    .eq('id', true)
    .single();
  if (settingsError) return respond({ error: 'Store settings could not be loaded.' }, 500);
  if (!settings.is_open) return respond({ error: 'The store is currently closed.' }, 409);
  if (paymentMethod === 'cash' && !settings.accept_offline) return respond({ error: 'Cash at pickup is not currently accepted.' }, 409);
  if (paymentMethod === 'upi' && !settings.accept_online) return respond({ error: 'UPI payments are not currently accepted.' }, 409);
  if (paymentMethod === 'upi' && !settings.upi_id?.trim()) return respond({ error: 'UPI payment details are not configured.' }, 409);

  const productIds = [...itemQuantities.keys()];
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id,name,price,available')
    .in('id', productIds)
    .eq('available', true);
  if (productsError) return respond({ error: 'Products could not be validated.' }, 500);
  const availableProducts = products as StoreProduct[] | null;
  if (!availableProducts || availableProducts.length !== productIds.length) return respond({ error: 'One or more items are no longer available. Refresh your bag and try again.' }, 409);

  const productById = new Map<string, StoreProduct>(availableProducts.map((product): [string, StoreProduct] => [product.id, product]));
  const orderItems = productIds.map(productId => {
    const product = productById.get(productId)!;
    const quantity = itemQuantities.get(productId)!;
    const unitPriceCents = Math.round(Number(product.price) * 100);
    return {
      product_id: product.id,
      product_name: product.name,
      unit_price: (unitPriceCents / 100).toFixed(2),
      quantity,
      line_total: ((unitPriceCents * quantity) / 100).toFixed(2),
      lineTotalCents: unitPriceCents * quantity,
    };
  });
  const totalCents = orderItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const total = (totalCents / 100).toFixed(2);

  const initial = customerName.match(/[A-Za-z]/)?.[0]?.toUpperCase() || 'X';
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const { data: todayOrders, error: todayOrdersError } = await supabase
    .from('orders')
    .select('customer_name')
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());
  if (todayOrdersError) return respond({ error: 'Your order could not be saved.' }, 500);
  const sameInitialCount = (todayOrders || []).filter(order => {
    const orderInitial = String(order.customer_name || '').match(/[A-Za-z]/)?.[0]?.toUpperCase() || 'X';
    return orderInitial === initial;
  }).length;

  let createdOrder: { id: string; order_code: string } | null = null;
  let orderError: { message: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderCode = buildOrderCode(initial, sameInitialCount + attempt + 1);
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_code: orderCode,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_room: customerRoom,
        payment_method: paymentMethod,
        payment_status: paymentMethod === 'upi' ? 'pending' : 'unpaid',
        total,
      })
      .select('id,order_code')
      .single();
    if (error) {
      const isDuplicateCode = error.message?.toLowerCase().includes('duplicate') || error.message?.toLowerCase().includes('unique');
      if (isDuplicateCode && attempt < 4) continue;
      orderError = error;
      break;
    }
    createdOrder = data;
    break;
  }
  if (orderError || !createdOrder) return respond({ error: 'Your order could not be saved.' }, 500);

  const order = createdOrder;

  const { error: itemsError } = await supabase.from('order_items').insert(orderItems.map(({ lineTotalCents: _lineTotalCents, ...item }) => ({ ...item, order_id: order.id })));
  if (itemsError) {
    await supabase.from('orders').delete().eq('id', order.id);
    return respond({ error: 'Your order items could not be saved.' }, 500);
  }

  return respond({
    order_code: order.order_code,
    payment_method: paymentMethod,
    payment_status: paymentMethod === 'upi' ? 'pending' : 'unpaid',
    total,
    ...(paymentMethod === 'upi' ? {
      upi_id: settings.upi_id,
    } : {}),
  });
});

function buildOrderCode(initial: string, orderNumber: number) {
  return `${initial.toUpperCase()}-${String(orderNumber).padStart(3, '0')}`;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}