'use strict';

// Keep this URL synchronized with admin.js if you redeploy the Apps Script web app.
const AROVIA_CONFIG = Object.freeze({
  apiUrl: 'https://script.google.com/macros/s/AKfycbzAKCoCl77LCs_vvNexgjAuhwvF6l_DZicEN1GT-HG7uJ2fv5cW8OvNbYqZF7VUeaAzOA/exec',
  whatsappNumber: '212699226164',
  currency: 'DH',
  cartStorageKey: 'arovia_cart_v2',
  pendingOrderKey: 'arovia_pending_order_v1'
});

const FALLBACK_CATALOG = [
  { id: 'imperatrice', category: 'femelle', name: "L'Impératrice", description: '', badge: '', sizes: { '10ml': 82, '5ml': 60 }, imageUrl: '', sortOrder: 10, active: true },
  { id: 'light-blud', category: 'femelle', name: 'Light Blud', description: '', badge: '', sizes: { '10ml': 88, '5ml': 65 }, imageUrl: '', sortOrder: 20, active: true },
  { id: 'pack-2', category: 'femelle', name: 'Pack 2 × 10 ml', description: '', badge: 'BEST VALUE', sizes: { '2x10ml': 158 }, imageUrl: '', sortOrder: 30, active: true },
  { id: 'libre', category: 'femelle', name: 'Libre', description: '', badge: '', sizes: { '10ml': 170, '5ml': 89 }, imageUrl: '', sortOrder: 40, active: true },
  { id: 'stronger-intensely', category: 'homme', name: 'Stronger Intensly With You', description: '', badge: '', sizes: { '10ml': 125, '5ml': 80 }, imageUrl: '', sortOrder: 50, active: true },
  { id: 'ysl', category: 'homme', name: 'YVES SAINT LAURENT', description: '', badge: '', sizes: { '10ml': 110, '5ml': 70 }, imageUrl: '', sortOrder: 60, active: true }
];

const store = {
  catalog: FALLBACK_CATALOG,
  catalogReady: false,
  activeCategory: 'all',
  cart: readCart(),
  selectedSizes: new Map(),
  busy: false,
  toastTimer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatMoney(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(amount) + ' ' + AROVIA_CONFIG.currency;
}

function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(AROVIA_CONFIG.cartStorageKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.productId === 'string' && typeof item.size === 'string')
      .map(item => ({ productId: item.productId, size: item.size, qty: Math.max(1, Math.min(20, Math.floor(Number(item.qty) || 1))) }));
  } catch (_) {
    return [];
  }
}

function saveCart() {
  try { localStorage.setItem(AROVIA_CONFIG.cartStorageKey, JSON.stringify(store.cart)); } catch (_) { /* storage may be disabled */ }
}

function getProduct(id) {
  return store.catalog.find(product => product.id === id && product.active !== false);
}

function getCartRows() {
  return store.cart.map(line => {
    const product = getProduct(line.productId);
    if (!product || !Object.prototype.hasOwnProperty.call(product.sizes || {}, line.size)) return null;
    const unitPrice = Number(product.sizes[line.size]);
    return { ...line, product, unitPrice, lineTotal: unitPrice * line.qty };
  }).filter(Boolean);
}

function getCartCount() {
  return getCartRows().reduce((total, item) => total + item.qty, 0);
}

function getCartTotal() {
  return getCartRows().reduce((total, item) => total + item.lineTotal, 0);
}

async function apiGet(action) {
  const url = new URL(AROVIA_CONFIG.apiUrl);
  url.searchParams.set('action', action);
  const response = await fetch(url.toString(), { method: 'GET', cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('API HTTP ' + response.status);
  const data = await response.json();
  if (!data || data.ok !== true) throw new Error((data && data.message) || 'Réponse serveur invalide.');
  return data;
}

async function apiPost(payload) {
  const body = new URLSearchParams();
  body.set('payload', JSON.stringify(payload));
  const response = await fetch(AROVIA_CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
    credentials: 'omit'
  });
  if (!response.ok) throw new Error('API HTTP ' + response.status);
  const data = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Réponse serveur invalide.');
  return data;
}

function showApiStatus(message, kind) {
  const status = $('#apiStatus');
  status.textContent = message;
  status.dataset.kind = kind || 'info';
  status.hidden = !message;
}

function setCategory(category) {
  store.activeCategory = category;
  $$('.filter-button').forEach(button => {
    const active = button.dataset.category === category;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
}

function renderProducts() {
  const grid = $('#productGrid');
  grid.replaceChildren();
  const products = store.catalog
    .filter(product => product.active !== false)
    .filter(product => store.activeCategory === 'all' || product.category === store.activeCategory)
    .sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));

  $('#catalogCount').textContent = products.length + (products.length === 1 ? ' fragrance' : ' fragrances');
  $('#emptyState').hidden = products.length > 0;
  products.forEach(product => grid.appendChild(createProductCard(product)));
}

function createProductCard(product) {
  const card = node('article', 'product-card');
  const visual = node('div', 'product-visual');

  if (product.imageUrl) {
    const image = node('img');
    image.src = product.imageUrl;
    image.alt = product.name;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      if (!visual.querySelector('.product-placeholder')) visual.appendChild(createPlaceholder());
    }, { once: true });
    visual.appendChild(image);
  } else {
    visual.appendChild(createPlaceholder());
  }

  if (product.badge) visual.appendChild(node('span', 'product-badge', product.badge));
  visual.appendChild(node('span', 'product-category', product.category === 'homme' ? 'POUR LUI' : 'POUR ELLE'));

  const info = node('div', 'product-info');
  const titleRow = node('div', 'product-title-row');
  titleRow.appendChild(node('h3', 'product-title', product.name));
  const sizes = Object.entries(product.sizes || {}).filter(([, price]) => Number(price) > 0);
  const lowest = sizes.reduce((min, [, price]) => Math.min(min, Number(price)), Infinity);
  titleRow.appendChild(node('span', 'product-price-hint', Number.isFinite(lowest) ? 'Dès ' + formatMoney(lowest) : 'Prix à confirmer'));
  info.appendChild(titleRow);
  info.appendChild(node('p', 'product-description', product.description || 'Une fragrance à découvrir.'));

  const buyRow = node('div', 'product-buy-row');
  const select = node('select', 'product-size-select');
  select.setAttribute('aria-label', 'Choisir un format pour ' + product.name);
  sizes.forEach(([size, price]) => {
    const option = node('option', '', size + ' · ' + formatMoney(price));
    option.value = size;
    select.appendChild(option);
  });
  const rememberedSize = store.selectedSizes.get(product.id);
  if (rememberedSize && sizes.some(([size]) => size === rememberedSize)) select.value = rememberedSize;
  select.addEventListener('change', () => store.selectedSizes.set(product.id, select.value));
  buyRow.appendChild(select);

  const add = node('button', 'add-button');
  add.type = 'button';
  add.appendChild(node('span', '', 'Ajouter'));
  add.appendChild(node('span', '', '+'));
  add.disabled = sizes.length === 0;
  add.addEventListener('click', () => addToCart(product.id, select.value));
  buyRow.appendChild(add);
  info.appendChild(buyRow);
  card.append(visual, info);
  return card;
}

function createPlaceholder() {
  const placeholder = node('div', 'product-placeholder');
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.appendChild(node('div', 'placeholder-bottle', 'AROVIA'));
  return placeholder;
}

function addToCart(productId, size) {
  const product = getProduct(productId);
  if (!product || !Object.prototype.hasOwnProperty.call(product.sizes || {}, size)) {
    showToast('Ce format n’est plus disponible.', 'error');
    refreshCatalog();
    return;
  }
  const existing = store.cart.find(line => line.productId === productId && line.size === size);
  if (existing) {
    if (existing.qty >= 20) { showToast('Maximum 20 unités par ligne.', 'error'); return; }
    existing.qty += 1;
  } else {
    store.cart.push({ productId, size, qty: 1 });
  }
  store.selectedSizes.set(productId, size);
  saveCart();
  renderCart();
  showToast(product.name + ' ajouté au panier.', 'success');
}

function changeQuantity(productId, size, amount) {
  const line = store.cart.find(item => item.productId === productId && item.size === size);
  if (!line) return;
  line.qty = Math.max(0, Math.min(20, line.qty + amount));
  if (line.qty < 1) store.cart = store.cart.filter(item => !(item.productId === productId && item.size === size));
  saveCart();
  renderCart();
}

function removeCartLine(productId, size) {
  store.cart = store.cart.filter(item => !(item.productId === productId && item.size === size));
  saveCart();
  renderCart();
}

function renderCart() {
  const rows = getCartRows();
  const count = rows.reduce((total, row) => total + row.qty, 0);
  $('#cartCount').textContent = String(count);
  $('#drawerCount').textContent = '(' + count + ')';
  $('#cartSubtotal').textContent = formatMoney(rows.reduce((total, row) => total + row.lineTotal, 0));
  $('#checkoutSubtotal').textContent = formatMoney(rows.reduce((total, row) => total + row.lineTotal, 0));
  $('#cartItems').replaceChildren();
  rows.forEach(row => $('#cartItems').appendChild(createCartLine(row)));
  const empty = rows.length === 0;
  $('#cartEmpty').classList.toggle('is-visible', empty);
  $('#cartItems').hidden = empty;
  $('#cartSummary').hidden = empty;
  $('#checkoutOpenBtn').disabled = store.busy || !store.catalogReady || empty;
  $('#submitOrderBtn').disabled = store.busy || !store.catalogReady || empty;
  $('#cartItems').setAttribute('aria-label', count + ' article(s) dans le panier');
}

function createCartLine(row) {
  const line = node('article', 'cart-line');
  const thumb = node('div', 'cart-line-thumb', 'A.');
  thumb.setAttribute('aria-hidden', 'true');
  const details = node('div', 'cart-line-details');
  details.appendChild(node('h3', 'cart-line-title', row.product.name));
  details.appendChild(node('p', 'cart-line-meta', row.size + ' · ' + formatMoney(row.unitPrice) + ' / unité'));
  const controls = node('div', 'cart-line-controls');
  const minus = node('button', 'qty-button', '−');
  minus.type = 'button'; minus.setAttribute('aria-label', 'Réduire la quantité de ' + row.product.name);
  minus.addEventListener('click', () => changeQuantity(row.productId, row.size, -1));
  const quantity = node('span', 'qty-number', String(row.qty));
  const plus = node('button', 'qty-button', '+');
  plus.type = 'button'; plus.setAttribute('aria-label', 'Augmenter la quantité de ' + row.product.name); plus.disabled = row.qty >= 20;
  plus.addEventListener('click', () => changeQuantity(row.productId, row.size, 1));
  const remove = node('button', 'remove-button', 'Retirer');
  remove.type = 'button'; remove.addEventListener('click', () => removeCartLine(row.productId, row.size));
  controls.append(minus, quantity, plus, remove);
  details.appendChild(controls);
  line.append(thumb, details, node('div', 'cart-line-price', formatMoney(row.lineTotal)));
  return line;
}

function openCart() {
  $('#cartBackdrop').hidden = false;
  $('#cartDrawer').classList.add('is-open');
  $('#cartDrawer').setAttribute('aria-hidden', 'false');
  $('#cartDrawer').inert = false;
  document.body.classList.add('cart-open');
  $('#cartCloseBtn').focus();
}

function closeCart() {
  $('#cartBackdrop').hidden = true;
  $('#cartDrawer').classList.remove('is-open');
  $('#cartDrawer').setAttribute('aria-hidden', 'true');
  $('#cartDrawer').inert = true;
  document.body.classList.remove('cart-open');
  $('#cartOpenBtn').focus();
}

function openCheckout() {
  if (!store.catalogReady) {
    showToast('Le catalogue ne peut pas être vérifié pour le moment. Réessayez dans quelques instants.', 'error');
    return;
  }
  if (!getCartRows().length) { showToast('Votre panier est vide.', 'error'); return; }
  closeCartWithoutFocus();
  $('#checkoutMessage').hidden = true;
  $('#checkoutDialog').showModal();
}

function closeCartWithoutFocus() {
  $('#cartBackdrop').hidden = true;
  $('#cartDrawer').classList.remove('is-open');
  $('#cartDrawer').setAttribute('aria-hidden', 'true');
  $('#cartDrawer').inert = true;
  document.body.classList.remove('cart-open');
}

function showFormMessage(message, kind) {
  const element = $('#checkoutMessage');
  element.textContent = message;
  element.dataset.kind = kind || 'info';
  element.hidden = false;
}

function createIdempotencyKey(fingerprint) {
  try {
    const current = JSON.parse(sessionStorage.getItem(AROVIA_CONFIG.pendingOrderKey) || 'null');
    if (current && current.fingerprint === fingerprint && typeof current.key === 'string') return current.key;
  } catch (_) { /* start a new attempt */ }
  const key = randomId();
  try { sessionStorage.setItem(AROVIA_CONFIG.pendingOrderKey, JSON.stringify({ fingerprint, key })); } catch (_) {}
  return key;
}

function randomId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'arovia-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
}

async function submitOrder(event) {
  event.preventDefault();
  if (store.busy) return;
  if (!store.catalogReady) { showFormMessage('Catalogue indisponible. Votre commande n’a pas été envoyée.', 'error'); return; }
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const customer = {
    name: String(formData.get('name') || '').trim(),
    phone: String(formData.get('phone') || '').trim(),
    city: String(formData.get('city') || '').trim(),
    address: String(formData.get('address') || '').trim(),
    notes: String(formData.get('notes') || '').trim()
  };
  const website = String(formData.get('website') || '');
  const rows = getCartRows();
  if (!rows.length) { showFormMessage('Votre panier est vide.', 'error'); return; }
  const items = rows.map(row => ({ productId: row.productId, size: row.size, qty: row.qty, expectedUnitPrice: row.unitPrice }));
  const fingerprint = JSON.stringify({ customer, items });
  const idempotencyKey = createIdempotencyKey(fingerprint);
  const payload = { action: 'order', idempotencyKey, customer, items, website };

  setCheckoutBusy(true);
  showFormMessage('Envoi en cours… gardez cette fenêtre ouverte jusqu’à la confirmation.', 'info');
  try {
    const result = await apiPost(payload);
    if (!result.ok) {
      if (result.code === 'PRICE_CHANGED' || result.code === 'PRODUCT_UNAVAILABLE') {
        await refreshCatalog();
        renderCart();
      }
      showFormMessage(result.message || 'La commande n’a pas été confirmée.', 'error');
      return;
    }
    try { sessionStorage.removeItem(AROVIA_CONFIG.pendingOrderKey); } catch (_) {}
    store.cart = [];
    saveCart();
    renderCart();
    $('#checkoutDialog').close();
    form.reset();
    showReceipt(result.receipt || {
      orderId: result.orderId,
      total: rows.reduce((sum, item) => sum + item.lineTotal, 0),
      items: rows.map(item => ({ productName: item.product.name, size: item.size, qty: item.qty, lineTotal: item.lineTotal })),
      customer
    });
  } catch (error) {
    showFormMessage('Impossible de recevoir la confirmation du serveur. Votre tentative garde le même identifiant pour éviter une commande en double. Réessayez sans modifier les informations.', 'error');
  } finally {
    setCheckoutBusy(false);
  }
}

function setCheckoutBusy(busy) {
  store.busy = busy;
  $('#submitOrderBtn').disabled = busy || !store.catalogReady || !getCartRows().length;
  $('#submitOrderBtn').textContent = busy ? 'Envoi en cours…' : 'Envoyer ma commande ↗';
  $('#checkoutOpenBtn').disabled = busy || !store.catalogReady || !getCartRows().length;
}

function showReceipt(receipt) {
  const content = $('#receiptContent');
  content.replaceChildren();
  content.appendChild(node('p', 'receipt-order-id', 'COMMANDE ' + (receipt.orderId || 'ENREGISTRÉE')));
  if (receipt.createdAt) content.appendChild(createReceiptRow('Date', receipt.createdAt));
  const customer = receipt.customer || {};
  content.appendChild(createReceiptRow('Nom', customer.name || '—'));
  content.appendChild(createReceiptRow('Ville', customer.city || '—'));
  const list = node('ul', 'receipt-items');
  (receipt.items || []).forEach(item => {
    list.appendChild(node('li', '', (item.productName || item.name || item.productId || 'Produit') + ' · ' + item.size + ' × ' + item.qty + ' · ' + formatMoney(item.lineTotal)));
  });
  content.appendChild(list);
  content.appendChild(node('div', 'receipt-total', ''));
  const total = content.querySelector('.receipt-total');
  total.append(node('span', '', 'Total produits'), node('strong', '', formatMoney(receipt.total)));
  $('#receiptIntro').textContent = 'Votre demande est enregistrée. AROVIA confirmera la disponibilité, les frais de livraison et le délai.';
  const message = [
    'Bonjour AROVIA, je souhaite confirmer ma commande ' + (receipt.orderId || ''),
    'Nom : ' + (customer.name || ''),
    'Ville : ' + (customer.city || ''),
    'Total produits : ' + formatMoney(receipt.total),
    'Merci de confirmer les frais et le délai de livraison.'
  ].join('\n');
  $('#receiptWhatsApp').href = 'https://wa.me/' + AROVIA_CONFIG.whatsappNumber + '?text=' + encodeURIComponent(message);
  $('#receiptDialog').showModal();
}

function createReceiptRow(label, value) {
  const row = node('div', 'receipt-row');
  row.append(node('span', '', label), node('strong', '', value));
  return row;
}

function showToast(message, kind) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.kind = kind || 'info';
  toast.hidden = false;
  window.clearTimeout(store.toastTimer);
  store.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

async function refreshCatalog() {
  try {
    const response = await apiGet('catalog');
    if (!Array.isArray(response.products)) throw new Error('Catalogue invalide.');
    store.catalog = response.products.filter(product => product && typeof product.id === 'string' && product.sizes && typeof product.sizes === 'object');
    store.catalogReady = true;
    const before = store.cart.length;
    store.cart = store.cart.filter(line => {
      const product = store.catalog.find(item => item.id === line.productId && item.active !== false);
      return product && Object.prototype.hasOwnProperty.call(product.sizes || {}, line.size);
    });
    if (before !== store.cart.length) showToast('Le panier a été ajusté selon le catalogue actuel.', 'info');
    saveCart();
    showApiStatus('', 'info');
  } catch (_) {
    store.catalog = FALLBACK_CATALOG;
    store.catalogReady = false;
    showApiStatus('Aperçu du catalogue uniquement : le serveur est indisponible. Les commandes sont temporairement désactivées pour éviter les prix obsolètes.', 'error');
  }
  renderProducts();
  renderCart();
}

function wireEvents() {
  $$('.filter-button').forEach(button => button.addEventListener('click', () => setCategory(button.dataset.category)));
  const mobileMenu = $('#mobileMenuBtn');
  const mainNav = $('#mainNav');
  const setMobileMenu = open => {
    mobileMenu.setAttribute('aria-expanded', String(open));
    mobileMenu.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    mainNav.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-locked', open && window.matchMedia('(max-width: 700px)').matches);
  };
  mobileMenu.addEventListener('click', () => setMobileMenu(mobileMenu.getAttribute('aria-expanded') !== 'true'));
  mainNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMobileMenu(false)));
  document.addEventListener('click', event => {
    if (mobileMenu.getAttribute('aria-expanded') === 'true' && !mainNav.contains(event.target) && !mobileMenu.contains(event.target)) setMobileMenu(false);
  });
  $('#cartOpenBtn').addEventListener('click', openCart);
  $('#cartCloseBtn').addEventListener('click', closeCart);
  $('#cartBackdrop').addEventListener('click', closeCart);
  $('#continueShoppingBtn').addEventListener('click', closeCart);
  $('#checkoutOpenBtn').addEventListener('click', openCheckout);
  $('#checkoutForm').addEventListener('submit', submitOrder);
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.closeDialog);
    if (dialog && dialog.open) dialog.close();
  }));
  $('#checkoutDialog').addEventListener('click', event => { if (event.target === $('#checkoutDialog')) $('#checkoutDialog').close(); });
  $('#receiptDialog').addEventListener('click', event => { if (event.target === $('#receiptDialog')) $('#receiptDialog').close(); });
  $('#currentYear').textContent = String(new Date().getFullYear());
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if ($('#cartDrawer').classList.contains('is-open')) closeCart();
    if ($('#mobileMenuBtn').getAttribute('aria-expanded') === 'true') {
      $('#mobileMenuBtn').setAttribute('aria-expanded', 'false');
      $('#mobileMenuBtn').setAttribute('aria-label', 'Ouvrir le menu');
      $('#mainNav').classList.remove('is-open');
      document.body.classList.remove('nav-locked');
    }
  });
}

wireEvents();
renderProducts();
renderCart();
refreshCatalog();
