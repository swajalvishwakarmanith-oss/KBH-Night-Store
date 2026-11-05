import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ImagePlus, LogOut, MapPin, Minus, MoonStar, Pencil, Plus, Power, Search, ShoppingBag, Store, Trash2, Upload, X } from 'lucide-react';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

const formatPrice = value => `₹${Number(value).toFixed(2).replace(/\.00$/, '')}`;

function readSavedCart() {
  try {
    const savedCart = JSON.parse(window.localStorage.getItem('kbh-night-store-cart') || '{}');
    if (!savedCart || Array.isArray(savedCart) || typeof savedCart !== 'object') return {};
    return Object.fromEntries(Object.entries(savedCart).filter(([, quantity]) => Number.isSafeInteger(quantity) && quantity > 0));
  } catch {
    return {};
  }
}

function BrandHeader({ admin = false, storeOpen = null, cartCount = 0, onOpenCart }) {
  const statusText = storeOpen === null ? 'Store status unavailable' : storeOpen ? 'Open · accepting visitors' : 'Closed · not accepting visitors';
  return (
    <header className="site-header">
      <a className="brand" href="#store" aria-label="KBH Night Store home">KBH NIGHTS</a>
      <nav className="header-nav" aria-label="Main navigation">
        {admin ? <a href="#store">Storefront</a> : <a href="#admin">Admin</a>}
        <span className={`open-label ${storeOpen === false ? 'is-closed' : ''}`}><span className="open-dot" /> {statusText}</span>
        {!admin && <button className="cart-trigger" type="button" onClick={onOpenCart} aria-label={`Open bag, ${cartCount} items`}><ShoppingBag size={17} aria-hidden="true" /><span>Bag</span><span className="cart-count">{cartCount}</span></button>}
      </nav>
    </header>
  );
}

function Storefront() {
  const [products, setProducts] = useState([]);
  const [pickupRoom, setPickupRoom] = useState('');
  const [storeOpen, setStoreOpen] = useState(null);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [cart, setCart] = useState(readSavedCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartMessage, setCartMessage] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [orderConfirmation, setOrderConfirmation] = useState(null);
  const [acceptOffline, setAcceptOffline] = useState(false);
  const [acceptOnline, setAcceptOnline] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState('cash');
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySearched, setHistorySearched] = useState(false);
  const [historyOrderId, setHistoryOrderId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    async function loadStore() {
      const [productResult, settingsResult] = await Promise.all([
        supabase.from('products').select('id,name,price,category,description,image_url,available,sort_order').eq('available', true).order('sort_order').order('created_at', { ascending: false }),
        supabase.from('store_settings').select('pickup_room,is_open,accept_offline,accept_online,upi_id').eq('id', true).maybeSingle(),
      ]);
      if (!active) return;
      if (productResult.error) setError(`Products could not be loaded: ${productResult.error.message}`);
      else {
        setProducts(productResult.data || []);
        setProductsLoaded(true);
      }
      if (settingsResult.error) setError(current => current || `Pickup details could not be loaded: ${settingsResult.error.message}`);
      else {
        setPickupRoom(settingsResult.data?.pickup_room || '');
        setStoreOpen(settingsResult.data?.is_open ?? true);
        setAcceptOffline(settingsResult.data?.accept_offline ?? false);
        setAcceptOnline(settingsResult.data?.accept_online ?? false);
        setUpiId(settingsResult.data?.upi_id || '');
      }
      setLoading(false);
    }
    const statusChannel = supabase.channel('storefront-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'store_settings', filter: 'id=eq.true' }, payload => {
        setPickupRoom(payload.new.pickup_room || '');
        setStoreOpen(payload.new.is_open ?? true);
        setAcceptOffline(payload.new.accept_offline ?? false);
        setAcceptOnline(payload.new.accept_online ?? false);
        setUpiId(payload.new.upi_id || '');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadStore)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') loadStore();
      });
    loadStore();
    return () => { active = false; supabase.removeChannel(statusChannel); };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('kbh-night-store-cart', JSON.stringify(cart));
    } catch {
      setCartMessage('Your browser could not save the bag between visits.');
    }
  }, [cart]);

  useEffect(() => {
    if (!supabase) return;
    const savedOrderCode = window.localStorage.getItem('kbh-last-order-id');
    if (!savedOrderCode) return;
    setHistoryOrderId(savedOrderCode);
    loadOrderByCode(savedOrderCode, { silent: true });
  }, []);

  useEffect(() => {
    if (!productsLoaded) return;
    const availableIds = new Set(products.map(product => product.id));
    setCart(current => Object.fromEntries(Object.entries(current).filter(([productId, quantity]) => availableIds.has(productId) && quantity > 0)));
  }, [products, productsLoaded]);

  useEffect(() => {
    if (!cartOpen && !checkoutOpen && !orderConfirmation) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setCartOpen(false);
        setCheckoutOpen(false);
        setOrderConfirmation(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [cartOpen, checkoutOpen, orderConfirmation]);

  const categories = useMemo(() => ['All', ...new Set(products.map(product => product.category).filter(Boolean))], [products]);
  const visibleProducts = useMemo(() => products.filter(product =>
    (category === 'All' || product.category === category) &&
    `${product.name} ${product.category || ''} ${product.description || ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ), [products, category, search]);
  const cartLines = useMemo(() => products.filter(product => cart[product.id] > 0).map(product => ({ ...product, quantity: cart[product.id] })), [products, cart]);
  const cartCount = cartLines.reduce((total, product) => total + product.quantity, 0);
  const cartSubtotal = cartLines.reduce((total, product) => total + Number(product.price) * product.quantity, 0);
  const canPayOnline = acceptOnline && Boolean(upiId.trim());

  function addToCart(product) {
    if (!storeOpen) return;
    setCart(current => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }));
    setCartMessage(`${product.name} added to your bag.`);
    const button = document.querySelector(`[data-product-id="${product.id}"]`);
    if (button) {
      button.classList.remove('cart-added-bounce');
      void button.offsetWidth;
      button.classList.add('cart-added-bounce');
      setTimeout(() => button.classList.remove('cart-added-bounce'), 420);
    }
    const cartButton = document.querySelector('.cart-trigger');
    if (cartButton) {
      cartButton.classList.remove('cart-pill-pop');
      void cartButton.offsetWidth;
      cartButton.classList.add('cart-pill-pop');
      setTimeout(() => cartButton.classList.remove('cart-pill-pop'), 420);
    }
  }

  function changeCartQuantity(productId, delta) {
    setCart(current => {
      const quantity = (current[productId] || 0) + delta;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: quantity };
    });
  }

  function startCheckout() {
    if (cartLines.length === 0 || storeOpen !== true || (!acceptOffline && !canPayOnline)) return;
    setCheckoutPaymentMethod(acceptOffline ? 'cash' : 'upi');
    setCheckoutError('');
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!supabase || cartLines.length === 0) return;
    setCheckoutBusy(true);
    setCheckoutError('');
    const formData = new FormData(event.currentTarget);
    const customerRoom = `${formData.get('customer_block')}-${formData.get('customer_room_number')}`;
    const items = cartLines.map(product => ({ product_id: product.id, quantity: product.quantity }));
    const submittedItems = cartLines.map(({ id, name, price, quantity }) => ({ id, name, price, quantity }));
    const { data, error: submitError } = await supabase.functions.invoke('create-order', {
      body: {
        customer_name: String(formData.get('customer_name')).trim(),
        customer_room: customerRoom,
        payment_method: checkoutPaymentMethod,
        items,
      },
    });
    if (submitError || data?.error) {
      let functionError = '';
      if (submitError?.context instanceof Response) {
        try {
          const errorBody = await submitError.context.clone().json();
          functionError = errorBody?.error || errorBody?.message || '';
        } catch {
          functionError = '';
        }
      }
      setCheckoutError(data?.error || functionError || submitError?.message || 'Your order could not be submitted. Please try again.');
      setCheckoutBusy(false);
      return;
    }
    setCart({});
    const orderCode = data.order_code;
    window.localStorage.setItem('kbh-last-order-id', orderCode);
    if (checkoutPaymentMethod === 'upi') {
      const paymentUrl = new URL('upi://pay');
      paymentUrl.searchParams.set('pa', data.upi_id);
      paymentUrl.searchParams.set('am', Number(data.total).toFixed(2));
      setCheckoutOpen(false);
      setCheckoutBusy(false);
      setOrderConfirmation({ orderCode, total: data.total, items: submittedItems, paymentMethod: 'upi', paymentUrl: paymentUrl.toString() });
      window.setTimeout(() => window.location.assign(paymentUrl.toString()), 1400);
      return;
    }
    setCheckoutOpen(false);
    setOrderConfirmation({
      orderCode,
      total: data.total,
      items: submittedItems,
      pickupRoom: customerRoom,
      paymentMethod: 'cash',
    });
    setHistoryOrderId(orderCode);
    setHistoryOpen(true);
    setHistorySearched(true);
    setHistoryError('');
    setHistoryOrders([]);
    setHistoryLoading(true);
    const { data: lookupData } = await supabase
      .from('orders')
      .select('id,order_code,customer_name,customer_phone,customer_room,payment_method,payment_status,order_status,total,created_at,order_items(product_name,unit_price,quantity,line_total)')
      .eq('order_code', orderCode)
      .order('created_at', { ascending: false });
    setHistoryLoading(false);
    const orders = Array.isArray(lookupData) ? lookupData : [];
    setHistoryOrders(orders.map(order => ({
      ...order,
      items: Array.isArray(order.items) ? order.items : [],
    })));
    setCheckoutBusy(false);
  }

  async function loadOrderByCode(orderId, { silent = false } = {}) {
    if (!supabase) {
      if (!silent) setHistoryError('Connect Supabase to view order history.');
      return;
    }
    const normalizedOrderId = String(orderId || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!normalizedOrderId) {
      if (!silent) {
        setHistoryError('Enter your order ID to track the order.');
        setHistorySearched(true);
      }
      return;
    }

    setHistoryLoading(true);
    if (!silent) {
      setHistoryError('');
      setHistorySearched(true);
    }
    setHistoryOrderId(normalizedOrderId);

    const { data, error: orderLookupError } = await supabase
      .from('orders')
      .select('id,order_code,customer_name,customer_phone,customer_room,payment_method,payment_status,order_status,total,created_at,order_items(product_name,unit_price,quantity,line_total)')
      .eq('order_code', normalizedOrderId)
      .order('created_at', { ascending: false });

    setHistoryLoading(false);
    if (orderLookupError) {
      setHistoryOrders([]);
      if (!silent) setHistoryError(orderLookupError.message || 'That order ID could not be checked.');
      return;
    }

    const orders = Array.isArray(data) ? data : [];
    setHistoryOrders(orders.map(order => ({
      ...order,
      items: Array.isArray(order.items) ? order.items : [],
    })));
    if (orders.length === 0 && !silent) {
      setHistoryError('No order matches that order ID.');
    }
  }

  async function loadCustomerHistory(event) {
    event.preventDefault();
    await loadOrderByCode(historyOrderId);
  }

  return (
    <>
      <BrandHeader storeOpen={storeOpen} cartCount={cartCount} onOpenCart={() => setCartOpen(true)} />
      <main className="page-shell">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Hostel night store</p>
            <h1>KBH<br />NIGHT STORE</h1>
            <p className="hero-tagline">NITH FIRST YEAR KI APNI DUKAAN....</p>
            <div className="pickup-line"><MapPin size={16} aria-hidden="true" /><span>{pickupRoom ? `Self-service pickup at ${pickupRoom}` : 'Self-service pickup · Room details coming soon'}</span></div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <span className="food-float food-float-chips">🍟</span>
            <span className="food-float food-float-cookies">🍪</span>
            <span className="food-float food-float-brownie">🍕</span>
            <div className="hero-aside"><span className="hero-aside-label">Tonight's menu</span><span className="hero-aside-value">{products.length.toString().padStart(2, '0')}<small> snacks</small></span></div>
          </div>
        </section>

        {storeOpen === false && <aside className="closed-store-banner" role="status" aria-live="polite">
          <span className="closed-store-icon"><MoonStar size={24} aria-hidden="true" /></span>
          <span><strong>Store is closed</strong><small>Self-service pickup is paused for now. Check back later.</small></span>
        </aside>}

        <section className="catalog" id="menu" aria-labelledby="menu-title">
          <div className="catalog-heading">
            <div><p className="eyebrow">The good stuff</p><h2 id="menu-title">On the menu</h2></div>
            {products.length > 0 && <label className="search-box"><Search size={16} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search snacks" /></label>}
          </div>

          {error && <p className="notice notice-error" role="alert">{error}</p>}
          {!isSupabaseConfigured && <p className="notice">Connect your Supabase project to load the menu. Follow the setup guide in README.md.</p>}
          {isSupabaseConfigured && !error && !loading && products.length === 0 && <p className="notice">Menu coming soon. Check back later.</p>}
          {loading && <p className="notice">Loading the menu…</p>}

          {products.length > 0 && <div className="catalog-layout">
            <div className="category-list" aria-label="Filter by category">
              {categories.map(item => <button key={item} type="button" className={category === item ? 'category-button active' : 'category-button'} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="product-grid">
              {visibleProducts.length ? visibleProducts.map(product => <article className="product-card" key={product.id}>
                <div className="product-image">{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" /> : <div className="image-placeholder"><Store size={23} aria-hidden="true" /><span>KBH NIGHTS</span></div>}</div>
                <div className="product-info">
                  <div className="product-title-row"><h3>{product.name}</h3><span className="product-price">{formatPrice(product.price)}</span></div>
                  {product.category && <p className="product-category">{product.category}</p>}
                  {product.description && <p className="product-description">{product.description}</p>}
                  <button className="button button-primary add-to-cart" type="button" data-product-id={product.id} onClick={() => addToCart(product)} disabled={storeOpen !== true}><Plus size={16} aria-hidden="true" /> {storeOpen === false ? 'Store closed' : 'Add to bag'}</button>
                </div>
              </article>) : <p className="notice">No snacks match that search.</p>}
            </div>
          </div>}
        </section>
      </main>
      <div className="store-actions">
        <button className="button button-secondary history-launch-button" type="button" onClick={() => setHistoryOpen(true)}>
          Track order
        </button>
      </div>
      {historyOpen && <div className="history-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHistoryOpen(false); }}>
        <aside className="history-window" role="dialog" aria-modal="true" aria-labelledby="history-title">
          <div className="cart-heading history-heading-row">
            <div>
              <p className="eyebrow">Your order tracker</p>
              <h2 id="history-title">Order list</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setHistoryOpen(false)} aria-label="Close order list"><X size={19} /></button>
          </div>
          <form className="history-form" onSubmit={loadCustomerHistory}>
            <label className="field-label history-field history-search-field">
              <span>Order ID</span>
              <input value={historyOrderId} onChange={event => setHistoryOrderId(event.target.value)} maxLength={20} />
            </label>
            <button className="button button-primary history-submit" type="submit" disabled={historyLoading}>
              {historyLoading ? 'Checking…' : 'Track order'}
            </button>
          </form>
          {historyError && <p className="notice notice-error" role="alert">{historyError}</p>}
          {historySearched && !historyLoading && !historyError && historyOrders.length === 0 && <p className="notice">No order matches that order ID yet.</p>}
          {historyOrders.length > 0 && <div className="history-results" aria-live="polite">
            {historyOrders.map(order => <article className="history-item" key={order.id}>
              <div className="history-item-head">
                <div>
                  <span className="history-code">#{order.order_code}</span>
                  <time>{new Date(order.created_at).toLocaleString()}</time>
                </div>
                <strong>{formatPrice(order.total)}</strong>
              </div>
              <div className="history-item-meta">
                <span className={`history-status ${order.order_status}`}>{order.order_status}</span>
                <span className={`history-payment ${order.payment_status}`}>{order.payment_status}</span>
              </div>
              <div className="history-item-room">Pickup room: {order.customer_room}</div>
              <div className="history-items">
                {order.items.map(item => <span key={`${order.id}-${item.product_name}-${item.quantity}`}>{item.product_name} × {item.quantity}</span>)}
              </div>
            </article>)}
          </div>}
        </aside>
      </div>}
      <footer className="site-footer"><span>KBH NIGHTS</span><span>Self-service pickup · No delivery</span></footer>
      <div className={`cart-overlay ${cartOpen ? 'is-open' : ''}`} aria-hidden={!cartOpen} onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
          <div className="cart-heading"><div><p className="eyebrow">Your picks</p><h2 id="cart-title">Bag <span className="cart-heading-count">{cartCount}</span></h2></div><button className="icon-button" type="button" onClick={() => setCartOpen(false)} aria-label="Close bag"><X size={19} /></button></div>
          <div className="cart-lines">
            {cartLines.length === 0 ? <p className="cart-empty">Your bag is empty. Add a snack to get started.</p> : cartLines.map(product => <article className="cart-line" key={product.id}>
              {product.image_url ? <img src={product.image_url} alt="" /> : <div className="cart-line-placeholder"><Store size={17} aria-hidden="true" /></div>}
              <div className="cart-line-info"><h3>{product.name}</h3><span>{formatPrice(product.price)} each</span><strong>{formatPrice(Number(product.price) * product.quantity)}</strong></div>
              <div className="quantity-control" aria-label={`${product.name} quantity`}><button type="button" onClick={() => changeCartQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button><span>{product.quantity}</span><button type="button" onClick={() => changeCartQuantity(product.id, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button></div>
            </article>)}
          </div>
          <div className="cart-summary">
            <div className="cart-subtotal"><span>Subtotal</span><strong>{formatPrice(cartSubtotal)}</strong></div>
            <p>Choose cash at pickup or UPI payment at checkout.</p>
            {cartCount > 0 && <div className="cart-actions"><button className="button button-secondary clear-cart-button" type="button" onClick={() => { setCart({}); setCartMessage('Bag cleared.'); }}><Trash2 size={15} /> Clear cart</button><button className="button button-primary place-order-button" type="button" onClick={startCheckout} disabled={storeOpen !== true || (!acceptOffline && !canPayOnline)}>Place order</button></div>}
          </div>
          <span className="visually-hidden" role="status" aria-live="polite">{cartMessage}</span>
        </aside>
      </div>
      {checkoutOpen && <div className="order-preview-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOpen(false); }}>
        <section className="order-preview-dialog checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <button className="checkout-close icon-button" type="button" onClick={() => setCheckoutOpen(false)} disabled={checkoutBusy} aria-label="Close checkout"><X size={19} /></button>
          <p className="eyebrow">Hostel pickup</p>
          <h2 id="checkout-title">Your order</h2>
          <div className="order-preview-items">{cartLines.map(item => <div className="order-preview-item" key={item.id}><span>{item.name} × {item.quantity}</span><strong>{formatPrice(Number(item.price) * item.quantity)}</strong></div>)}</div>
          <div className="cart-subtotal checkout-total"><span>Total</span><strong>{formatPrice(cartSubtotal)}</strong></div>
          <form className="checkout-form" onSubmit={submitOrder}>
            <label className="field-label">Your name<input name="customer_name" autoComplete="name" maxLength={100} required /></label>
            <div className="form-two-col checkout-room-fields">
              <label className="field-label">Room block<select name="customer_block" required><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="E">E</option></select></label>
              <label className="field-label">Room number<input name="customer_room_number" type="number" min="1" max="600" step="1" required /></label>
            </div>
            <fieldset className="payment-methods">
              <legend>Payment method</legend>
              <label className="payment-method"><input type="radio" name="payment_method" value="cash" checked={checkoutPaymentMethod === 'cash'} onChange={() => setCheckoutPaymentMethod('cash')} disabled={!acceptOffline} /><span><strong>Offline · Cash at pickup</strong><small>{acceptOffline ? 'Pay when you collect your order.' : 'Currently unavailable.'}</small></span></label>
              <label className="payment-method"><input type="radio" name="payment_method" value="upi" checked={checkoutPaymentMethod === 'upi'} onChange={() => setCheckoutPaymentMethod('upi')} disabled={!canPayOnline} /><span><strong>Online · UPI</strong><small>{canPayOnline ? 'Continue to your UPI app to pay.' : 'Currently unavailable.'}</small></span></label>
            </fieldset>
            {checkoutError && <p className="form-feedback error" role="alert">{checkoutError}</p>}
            <p className="checkout-privacy">Your name, room, and order details are sent to the shop to fulfill this order.</p>
            <button className="button button-primary order-preview-close" type="submit" disabled={checkoutBusy || (checkoutPaymentMethod === 'cash' ? !acceptOffline : !canPayOnline) || storeOpen !== true}>{checkoutBusy ? 'Submitting…' : checkoutPaymentMethod === 'upi' ? 'Continue to UPI' : 'Confirm cash order'}</button>
          </form>
        </section>
      </div>}
      {orderConfirmation && <div className="order-preview-overlay" role="presentation">
        <section className="order-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="order-confirm-title">
          <div className="order-preview-icon"><CheckCircle2 size={25} aria-hidden="true" /></div>
          <p className="eyebrow">{orderConfirmation.paymentMethod === 'upi' ? 'Online · UPI' : 'Offline · Cash at pickup'}</p>
          <h2 id="order-confirm-title">{orderConfirmation.paymentMethod === 'upi' ? 'Order confirmed' : 'Order received'}</h2>
          <p className="order-preview-note">{orderConfirmation.paymentMethod === 'upi' ? 'Your order is confirmed. Opening your UPI app to pay now.' : `Show this order code when you collect and pay cash at ${orderConfirmation.pickupRoom}.`}</p>
          <p className="order-code">{orderConfirmation.orderCode}</p>
          <div className="order-preview-items">{orderConfirmation.items.map(item => <div className="order-preview-item" key={item.id}><span>{item.name} × {item.quantity}</span><strong>{formatPrice(Number(item.price) * item.quantity)}</strong></div>)}</div>
          <div className="cart-subtotal order-preview-total"><span>Total</span><strong>{formatPrice(orderConfirmation.total)}</strong></div>
          {orderConfirmation.paymentUrl ? <button className="button button-primary order-preview-close" type="button" onClick={() => window.location.assign(orderConfirmation.paymentUrl)}>Open UPI app</button> : <button className="button button-primary order-preview-close" type="button" onClick={() => setOrderConfirmation(null)}>Back to store</button>}
        </section>
      </div>}
    </>
  );
}

function AdminPage() {
  const [session, setSession] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState([]);
  const [pickupRoom, setPickupRoom] = useState('');
  const [storeOpen, setStoreOpen] = useState(null);
  const [acceptOffline, setAcceptOffline] = useState(true);
  const [acceptOnline, setAcceptOnline] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editingProduct, setEditingProduct] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsAdmin(false);
      setFeedback('');
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!supabase || !session) { setIsAdmin(false); return undefined; }
    let active = true;
    setCheckingAccess(true);
    supabase.rpc('is_admin').then(({ data, error: accessError }) => {
      if (!active) return;
      setIsAdmin(data === true);
      setCheckingAccess(false);
      if (accessError) showFeedback(`Could not verify admin access: ${accessError.message}`, true);
      else if (data !== true) showFeedback('This account is not approved to manage the store.', true);
    });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !isAdmin) return undefined;
    let active = true;
    async function loadAdminData() {
      const [productResult, settingsResult, ordersResult] = await Promise.all([
        supabase.from('products').select('*').order('sort_order').order('created_at', { ascending: false }),
        supabase.from('store_settings').select('pickup_room,is_open,accept_offline,accept_online,upi_id').eq('id', true).maybeSingle(),
        supabase.from('orders').select('id,order_code,customer_name,customer_phone,customer_room,payment_method,payment_status,order_status,total,created_at,order_items(product_name,unit_price,quantity,line_total)').gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      if (productResult.error) showFeedback(productResult.error.message, true);
      else setProducts(productResult.data || []);
      if (settingsResult.error) showFeedback(settingsResult.error.message, true);
      else {
        setPickupRoom(settingsResult.data?.pickup_room || '');
        setStoreOpen(settingsResult.data?.is_open ?? true);
        setAcceptOffline(settingsResult.data?.accept_offline ?? true);
        setAcceptOnline(settingsResult.data?.accept_online ?? false);
        setUpiId(settingsResult.data?.upi_id || '');
      }
      if (ordersResult.error) showFeedback(ordersResult.error.message, true);
      else setOrders(ordersResult.data || []);
    }
    loadAdminData();
    const ordersChannel = supabase.channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => setReloadKey(value => value + 1))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' }, () => setReloadKey(value => value + 1))
      .subscribe();
    return () => { active = false; supabase.removeChannel(ordersChannel); };
  }, [isAdmin, reloadKey]);

  function showFeedback(message, isError = false) {
    setFeedback(message);
    setFeedbackError(isError);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    showFeedback('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) showFeedback(loginError.message, true);
    setBusy(false);
  }

  async function handleSignOut() {
    await supabase?.auth.signOut();
    setSession(null);
    setIsAdmin(false);
  }

  async function handleSavePickup(event) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error: saveError } = await supabase.from('store_settings').upsert({ id: true, pickup_room: pickupRoom.trim(), is_open: storeOpen ?? true }, { onConflict: 'id' });
    showFeedback(saveError ? saveError.message : 'Pickup room saved.', Boolean(saveError));
    setBusy(false);
  }

  async function handleToggleStore() {
    if (!supabase || storeOpen === null) return;
    const nextState = !storeOpen;
    setBusy(true);
    const { error: updateError } = await supabase.from('store_settings').update({ is_open: nextState, updated_at: new Date().toISOString() }).eq('id', true);
    if (updateError) showFeedback(updateError.message, true);
    else {
      setStoreOpen(nextState);
      showFeedback(nextState ? 'Store is now open.' : 'Store is now closed.');
    }
    setBusy(false);
  }

  async function handleToggleCashAcceptance() {
    if (!supabase) return;
    const nextState = !acceptOffline;
    setBusy(true);
    const { error: updateError } = await supabase.from('store_settings')
      .update({ accept_offline: nextState, updated_at: new Date().toISOString() })
      .eq('id', true);
    if (updateError) showFeedback(updateError.message, true);
    else {
      setAcceptOffline(nextState);
      showFeedback(`Cash at pickup ${nextState ? 'enabled' : 'disabled'}.`);
    }
    setBusy(false);
  }

  async function handleSaveUpiSettings(event) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error: updateError } = await supabase.from('store_settings').update({
      upi_id: upiId.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', true);
    if (updateError) showFeedback(updateError.message, true);
    else showFeedback('UPI details saved.');
    setBusy(false);
  }

  async function handleToggleOnlineAcceptance() {
    if (!supabase) return;
    const nextState = !acceptOnline;
    if (nextState && !upiId.trim()) {
      showFeedback('Save a UPI ID before enabling online payments.', true);
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.from('store_settings').update({
      accept_online: nextState,
      upi_id: upiId.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', true);
    if (updateError) showFeedback(updateError.message, true);
    else {
      setAcceptOnline(nextState);
      showFeedback(`UPI payments ${nextState ? 'enabled' : 'disabled'}.`);
    }
    setBusy(false);
  }

  async function handleOrderStatusChange(orderId, orderStatus) {
    const { error: updateError } = await supabase.from('orders').update({ order_status: orderStatus, updated_at: new Date().toISOString() }).eq('id', orderId);
    if (updateError) showFeedback(updateError.message, true);
    else setReloadKey(value => value + 1);
  }

  async function handleMarkPaymentReceived(orderId, paymentMethod) {
    const { error: updateError } = await supabase.from('orders').update({ payment_status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', orderId).eq('payment_method', paymentMethod).in('payment_status', ['unpaid', 'pending']);
    if (updateError) showFeedback(updateError.message, true);
    else {
      showFeedback('Payment marked as received.');
      setReloadKey(value => value + 1);
    }
  }

  async function handleDeleteOrder(orderId, orderCode) {
    if (!window.confirm(`Delete order ${orderCode}? This cannot be undone.`)) return;
    const { error: deleteError } = await supabase.from('orders').delete().eq('id', orderId);
    if (deleteError) {
      showFeedback(deleteError.message, true);
      return;
    }
    showFeedback(`Order ${orderCode} deleted.`);
    setReloadKey(value => value + 1);
  }

  async function handleSaveProduct(event) {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    const file = formData.get('photo');
    let imageUrl = editingProduct?.image_url || null;
    if (file instanceof File && file.size > 0) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        showFeedback(`Photo upload failed: ${uploadError.message}`, true);
        setBusy(false);
        return;
      }
      imageUrl = supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    }
    const product = {
      name: String(formData.get('name')).trim(),
      price: Number(formData.get('price')),
      category: String(formData.get('category')).trim() || null,
      description: String(formData.get('description')).trim() || null,
      image_url: imageUrl,
      available: formData.has('available'),
      sort_order: Number(formData.get('sort_order')) || 0,
    };
    const result = editingProduct
      ? await supabase.from('products').update(product).eq('id', editingProduct.id)
      : await supabase.from('products').insert(product);
    if (result.error) showFeedback(result.error.message, true);
    else {
      showFeedback(editingProduct ? 'Product updated.' : 'Product added.');
      setEditingProduct(null);
      form.reset();
      setReloadKey(value => value + 1);
    }
    setBusy(false);
  }

  async function handleDeleteProduct(product) {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id);
    if (deleteError) showFeedback(deleteError.message, true);
    else {
      showFeedback('Product deleted.');
      setReloadKey(value => value + 1);
    }
  }

  async function toggleAvailability(product) {
    const { error: updateError } = await supabase.from('products').update({ available: !product.available }).eq('id', product.id);
    if (updateError) showFeedback(updateError.message, true);
    else setReloadKey(value => value + 1);
  }

  function startEditing(product) {
    setEditingProduct(product);
    document.querySelector('#product-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const visibleOrders = orders.filter(order => {
    const matchesStatus = orderStatusFilter === 'all' || order.order_status === orderStatusFilter;
    const query = orderSearch.trim().toLowerCase();
    const matchesSearch = !query || `${order.order_code} ${order.customer_name} ${order.customer_phone} ${order.customer_room}`.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
  const activeOrders = orders.filter(order => ['received', 'preparing', 'ready'].includes(order.order_status)).length;
  const readyOrders = orders.filter(order => order.order_status === 'ready').length;
  const recentOrderTotal = orders.reduce((total, order) => total + Number(order.total), 0);

  return (
    <>
      <BrandHeader admin storeOpen={storeOpen} />
      <main className="admin-shell">
        {!isSupabaseConfigured ? <section className="admin-gate"><p className="eyebrow">Store management</p><h1>Connect Supabase</h1><p>Add your project URL and public anon key to <code>.env.local</code>, then follow the setup guide.</p><a className="text-link" href="#store">Back to storefront</a></section> : !session ? <section className="admin-gate">
          <p className="eyebrow">Store management</p><h1>Admin sign in</h1><p>Only accounts approved in Supabase can manage products.</p>
          <form className="login-form" onSubmit={handleLogin}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          {feedback && <p className={feedbackError ? 'form-feedback error' : 'form-feedback'} role="status">{feedback}</p>}
          <p className="admin-help">Create the account in Supabase Authentication, then approve it using the SQL in <code>supabase/SETUP.md</code>.</p>
        </section> : checkingAccess ? <p className="notice">Checking admin access…</p> : !isAdmin ? <section className="admin-gate"><p className="eyebrow">Store management</p><h1>Access not approved</h1><p>{feedback || 'This account does not have permission to manage the store.'}</p><button className="button button-secondary" type="button" onClick={handleSignOut}>Sign out</button></section> : <>
          <div className="admin-heading"><div><p className="eyebrow">Store management</p><h1>Admin panel</h1></div><button className="button button-secondary" type="button" onClick={handleSignOut}><LogOut size={16} /> Sign out</button></div>
          {feedback && <p className={feedbackError ? 'form-feedback error' : 'form-feedback'} role="status">{feedback}</p>}
          <nav className="admin-shortcuts" aria-label="Admin sections"><a href="#admin-orders">Orders</a><a href="#admin-products">Products</a><a href="#admin-settings">Store settings</a></nav>
          <div className="admin-overview" aria-label="Order overview">
            <div><span>Active orders</span><strong>{activeOrders}</strong></div>
            <div><span>Ready for pickup</span><strong>{readyOrders}</strong></div>
            <div><span>Order total · 48h</span><strong>{formatPrice(recentOrderTotal)}</strong></div>
          </div>
          <section className="settings-section" id="admin-settings" aria-labelledby="pickup-heading">
            <div className="section-heading"><div><h2 id="pickup-heading">Pickup location</h2><p>This room is shown on the public storefront.</p></div></div>
            <form className="pickup-form" onSubmit={handleSavePickup}><label className="field-label" htmlFor="pickup-room">Room or pickup point</label><div className="inline-form"><input id="pickup-room" value={pickupRoom} onChange={event => setPickupRoom(event.target.value)} /><button className="button button-primary" type="submit" disabled={busy}>Save location</button></div></form>
          </section>
          <section className="settings-section" aria-labelledby="availability-heading">
            <div className="section-heading"><div><h2 id="availability-heading">Store availability</h2><p>Changes appear on the storefront immediately.</p></div></div>
            <div className={`store-toggle-row ${storeOpen === false ? 'closed' : ''}`}>
              <span className="store-toggle-icon">{storeOpen === false ? <MoonStar size={20} aria-hidden="true" /> : <Power size={20} aria-hidden="true" />}</span>
              <span className="store-toggle-copy"><strong>{storeOpen === null ? 'Loading status…' : storeOpen ? 'Store is open' : 'Store is closed'}</strong><small>{storeOpen === false ? 'Visitors will see the closed notice.' : 'Visitors can see that the store is open.'}</small></span>
              <button className="button button-secondary" type="button" onClick={handleToggleStore} disabled={busy || storeOpen === null} aria-pressed={storeOpen === true}>{storeOpen ? 'Close store' : 'Open store'}</button>
            </div>
          </section>
          <section className="settings-section" aria-labelledby="payment-heading">
            <div className="section-heading"><div><h2 id="payment-heading">Payment methods</h2><p>UPI uses the saved destination ID and the order total.</p></div></div>
            <div className="payment-settings-list">
              <div className={`store-toggle-row ${acceptOffline ? '' : 'closed'}`}><span className="store-toggle-icon"><Store size={20} aria-hidden="true" /></span><span className="store-toggle-copy"><strong>Offline · Cash at pickup</strong><small>{acceptOffline ? 'Customers can pay when they collect their order.' : 'Cash orders are disabled.'}</small></span><button className="button button-secondary" type="button" onClick={handleToggleCashAcceptance} disabled={busy} aria-pressed={acceptOffline}>{acceptOffline ? 'Disable' : 'Enable'}</button></div>
              <div className={`store-toggle-row ${acceptOnline ? '' : 'closed'}`}><span className="store-toggle-icon"><ShoppingBag size={20} aria-hidden="true" /></span><span className="store-toggle-copy"><strong>Online · UPI</strong><small>{acceptOnline ? 'Customers are redirected using the saved UPI ID; order total is added automatically.' : 'UPI payments are disabled.'}</small></span><button className="button button-secondary" type="button" onClick={handleToggleOnlineAcceptance} disabled={busy || (!acceptOnline && !upiId.trim())} aria-pressed={acceptOnline}>{acceptOnline ? 'Disable' : 'Enable'}</button></div>
              <form className="payment-config-form" onSubmit={handleSaveUpiSettings}>
                <label className="field-label">UPI ID<input value={upiId} onChange={event => setUpiId(event.target.value)} maxLength={100} required /></label>
                <button className="button button-secondary" type="submit" disabled={busy}>Save UPI details</button>
              </form>
            </div>
          </section>
          <section className="settings-section" id="admin-orders" aria-labelledby="orders-heading">
            <div className="section-heading"><div><h2 id="orders-heading">Order history <span className="count-label">{visibleOrders.length}</span></h2><p>Orders from the last 48 hours. Older records remain stored but are not shown here.</p></div></div>
            <div className="order-filters">
              <label className="search-box"><Search size={16} aria-hidden="true" /><input value={orderSearch} onChange={event => setOrderSearch(event.target.value)} aria-label="Search name, phone, room, or code" /></label>
              <label className="order-filter-label">Status<select value={orderStatusFilter} onChange={event => setOrderStatusFilter(event.target.value)}><option value="all">All orders</option><option value="received">Received</option><option value="preparing">Preparing</option><option value="ready">Ready for pickup</option><option value="collected">Collected</option><option value="cancelled">Cancelled</option></select></label>
            </div>
            <div className="order-list">
              {visibleOrders.length === 0 ? <p className="notice">{orders.length === 0 ? 'No orders in the last 48 hours.' : 'No orders match these filters.'}</p> : visibleOrders.map(order => <article className="admin-order" key={order.id}>
                <div className="admin-order-heading"><div><strong>#{order.order_code}</strong><time>{new Date(order.created_at).toLocaleString()}</time></div><strong>{formatPrice(order.total)}</strong></div>
                <div className="admin-order-customer"><strong>{order.customer_name}</strong><span>{order.customer_phone ? `${order.customer_phone} · ` : ''}Room {order.customer_room}</span></div>
                <div className="admin-order-items">{order.order_items.map((item, index) => <span key={`${order.id}-${index}`}>{item.product_name} × {item.quantity}</span>)}</div>
                <div className="admin-order-footer"><span className={`order-payment-status ${order.payment_status}`}>{order.payment_method === 'cash' ? 'Cash at pickup' : order.payment_method === 'upi' ? 'UPI transfer' : 'Legacy online payment'} · {order.payment_status}</span><label className="order-status-label">Order status<select value={order.order_status} onChange={event => handleOrderStatusChange(order.id, event.target.value)}><option value="received">Received</option><option value="preparing">Preparing</option><option value="ready">Ready for pickup</option><option value="collected">Collected</option><option value="cancelled">Cancelled</option></select></label>{['cash', 'upi'].includes(order.payment_method) && ['unpaid', 'pending'].includes(order.payment_status) && <button className="button button-secondary mark-cash-paid" type="button" onClick={() => handleMarkPaymentReceived(order.id, order.payment_method)}>Mark paid</button>}<button className="button button-secondary delete-order-button" type="button" onClick={() => handleDeleteOrder(order.id, order.order_code)}>Delete</button></div>
              </article>)}
            </div>
          </section>
          <section className="products-section" id="admin-products" aria-labelledby="products-heading">
            <div className="section-heading"><div><h2 id="products-heading">Products <span className="count-label">{products.length}</span></h2><p>Available products appear on the storefront.</p></div><button className="button button-primary" type="button" onClick={() => setEditingProduct(null)}><Plus size={17} /> Add product</button></div>
            <div className="admin-content">
              <form className="product-editor" id="product-editor" onSubmit={handleSaveProduct} key={editingProduct?.id || 'new-product'}>
                <div className="editor-heading"><h3>{editingProduct ? 'Edit product' : 'New product'}</h3>{editingProduct && <button className="icon-button" type="button" onClick={() => setEditingProduct(null)} aria-label="Cancel editing"><X size={17} /></button>}</div>
                <label className="field-label">Product name<input name="name" defaultValue={editingProduct?.name || ''} required maxLength={100} /></label>
                <div className="form-two-col">
                  <label className="field-label">Price (INR)<input name="price" type="number" min="0" step="0.01" defaultValue={editingProduct?.price ?? ''} required /></label>
                  <label className="field-label">Category<input name="category" defaultValue={editingProduct?.category || ''} maxLength={50} /></label>
                </div>
                <label className="field-label">Description <span className="optional">Optional</span><textarea name="description" defaultValue={editingProduct?.description || ''} rows="3" maxLength={300} /></label>
                <label className="field-label photo-field"><span>Product photo <span className="optional">Optional</span></span><span className="file-control"><ImagePlus size={17} /><span>{editingProduct?.image_url ? 'Replace photo' : 'Choose photo'}</span><input name="photo" type="file" accept="image/*" /></span></label>
                {editingProduct?.image_url && <img className="current-image" src={editingProduct.image_url} alt="Current product" />}
                <label className="field-label">Display order<input name="sort_order" type="number" step="1" defaultValue={editingProduct?.sort_order ?? 0} /></label>
                <label className="checkbox-row"><input name="available" type="checkbox" defaultChecked={editingProduct?.available ?? true} /> Available on storefront</label>
                <button className="button button-primary save-product" type="submit" disabled={busy}><Upload size={16} /> {busy ? 'Saving…' : editingProduct ? 'Save changes' : 'Add product'}</button>
              </form>
              <div className="admin-product-list">
                {products.length === 0 ? <p className="notice">No products yet. Add your first product.</p> : products.map(product => <article className="admin-product-row" key={product.id}>
                  {product.image_url ? <img src={product.image_url} alt="" /> : <div className="admin-image-placeholder"><ImagePlus size={18} /></div>}
                  <div className="admin-product-details"><h3>{product.name}</h3><p>{formatPrice(product.price)}{product.category ? ` · ${product.category}` : ''}</p></div>
                  <span className={product.available ? 'availability available' : 'availability unavailable'}>{product.available ? 'Available' : 'Hidden'}</span>
                  <div className="row-actions"><button className="icon-button" type="button" onClick={() => toggleAvailability(product)} aria-label={product.available ? `Hide ${product.name}` : `Show ${product.name}`} title={product.available ? 'Hide from storefront' : 'Show on storefront'}>{product.available ? <X size={16} /> : <Plus size={16} />}</button><button className="icon-button" type="button" onClick={() => startEditing(product)} aria-label={`Edit ${product.name}`} title="Edit product"><Pencil size={16} /></button><button className="icon-button danger-action" type="button" onClick={() => handleDeleteProduct(product)} aria-label={`Delete ${product.name}`} title="Delete product"><Trash2 size={16} /></button></div>
                </article>)}
              </div>
            </div>
          </section>
        </>}
      </main>
    </>
  );
}

export default function App() {
  const [adminRoute, setAdminRoute] = useState(window.location.hash === '#admin' || window.location.hash.startsWith('#admin-'));
  useEffect(() => {
    const syncRoute = () => setAdminRoute(window.location.hash === '#admin' || window.location.hash.startsWith('#admin-'));
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);
  return adminRoute ? <AdminPage /> : <Storefront />;
}
