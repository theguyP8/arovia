'use strict';

// Keep this URL synchronized with app.js if you redeploy the Apps Script web app.
const ADMIN_CONFIG = Object.freeze({
  apiUrl: 'https://script.google.com/macros/s/AKfycbzAKCoCl77LCs_vvNexgjAuhwvF6l_DZicEN1GT-HG7uJ2fv5cW8OvNbYqZF7VUeaAzOA/exec',
  tokenKey: 'aroviaAdminToken'
});

const adminState = {
  token: '',
  products: [],
  editingId: null,
  idWasEdited: false,
  pendingImage: null,
  imageUploadComplete: true,
  imageUrl: '',
  toastTimer: null
};

const $ = selector => document.querySelector(selector);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatMoney(value) {
  return new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(Number(value) || 0) + ' DH';
}

async function apiPost(payload) {
  const body = new URLSearchParams();
  body.set('payload', JSON.stringify(payload));
  const response = await fetch(ADMIN_CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
    credentials: 'omit'
  });
  if (!response.ok) throw new Error('API HTTP ' + response.status);
  return response.json();
}

function showMessage(element, message, kind) {
  element.textContent = message || '';
  element.dataset.kind = kind || 'info';
  element.hidden = !message;
}

function showToast(message, kind) {
  const toast = $('#adminToast');
  toast.textContent = message;
  toast.dataset.kind = kind || 'info';
  toast.hidden = false;
  window.clearTimeout(adminState.toastTimer);
  adminState.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function setLoggedIn(isLoggedIn) {
  $('#loginPanel').classList.toggle('is-hidden', isLoggedIn);
  $('#adminPanel').classList.toggle('is-hidden', !isLoggedIn);
}

function saveToken(token) {
  adminState.token = token || '';
  try {
    if (token) sessionStorage.setItem(ADMIN_CONFIG.tokenKey, token);
    else sessionStorage.removeItem(ADMIN_CONFIG.tokenKey);
  } catch (_) { /* session storage might be unavailable */ }
}

async function login(event) {
  event.preventDefault();
  const button = $('#loginButton');
  const passwordInput = $('#adminPassword');
  const password = passwordInput.value;
  if (!password) return;
  button.disabled = true;
  button.textContent = 'Connexion…';
  showMessage($('#loginMessage'), '', 'info');
  try {
    const result = await apiPost({ action: 'adminLogin', password });
    if (!result.ok || !result.token) {
      showMessage($('#loginMessage'), result.message || 'Connexion refusée.', 'error');
      passwordInput.select();
      return;
    }
    saveToken(result.token);
    passwordInput.value = '';
    setLoggedIn(true);
    await loadProducts();
  } catch (_) {
    showMessage($('#loginMessage'), 'Impossible de joindre le serveur. Vérifiez la connexion et l’URL de l’API.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Se connecter ↗';
  }
}

async function loadProducts() {
  if (!adminState.token) return;
  $('#catalogMeta').textContent = 'Chargement du catalogue…';
  showMessage($('#adminMessage'), '', 'info');
  try {
    const result = await apiPost({ action: 'adminList', token: adminState.token });
    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') {
        saveToken('');
        setLoggedIn(false);
        showMessage($('#loginMessage'), 'Votre session a expiré. Reconnectez-vous.', 'error');
        return;
      }
      throw new Error(result.message || 'Impossible de charger le catalogue.');
    }
    adminState.products = Array.isArray(result.products) ? result.products : [];
    renderAdminProducts();
  } catch (error) {
    $('#catalogMeta').textContent = 'Catalogue indisponible';
    showMessage($('#adminMessage'), error.message || 'Impossible de charger le catalogue.', 'error');
  }
}

function renderAdminProducts() {
  const container = $('#adminProducts');
  container.replaceChildren();
  const products = adminState.products.slice().sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999) || String(a.name).localeCompare(String(b.name)));
  $('#catalogMeta').textContent = products.length + (products.length === 1 ? ' produit' : ' produits') + ' · prix et visibilité synchronisés avec la boutique';
  if (!products.length) {
    container.appendChild(node('p', 'admin-lead', 'Aucun produit. Ajoutez votre premier produit pour commencer.'));
    return;
  }
  products.forEach(product => container.appendChild(createAdminProduct(product)));
}

function createAdminProduct(product) {
  const card = node('article', 'admin-product');
  const main = node('div', 'admin-product-main');
  const thumb = node('div', 'admin-thumb');
  if (product.imageUrl) {
    const image = node('img');
    image.src = product.imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    thumb.appendChild(image);
  } else {
    thumb.textContent = 'A.';
  }
  const detail = node('div', 'admin-product-detail');
  const title = node('h2', 'admin-product-title', product.name || '(sans nom)');
  title.appendChild(node('span', 'status-pill' + (product.active ? '' : ' inactive'), product.active ? 'Visible' : 'Archivé'));
  detail.appendChild(title);
  detail.appendChild(node('p', 'admin-product-meta', product.id + ' · ' + (product.category === 'homme' ? 'Pour lui' : 'Pour elle')));
  const priceText = Object.entries(product.sizes || {}).map(([size, price]) => size + ' : ' + formatMoney(price)).join(' · ');
  detail.appendChild(node('p', 'admin-product-prices', priceText || 'Aucun format')); 
  if (product.description) detail.appendChild(node('p', 'admin-product-meta', product.description));
  main.append(thumb, detail);
  const actions = node('div', 'admin-product-actions');
  const edit = node('button', 'small-button', 'Modifier');
  edit.type = 'button';
  edit.addEventListener('click', () => openEditor(product));
  actions.appendChild(edit);
  if (product.active) {
    const archive = node('button', 'small-button small-button-danger', 'Archiver');
    archive.type = 'button';
    archive.addEventListener('click', () => archiveProduct(product));
    actions.appendChild(archive);
  }
  card.append(main, actions);
  return card;
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function openEditor(product) {
  adminState.editingId = product ? product.id : null;
  adminState.idWasEdited = Boolean(product);
  adminState.pendingImage = null;
  adminState.imageUploadComplete = true;
  adminState.imageUrl = product ? String(product.imageUrl || '') : '';
  const form = $('#productForm');
  form.reset();
  $('#productDialogTitle').textContent = product ? 'Modifier le produit' : 'Nouveau produit';
  $('#productId').value = product ? product.id : '';
  $('#productId').readOnly = Boolean(product);
  $('#productName').value = product ? product.name || '' : '';
  $('#productCategory').value = product ? product.category || 'femelle' : 'femelle';
  $('#productBadge').value = product ? product.badge || '' : '';
  $('#productDescription').value = product ? product.description || '' : '';
  $('#productSortOrder').value = product ? Number(product.sortOrder) || 999 : 999;
  $('#productActive').checked = product ? product.active === true : true;
  $('#productImage').value = '';
  $('#priceEditor').replaceChildren();
  const sizes = product && product.sizes ? Object.entries(product.sizes) : [['10ml', '']];
  sizes.forEach(([size, price]) => addPriceRow(size, price));
  showMessage($('#editorMessage'), '', 'info');
  renderImagePreview(adminState.imageUrl, product ? 'Photo actuelle' : 'Aucune photo sélectionnée.');
  $('#productDialog').showModal();
  $('#productName').focus();
}

function addPriceRow(size, price) {
  if ($('#priceEditor').querySelectorAll('.price-row').length >= 12) {
    showMessage($('#editorMessage'), 'Maximum 12 formats par produit.', 'error');
    return;
  }
  const row = node('div', 'price-row');
  const sizeInput = node('input');
  sizeInput.type = 'text'; sizeInput.maxLength = 30; sizeInput.required = true; sizeInput.placeholder = 'Ex. 10ml'; sizeInput.value = size || ''; sizeInput.setAttribute('aria-label', 'Nom du format');
  const priceInput = node('input');
  priceInput.type = 'number'; priceInput.min = '0.01'; priceInput.max = '100000'; priceInput.step = '0.01'; priceInput.required = true; priceInput.placeholder = 'Prix DH'; priceInput.value = price === '' || price == null ? '' : String(price); priceInput.setAttribute('aria-label', 'Prix en dirhams');
  const remove = node('button', '', '×');
  remove.type = 'button'; remove.setAttribute('aria-label', 'Retirer ce format');
  remove.addEventListener('click', () => {
    row.remove();
    if (!$('#priceEditor').querySelector('.price-row')) addPriceRow('', '');
  });
  row.append(sizeInput, priceInput, remove);
  $('#priceEditor').appendChild(row);
}

function renderImagePreview(url, message) {
  const preview = $('#imagePreview');
  preview.replaceChildren();
  if (url) {
    const image = node('img');
    image.src = url;
    image.alt = 'Aperçu de la photo du produit';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.alt = 'Aperçu indisponible'; }, { once: true });
    preview.appendChild(image);
  } else {
    preview.appendChild(node('div', 'admin-thumb', 'A.'));
  }
  preview.appendChild(node('p', '', message || (url ? 'Photo prête à être enregistrée.' : 'Aucune photo sélectionnée.')));
}

function collectProductForm() {
  const sizes = {};
  const seenSizes = new Set();
  const rows = Array.from($('#priceEditor').querySelectorAll('.price-row'));
  if (!rows.length) throw new Error('Ajoutez au moins un format avec un prix.');
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const size = inputs[0].value.trim();
    const priceText = inputs[1].value;
    if (!size || priceText === '') throw new Error('Chaque format doit avoir un nom et un prix.');
    if (seenSizes.has(size)) throw new Error('Deux formats portent le même nom : ' + size + '.');
    const price = Number(priceText);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) throw new Error('Chaque prix doit être supérieur à zéro.');
    seenSizes.add(size);
    sizes[size] = price;
  });
  const id = $('#productId').value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Identifiant invalide. Utilisez des lettres minuscules, chiffres et tirets.');
  const name = $('#productName').value.trim();
  if (!name) throw new Error('Le nom du produit est obligatoire.');
  return {
    id,
    name,
    category: $('#productCategory').value,
    description: $('#productDescription').value.trim(),
    badge: $('#productBadge').value.trim(),
    sortOrder: Number($('#productSortOrder').value) || 999,
    active: $('#productActive').checked,
    imageUrl: adminState.imageUrl,
    sizes
  };
}

async function saveProduct(event) {
  event.preventDefault();
  const button = $('#saveProductBtn');
  if (adminState.pendingImage && !adminState.imageUploadComplete) {
    showMessage($('#editorMessage'), 'Téléversez la nouvelle photo avant d’enregistrer le produit.', 'error');
    return;
  }
  let product;
  try { product = collectProductForm(); } catch (error) {
    showMessage($('#editorMessage'), error.message, 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  showMessage($('#editorMessage'), 'Enregistrement du produit…', 'info');
  try {
    const result = await apiPost({ action: 'adminSaveProduct', token: adminState.token, product });
    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') return expireSession(result.message);
      throw new Error(result.message || 'Impossible d’enregistrer le produit.');
    }
    $('#productDialog').close();
    showMessage($('#adminMessage'), 'Produit enregistré.', 'success');
    await loadProducts();
    showToast('Catalogue mis à jour.', 'success');
  } catch (error) {
    showMessage($('#editorMessage'), error.message || 'Erreur lors de l’enregistrement.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Enregistrer le produit';
  }
}

async function archiveProduct(product) {
  const confirmed = window.confirm('Archiver « ' + product.name + ' » ? Le produit sera masqué dans la boutique, mais les anciennes commandes seront conservées.');
  if (!confirmed) return;
  try {
    const result = await apiPost({ action: 'adminArchiveProduct', token: adminState.token, id: product.id });
    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') return expireSession(result.message);
      throw new Error(result.message || 'Impossible d’archiver ce produit.');
    }
    await loadProducts();
    showMessage($('#adminMessage'), 'Produit archivé.', 'success');
  } catch (error) {
    showMessage($('#adminMessage'), error.message || 'Erreur lors de l’archivage.', 'error');
  }
}

async function uploadImage() {
  const file = adminState.pendingImage;
  if (!file) {
    showMessage($('#editorMessage'), 'Choisissez une image avant de la téléverser.', 'error');
    return;
  }
  const button = $('#uploadImageBtn');
  button.disabled = true;
  button.textContent = 'Préparation…';
  showMessage($('#editorMessage'), 'Compression et téléversement de la photo…', 'info');
  try {
    const blob = await resizeImage(file, 1500, 0.84);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('Format d’image non pris en charge.');
    const base64 = await blobToBase64(blob);
    if (base64.length > 2200000) throw new Error('L’image reste trop volumineuse après compression. Choisissez une image plus petite.');
    const result = await apiPost({
      action: 'adminUploadImage',
      token: adminState.token,
      name: file.name || 'arovia-product',
      mime: blob.type,
      base64
    });
    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') return expireSession(result.message);
      throw new Error(result.message || 'Le téléversement a échoué.');
    }
    adminState.imageUrl = result.url || result.fallbackUrl || '';
    adminState.pendingImage = null;
    adminState.imageUploadComplete = true;
    $('#productImage').value = '';
    renderImagePreview(adminState.imageUrl, 'Photo téléversée. Elle sera enregistrée avec le produit.');
    showMessage($('#editorMessage'), 'Image téléversée avec succès.', 'success');
  } catch (error) {
    showMessage($('#editorMessage'), error.message || 'Impossible de téléverser l’image.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Téléverser l’image';
  }
}

async function resizeImage(file, maxSide, quality) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choisissez une image JPG, PNG ou WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Fichier trop volumineux. Maximum avant compression : 12 Mo.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (_) {
    throw new Error('Impossible de lire cette image. Essayez un autre fichier.');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) { bitmap.close && bitmap.close(); throw new Error('Compression d’image indisponible.'); }
  context.fillStyle = '#f8f6f1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Échec de la compression de l’image.');
  return blob;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier compressé.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma === -1) return reject(new Error('Image invalide après compression.'));
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function expireSession(message) {
  saveToken('');
  setLoggedIn(false);
  showMessage($('#loginMessage'), message || 'Session expirée. Reconnectez-vous.', 'error');
}

async function logout() {
  const token = adminState.token;
  saveToken('');
  adminState.products = [];
  setLoggedIn(false);
  try { if (token) await apiPost({ action: 'adminLogout', token }); } catch (_) { /* local logout still completes */ }
  showMessage($('#loginMessage'), 'Vous êtes déconnecté.', 'info');
}

function wireEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#newProductBtn').addEventListener('click', () => openEditor(null));
  $('#logoutBtn').addEventListener('click', logout);
  $('#productForm').addEventListener('submit', saveProduct);
  $('#closeProductDialog').addEventListener('click', () => $('#productDialog').close());
  $('#cancelProductBtn').addEventListener('click', () => $('#productDialog').close());
  $('#addPriceBtn').addEventListener('click', () => addPriceRow('', ''));
  $('#uploadImageBtn').addEventListener('click', uploadImage);
  $('#productImage').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    adminState.pendingImage = file || null;
    adminState.imageUploadComplete = !file;
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      renderImagePreview(previewUrl, 'Nouvelle photo choisie. Cliquez sur « Téléverser l’image » avant d’enregistrer.');
    } else {
      renderImagePreview(adminState.imageUrl, 'Photo actuelle.');
    }
  });
  $('#productName').addEventListener('input', () => {
    if (!adminState.editingId && !adminState.idWasEdited) $('#productId').value = slugify($('#productName').value);
  });
  $('#productId').addEventListener('input', () => { adminState.idWasEdited = true; });
  $('#productDialog').addEventListener('click', event => { if (event.target === $('#productDialog')) $('#productDialog').close(); });
  $('#productDialog').addEventListener('close', () => {
    const previewImage = $('#imagePreview img');
    if (previewImage && previewImage.src.startsWith('blob:')) URL.revokeObjectURL(previewImage.src);
    adminState.pendingImage = null;
  });
}

async function restoreSession() {
  let token = '';
  try { token = sessionStorage.getItem(ADMIN_CONFIG.tokenKey) || ''; } catch (_) {}
  if (!token) { setLoggedIn(false); return; }
  adminState.token = token;
  setLoggedIn(true);
  await loadProducts();
  if (!adminState.token) setLoggedIn(false);
}

wireEvents();
restoreSession();
