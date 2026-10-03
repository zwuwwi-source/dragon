// ============================================
// Dragon Shop — WebApp
// ============================================
const CFG = window.DRAGON_CONFIG;
const API_URL = CFG.API_BASE + "/api/products";
const PROMO_CHECK_URL = CFG.API_BASE + "/api/check_promo";
const PROMO_USE_URL = CFG.API_BASE + "/api/use_promo";
const REVIEWS_URL = CFG.API_BASE + "/api/reviews";
const ORDERS_URL = CFG.API_BASE + "/api/orders";
const PLACEHOLDER = CFG.PLACEHOLDER;
const MANAGER = CFG.MANAGER;

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#0e0f0e');
    tg.setBackgroundColor?.('#0e0f0e');
}

const CATEGORY_NAMES = {
    liquids: 'Жидкости', disposables: 'Одноразки',
    consumables: 'Расходники', pods: 'Поды',
    snus: 'Снюс', plates: 'Пластинки', boosters: 'Никобустеры'
};

let PRODUCTS = [];
let productsLoaded = false;
let currentProductId = null;
let currentQty = 1;
let activeCat = 'all';
let searchQuery = '';
let searchPriceFrom = 0;
let searchPriceTo = Infinity;

let deliveryType = 'meeting';
let paymentType = 'cash';
let appliedPromo = null;
let comment = '';

let currentRating = 0;

// ===== Helpers =====
function haptic(type = 'light') {
    try {
        if (!tg?.HapticFeedback) return;
        if (type === 'light' || type === 'medium' || type === 'heavy')
            tg.HapticFeedback.impactOccurred(type);
        else tg.HapticFeedback.notificationOccurred(type);
    } catch {}
}

function showToast(text) {
    let el = document.getElementById('toastMsg');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toastMsg';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
}

function getItem(id) { return PRODUCTS.find(p => p.id === id); }

// ===== Storage =====
function getCart() { try { return JSON.parse(localStorage.getItem('dragon_cart') || '{}'); } catch { return {}; } }
function saveCart(c) { localStorage.setItem('dragon_cart', JSON.stringify(c)); updateNavBadge(); }
function addToCart(id, qty = 1) { const c = getCart(); c[id] = (c[id] || 0) + qty; saveCart(c); }
function removeFromCart(id) { const c = getCart(); delete c[id]; saveCart(c); }
function setQty(id, qty) { const c = getCart(); if (qty <= 0) delete c[id]; else c[id] = qty; saveCart(c); }
function cartCount(c) { return Object.values(c).reduce((a, b) => a + b, 0); }

function updateNavBadge() {
    const badge = document.getElementById('navBadge');
    if (!badge) return;
    const count = cartCount(getCart());
    if (count > 0) { badge.textContent = count; badge.classList.add('show'); }
    else badge.classList.remove('show');
}

function getFavorites() { try { return JSON.parse(localStorage.getItem('dragon_favorites') || '[]'); } catch { return []; } }
function saveFavorites(l) { localStorage.setItem('dragon_favorites', JSON.stringify(l)); }
function isFavorite(id) { return getFavorites().includes(id); }
function toggleFavorite(id) {
    let f = getFavorites();
    f = f.includes(id) ? f.filter(x => x !== id) : [...f, id];
    saveFavorites(f);
    haptic('light');
}

function loadCheckoutState() {
    try {
        const s = JSON.parse(localStorage.getItem('dragon_checkout') || '{}');
        if (s.deliveryType) deliveryType = s.deliveryType;
        if (s.paymentType) paymentType = s.paymentType;
        if (s.appliedPromo) appliedPromo = s.appliedPromo;
        if (s.comment) comment = s.comment;
    } catch {}
}
function saveCheckoutState() {
    localStorage.setItem('dragon_checkout', JSON.stringify({ deliveryType, paymentType, appliedPromo, comment }));
}

// ===== Load products =====
async function loadProducts() {
    try {
        const res = await fetch(API_URL, { cache: "no-store" });
        PRODUCTS = await res.json();
        localStorage.setItem('dragon_products_cache', JSON.stringify(PRODUCTS));
    } catch (e) {
        console.log("API error:", e);
        try { PRODUCTS = JSON.parse(localStorage.getItem('dragon_products_cache') || '[]'); }
        catch { PRODUCTS = []; }
    }
    productsLoaded = true;
    renderCatalog();
    renderCart();
    renderFavorites();
}

// ===== Search =====
function toggleSearch() {
    document.getElementById('searchPanel')?.classList.toggle('open');
}
function doSearch() {
    const q = document.getElementById('searchKeyword')?.value.trim().toLowerCase() || '';
    const from = parseFloat(document.getElementById('searchPriceFrom')?.value) || 0;
    const to = parseFloat(document.getElementById('searchPriceTo')?.value) || Infinity;
    searchQuery = q; searchPriceFrom = from; searchPriceTo = to;
    renderCatalog();
    document.getElementById('searchPanel')?.classList.remove('open');
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

function getCatFromURL() {
    const p = new URLSearchParams(window.location.search);
    return p.get('cat') || 'all';
}

// ===== Catalog =====
function productCardHTML(p, opts = {}) {
    const cart = getCart();
    const inCart = cart[p.id] || 0;
    const fav = isFavorite(p.id);
    const badge = inCart > 0 ? `<div class="product-cart-badge">${inCart}</div>` : '';
    const favBtn = `<button class="favorite-btn ${fav ? 'active' : ''}"
        onclick="event.stopPropagation(); handleFavorite('${p.id}')">♡</button>`;
    const img = p.image || PLACEHOLDER;
    return `
        <div class="product-card" onclick="openProduct('${p.id}')">
            ${opts.hideFav ? '' : favBtn}
            ${badge}
            <img class="product-img" src="${img}" alt="${p.name}" onerror="this.src='${PLACEHOLDER}'">
            <div class="product-body">
                <div class="product-name">${p.name}</div>
                <div class="product-flavor">${p.flavor || ''}</div>
                <div class="product-stock ${p.inStock ? '' : 'out'}">${p.inStock ? 'В наличии' : 'Нет'}</div>
                <div class="product-bottom">
                    <div class="product-price">${p.price} BYN</div>
                    <button class="add-btn" ${p.inStock ? '' : 'disabled'}
                        onclick="event.stopPropagation(); handleAdd('${p.id}')">+</button>
                </div>
            </div>
        </div>`;
}

function renderCatalog() {
    const container = document.getElementById('products');
    if (!container) return;
    const empty = document.getElementById('empty');
    const countEl = document.getElementById('catalogCount');

    activeCat = getCatFromURL();
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === activeCat);
    });

    const q = searchQuery.trim().toLowerCase();
    const list = PRODUCTS.filter(p => {
        const catOk = activeCat === 'all' || p.category === activeCat;
        const searchOk = !q ||
            (p.name || '').toLowerCase().includes(q) ||
            (p.brand || '').toLowerCase().includes(q) ||
            (p.flavor || '').toLowerCase().includes(q);
        const priceOk = p.price >= searchPriceFrom && p.price <= searchPriceTo;
        return catOk && searchOk && priceOk;
    });

    if (countEl) countEl.textContent = `Найдено: ${list.length}`;

    if (list.length === 0) {
        container.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    container.innerHTML = list.map(p => productCardHTML(p)).join('');
}

function handleFavorite(id) {
    toggleFavorite(id);
    renderCatalog();
    renderFavorites();
    showToast(isFavorite(id) ? 'Добавлено в избранное' : 'Удалено');
}

function handleAdd(id) {
    const p = getItem(id);
    if (!p || !p.inStock) return;
    addToCart(id);
    haptic('light');
    renderCatalog();
    showToast('Добавлено в корзину');
}

// ===== Product modal =====
function openProduct(id) {
    const p = getItem(id);
    if (!p) return;
    currentProductId = id;
    currentQty = 1;
    const modal = document.getElementById('productModal');
    if (!modal) return;
    const img = p.image || PLACEHOLDER;

    modal.innerHTML = `
        <div class="product-sheet" id="productSheet" onclick="event.stopPropagation()">
            <button class="sheet-close" onclick="closeProduct()">✕</button>
            <div class="sheet-img-wrap">
                <img class="sheet-img" src="${img}" alt="${p.name}" onerror="this.src='${PLACEHOLDER}'">
            </div>
            <div class="sheet-category">${CATEGORY_NAMES[p.category] || p.category}</div>
            <div class="sheet-name">${p.name}</div>
            <div class="sheet-rows">
                <div class="sheet-row"><span>Бренд</span><span>${p.brand || '—'}</span></div>
                <div class="sheet-row"><span>Вкус</span><span>${p.flavor || '—'}</span></div>
                <div class="sheet-row"><span>Крепость</span><span>${p.strength || '—'}</span></div>
                <div class="sheet-row"><span>Наличие</span><span>${p.inStock ? 'В наличии' : 'Нет'}</span></div>
            </div>
            <div class="sheet-price" id="sheetTotal">${p.price.toFixed(2)} BYN</div>
            <div class="sheet-qty-label">Количество</div>
            <div class="sheet-qty">
                <button class="qty-btn" onclick="changeSheetQty(-1)">−</button>
                <span class="qty-value" id="sheetQty">1</span>
                <button class="qty-btn" onclick="changeSheetQty(1)">+</button>
            </div>
            <button class="sheet-add-btn" onclick="addFromSheet()">
                В корзину · <span id="sheetBtnPrice">${p.price.toFixed(2)}</span> BYN
            </button>
        </div>`;
    modal.classList.add('open');
    bindSheetSwipe();
}

function bindSheetSwipe() {
    const sheet = document.getElementById('productSheet');
    if (!sheet) return;
    let startY = 0, curY = 0, dragging = false;
    sheet.addEventListener('touchstart', e => {
        if (sheet.scrollTop > 0) return;
        startY = e.touches[0].clientY; dragging = true;
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
        if (!dragging) return;
        curY = e.touches[0].clientY;
        const d = curY - startY;
        if (d > 0) sheet.style.transform = `translateY(${d}px)`;
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
        if (!dragging) return;
        const d = curY - startY;
        sheet.style.transform = '';
        dragging = false;
        if (d > 100) closeProduct();
        startY = curY = 0;
    });
}

function closeProduct() {
    document.getElementById('productModal')?.classList.remove('open');
    currentProductId = null;
}

function changeSheetQty(delta) {
    if (currentQty + delta < 1) return;
    currentQty += delta;
    const p = getItem(currentProductId);
    if (!p) return;
    document.getElementById('sheetQty').textContent = currentQty;
    const total = p.price * currentQty;
    document.getElementById('sheetTotal').textContent = total.toFixed(2) + ' BYN';
    document.getElementById('sheetBtnPrice').textContent = total.toFixed(2);
}

function addFromSheet() {
    if (!currentProductId) return;
    const p = getItem(currentProductId);
    if (!p || !p.inStock) return;
    addToCart(currentProductId, currentQty);
    haptic('light');
    renderCatalog();
    closeProduct();
    showToast(`Добавлено ${currentQty} шт.`);
}

// ============================================
// ============ КОРЗИНА ========================
// ============================================
function renderCart() {
    const container = document.getElementById('cartContent');
    if (!container) return;
    const cart = getCart();
    const ids = Object.keys(cart);

    if (ids.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty-icon">◻</div>
                <div class="cart-empty-title">Корзина пуста</div>
                <div class="cart-empty-text">Добавьте товары из каталога</div>
                <a href="catalog.html" class="order-btn" style="display:block;text-decoration:none;text-align:center;max-width:200px;margin:0 auto;">В каталог</a>
            </div>`;
        return;
    }

    let itemsHtml = '', subtotal = 0;
    ids.forEach(id => {
        const item = getItem(id);
        if (!item) { removeFromCart(id); return; }
        const qty = cart[id];
        const sum = item.price * qty;
        subtotal += sum;
        const img = item.image || PLACEHOLDER;
        itemsHtml += `
            <div class="cart-item">
                <img class="cart-item-img" src="${img}" alt="${item.name}" onerror="this.src='${PLACEHOLDER}'">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-flavor">${item.flavor || ''}</div>
                    <div class="cart-item-row">
                        <div class="cart-qty">
                            <button class="qty-btn" onclick="changeQty('${id}', -1)">−</button>
                            <span class="qty-value">${qty}</span>
                            <button class="qty-btn" onclick="changeQty('${id}', 1)">+</button>
                        </div>
                        <button class="remove-btn" onclick="handleRemove('${id}')">Удалить</button>
                    </div>
                </div>
                <div class="cart-item-price">${sum.toFixed(2)} BYN</div>
            </div>`;
    });

    const discPct = appliedPromo ? appliedPromo.percent : 0;
    const discount = subtotal * discPct / 100;
    const total = subtotal - discount;

    container.innerHTML = itemsHtml + `
        <div class="checkout-section">
            <div class="checkout-title">Оформление</div>
            <div class="checkout-hint">Оплата наличными или переводом</div>

            <label class="checkout-label">Способ получения</label>
            <div class="option-group">
                <button class="option-btn ${deliveryType === 'meeting' ? 'active' : ''}" onclick="setDelivery('meeting')">Личная встреча</button>
                <button class="option-btn ${deliveryType === 'delivery' ? 'active' : ''}" onclick="setDelivery('delivery')">Доставка</button>
            </div>
            <div class="option-hint">${deliveryType === 'meeting' ? 'Встреча с курьером' : 'Доставка по городу'}</div>

            <label class="checkout-label">Способ оплаты</label>
            <div class="option-group">
                <button class="option-btn ${paymentType === 'cash' ? 'active' : ''}" onclick="setPayment('cash')">Наличные</button>
                <button class="option-btn ${paymentType === 'card' ? 'active' : ''}" onclick="setPayment('card')">Карта</button>
            </div>
            <div class="option-hint">${paymentType === 'cash' ? 'Оплата при получении' : 'Картой при получении'}</div>

            <label class="checkout-label">Комментарий</label>
            <textarea class="comment-box" id="commentBox" placeholder="Детали заказа...">${comment}</textarea>

            <label class="checkout-label">Промокод</label>
            <div class="promo-row">
                <input type="text" class="promo-input" id="promoInput" placeholder="Код" value="${appliedPromo ? appliedPromo.code : ''}">
                <button class="promo-btn" onclick="applyPromo()">OK</button>
            </div>
            <div class="promo-hint">Есть код? Примените</div>
            <div class="promo-ok ${appliedPromo ? 'show' : ''}" id="promoOk">Промокод применён — скидка ${discPct}%</div>
            <div class="promo-err" id="promoErr">Промокод не найден</div>

            <div class="summary">
                <div class="summary-row"><span>Товары</span><span>${subtotal.toFixed(2)} BYN</span></div>
                <div class="summary-row"><span>Скидка</span><span>−${discount.toFixed(2)} BYN</span></div>
                <div class="summary-row"><span>Доставка</span><span>бесплатно</span></div>
                <div class="summary-row total"><span>Итого</span><span class="summary-value">${total.toFixed(2)} BYN</span></div>
            </div>

            <button class="order-btn" onclick="placeOrder()">Оформить заказ</button>
            <a href="catalog.html" class="order-btn" style="display:block;text-decoration:none;text-align:center;margin-top:12px;background:transparent;border:1px solid var(--border);color:var(--text-main);">Заказать ещё</a>
        </div>`;
}

function changeQty(id, delta) {
    const cart = getCart();
    setQty(id, (cart[id] || 0) + delta);
    renderCart();
}
function handleRemove(id) { removeFromCart(id); renderCart(); }
function setDelivery(t) { deliveryType = t; saveCheckoutState(); renderCart(); }
function setPayment(t) { paymentType = t; saveCheckoutState(); renderCart(); }

async function applyPromo() {
    const input = document.getElementById('promoInput');
    const code = (input?.value || '').trim().toUpperCase();
    const okEl = document.getElementById('promoOk');
    const errEl = document.getElementById('promoErr');
    if (!code) return;
    try {
        const res = await fetch(PROMO_CHECK_URL + "?code=" + encodeURIComponent(code), { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
            appliedPromo = { code: data.code, percent: data.percent };
            saveCheckoutState();
            renderCart();
        } else {
            appliedPromo = null;
            saveCheckoutState();
            errEl?.classList.add('show');
            okEl?.classList.remove('show');
            setTimeout(() => errEl?.classList.remove('show'), 2500);
        }
    } catch (e) {
        errEl?.classList.add('show');
        setTimeout(() => errEl?.classList.remove('show'), 2500);
    }
}

document.addEventListener('input', e => {
    if (e.target && e.target.id === 'commentBox') {
        comment = e.target.value;
        saveCheckoutState();
    }
});

async function placeOrder() {
    const cart = getCart();
    const ids = Object.keys(cart);
    if (ids.length === 0) return;

    let subtotal = 0;
    ids.forEach(id => { const it = getItem(id); if (it) subtotal += it.price * cart[id]; });
    const discPct = appliedPromo ? appliedPromo.percent : 0;
    const discount = subtotal * discPct / 100;
    const total = subtotal - discount;
    const commentText = (document.getElementById('commentBox')?.value || comment).trim();

    if (appliedPromo) {
        try { await fetch(PROMO_USE_URL + "?code=" + encodeURIComponent(appliedPromo.code), { cache: "no-store" }); } catch {}
    }

    const orderData = {
        action: 'new_order',
        order: {
            items: ids.map(id => {
                const it = getItem(id);
                return { name: it.name, flavor: it.flavor, qty: cart[id], price: it.price };
            }),
            subtotal, discount, total,
            delivery: deliveryType, payment: paymentType,
            comment: commentText,
            promo: appliedPromo ? appliedPromo.code : null
        }
    };

    // Локальная копия (на случай оффлайна)
    const orders = JSON.parse(localStorage.getItem('dragon_orders') || '[]');
    orders.unshift({
        date: new Date().toISOString(),
        items: orderData.order.items,
        subtotal, discount, total,
        delivery: deliveryType, payment: paymentType,
        comment: commentText, status: 'Новый',
        promo: appliedPromo ? appliedPromo.code : null
    });
    localStorage.setItem('dragon_orders', JSON.stringify(orders));

    saveCart({});
    haptic('success');

    if (tg?.sendData) {
        try { tg.sendData(JSON.stringify(orderData)); } catch {}
    }

    // Резервный путь — сообщение менеджеру
    let text = 'Новый заказ Dragon Shop:\n\n';
    orderData.order.items.forEach(it => {
        text += `• ${it.name} (${it.flavor}) × ${it.qty} = ${(it.price * it.qty).toFixed(2)} BYN\n`;
    });
    if (appliedPromo) text += `\nПромокод: ${appliedPromo.code} (−${discount.toFixed(2)} BYN)`;
    text += `\n\nИтого: ${total.toFixed(2)} BYN`;
    text += `\nПолучение: ${deliveryType === 'meeting' ? 'Личная встреча' : 'Доставка'}`;
    text += `\nОплата: ${paymentType === 'cash' ? 'Наличные' : 'Карта'}`;
    if (commentText) text += `\nКомментарий: ${commentText}`;

    const url = `https://t.me/${MANAGER}?text=${encodeURIComponent(text)}`;
    setTimeout(() => {
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, '_blank');
    }, 400);

    setTimeout(() => {
        appliedPromo = null;
        saveCheckoutState();
        renderCart();
        renderOrders();
    }, 500);
}

document.getElementById('clearBtn')?.addEventListener('click', () => {
    if (confirm('Очистить корзину?')) { saveCart({}); renderCart(); }
});

// ============================================
// ============ ИЗБРАННОЕ ======================
// ============================================
function renderFavorites() {
    const container = document.getElementById('favoritesContent');
    if (!container) return;
    const favs = getFavorites();
    if (favs.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty-icon">♡</div>
                <div class="cart-empty-title">Пусто</div>
                <div class="cart-empty-text">Добавляйте товары в избранное</div>
                <a href="catalog.html" class="order-btn" style="display:block;text-decoration:none;text-align:center;max-width:200px;margin:0 auto;">В каталог</a>
            </div>`;
        return;
    }
    const list = PRODUCTS.filter(p => favs.includes(p.id));
    container.innerHTML = `<div class="products">` +
        list.map(p => productCardHTML(p, { hideFav: true })).join('') + `</div>`;
}

// ============================================
// ============ ЗАКАЗЫ =========================
// ============================================
async function renderOrders() {
    const container = document.getElementById('ordersContent');
    if (!container) return;

    let orders = [];
    // 1) пробуем сервер
    try {
        const initData = tg?.initData || "";
        if (initData) {
            const res = await fetch(`${ORDERS_URL}?initData=${encodeURIComponent(initData)}`, { cache: "no-store" });
            const data = await res.json();
            if (data.ok && Array.isArray(data.orders)) orders = data.orders;
        }
    } catch (e) { console.log("server orders error", e); }

    // 2) fallback — локальные
    if (orders.length === 0) {
        try { orders = JSON.parse(localStorage.getItem('dragon_orders') || '[]'); }
        catch { orders = []; }
    }

    if (orders.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty-icon">≡</div>
                <div class="cart-empty-title">Заказов нет</div>
                <div class="cart-empty-text">Оформите первый заказ</div>
                <a href="catalog.html" class="order-btn" style="display:block;text-decoration:none;text-align:center;max-width:200px;margin:0 auto;">В каталог</a>
            </div>`;
        return;
    }

    container.innerHTML = orders.map((order, idx) => {
        const date = new Date(order.date);
        const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
            + ', ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const status = order.status || 'Новый';
        const statusClass = status === 'Выполнен' ? 'done' : status === 'Отменён' ? 'cancel' : 'new';
        const orderNum = order.number || (221 + idx);
        const deliveryText = order.delivery === 'meeting' ? 'Личная встреча' : 'Доставка';
        const paymentText = order.payment === 'cash' ? 'Наличные' : 'Карта';
        const itemsHtml = (order.items || []).map(it => `
            <div class="order-item-line">
                ${it.name} ${it.flavor ? `(${it.flavor})` : ''} <span class="qty">×${it.qty}</span>
            </div>
        `).join('');

        return `
            <div class="order-card">
                <div class="order-head">
                    <div class="order-date">${dateStr}</div>
                    <div class="order-status-badge ${statusClass}">${status}</div>
                </div>
                <div class="order-num">Заказ #${orderNum}</div>
                <div class="order-total-big">${(order.total || 0).toFixed(2)} BYN</div>
                <div class="order-meta-lines">
                    <div>${deliveryText}</div>
                    <div>Оплата: <b>${paymentText}</b></div>
                </div>
                <div class="order-items-list">${itemsHtml}</div>
                <button class="order-manager-btn" onclick="openManagerModal(${orderNum})">
                    Связаться с менеджером
                </button>
            </div>`;
    }).join('');
}

function openManagerModal(orderNum) {
    const modal = document.getElementById('managerModal');
    if (!modal) {
        const msg = encodeURIComponent(`Здравствуйте! По заказу #${orderNum}...`);
        const url = `https://t.me/${MANAGER}?text=${msg}`;
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, '_blank');
        return;
    }
    const ta = document.getElementById('managerMessage');
    if (ta) ta.value = `Здравствуйте! По заказу #${orderNum}...`;
    modal.classList.add('open');
}
function closeManagerModal() { document.getElementById('managerModal')?.classList.remove('open'); }
function sendManagerMessage() {
    const msg = document.getElementById('managerMessage')?.value.trim() || '';
    const url = `https://t.me/${MANAGER}?text=${encodeURIComponent(msg)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
    closeManagerModal();
}

// ============================================
// ============ ОТЗЫВЫ =========================
// ============================================
document.getElementById('reviewStars')?.addEventListener('click', e => {
    const btn = e.target.closest('.star-btn');
    if (!btn) return;
    currentRating = parseInt(btn.dataset.star);
    document.querySelectorAll('.star-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.star) <= currentRating);
    });
    haptic('light');
});

async function submitReview() {
    const textEl = document.getElementById('reviewText');
    const text = (textEl?.value || '').trim();
    if (currentRating === 0) return showToast('Поставьте оценку');
    if (!text) return showToast('Напишите отзыв');

    const user = tg?.initDataUnsafe?.user;
    const name = user ? (user.first_name || user.username || 'Аноним') : 'Аноним';

    try {
        const res = await fetch(REVIEWS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, text, rating: currentRating,
                initData: tg?.initData || ""
            })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ Отзыв отправлен!');
            textEl.value = '';
            currentRating = 0;
            document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('active'));
        } else showToast('Ошибка отправки');
    } catch (e) {
        console.log("Review error:", e);
        showToast('Ошибка отправки');
    }
}

async function loadReviews() {
    const container = document.getElementById('reviewsContent');
    if (!container) return;
    try {
        const res = await fetch(REVIEWS_URL, { cache: "no-store" });
        const reviews = await res.json();
        if (reviews.length === 0) {
            container.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">★</div>
                    <div class="cart-empty-title">Пока нет отзывов</div>
                    <div class="cart-empty-text">Станьте первым!</div>
                </div>`;
            return;
        }
        container.innerHTML = reviews.map(r => {
            const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
            const date = new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `
                <div class="review-card">
                    <div class="review-head">
                        <div class="review-author">${r.name}</div>
                        <div class="review-date">${date}</div>
                    </div>
                    <div class="review-stars-display">${stars}</div>
                    <div class="review-text">${r.text}</div>
                </div>`;
        }).join('');
    } catch (e) { console.log("Reviews load error:", e); }
}

// ============================================
// ============ ИНИЦИАЛИЗАЦИЯ ==================
// ============================================
document.getElementById('filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    window.location.href = `catalog.html?cat=${btn.dataset.cat}`;
});

loadCheckoutState();
updateNavBadge();
renderCart();
renderFavorites();
renderOrders();

if (document.getElementById('reviewsContent')) loadReviews();

if (document.getElementById('products') || document.getElementById('favoritesContent') ||
    document.getElementById('cartContent') || document.getElementById('ordersContent')) {
    loadProducts();
}
