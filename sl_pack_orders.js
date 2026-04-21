/**
 * sl_pack_orders.js — Pack Orders Suitelet (Single-Page Application)
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Script ID  : customscript_lime_sl_pack_fulfill
 * Deploy ID  : customdeploy_lime_sl_pack_fulfill
 *
 * Two-screen SPA for warehouse staff to pack Transfer Order fulfillments:
 *
 *   SCREEN 1 — Order Selection
 *     · Lists all Item Fulfillments in "Picked" status at the user's location.
 *     · Accepts optional `ifId` URL parameter — auto-selects the matching order.
 *     · "Build Pack →" moves to the packing builder.
 *
 *   SCREEN 2 — Packing Builder
 *     · User selects a Package Type (auto-fills L/W/Dim Unit), enters H/Weight,
 *       sets Quantity, and clicks "Add Package(s)" to bulk-create package cards.
 *     · Each generated card is individually editable before submission.
 *     · "Submit Packing" calls rl_pack_orders → submitPacking:
 *         - Creates Shipment Summary record (with aggregate weight and volume)
 *         - Creates Ship Unit record per package (with individual volume)
 *         - Updates fulfillments to "Packed" status
 *     · On success, posts PACKING_COMPLETE message to opener.
 */
define([
    'N/runtime',
    'N/url',
    'N/log',
    '/SuiteScripts/Packing/lib/pack_config',
], (runtime, url, log, CONFIG) => {

    const { SCRIPTS } = CONFIG;

    const onRequest = (ctx) => {
        log.debug('POST Triggered');
        if (ctx.request.method !== 'GET') {
            ctx.response.write(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        try {
            log.debug({
                title: 'Packing UI Loaded',
                details: 'User: ' + runtime.getCurrentUser().name
            });
            const restletUrl = url.resolveScript({
                scriptId: SCRIPTS.PACK_RL,
                deploymentId: SCRIPTS.PACK_RL_DEPLOY,
                returnExternalUrl: false,
            });
            log.debug('Restlet called',restletUrl);

            const ifId = ctx.request.parameters.ifId || '';

            ctx.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=UTF-8' });
            ctx.response.write(buildPage(restletUrl, ifId));
        } catch (e) {
            log.error({ title: 'sl_pack_orders GET error', details: e });
            ctx.response.write('<p style="color:red;font-family:sans-serif">Error: ' + e.message + '</p>');
        }
    };

    const buildPage = (restletUrl, ifId) => /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Pack Orders</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    :root {
      --navy: #003366; --navy2: #004080; --blue-lt: #dce8f8;
      --border: #ccc; --text: #222; --muted: #666;
      --danger: #c00; --success: #1a6e1a; --warn: #b35c00;
      --green-lt: #edfaed; --red-lt: #fff0f0; --yellow-lt: #fffbe6;
    }
    body { font-family: Arial, sans-serif; font-size: 14px; color: var(--text);
           background: #f0f2f5; min-height: 100vh; display: flex; flex-direction: column; }

    /* ── Screens ── */
    .screen { display: none; flex-direction: column; height: 100vh; overflow: hidden; }
    .screen.active { display: flex; }

    /* ── Header / Footer ── */
    header { background: var(--navy); color: #fff; padding: 11px 14px;
             display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    header h1 { font-size: 15px; font-weight: bold; flex: 1; }
    header .loc { font-size: 12px; opacity: .8; }
    .body { flex: 1; overflow-y: auto; padding: 12px; }
    footer { background: #efefef; border-top: 1px solid var(--border);
             padding: 10px 12px; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    .footer-msg { flex: 1; font-size: 12px; color: var(--danger); }

    /* ── Buttons ── */
    .btn { padding: 9px 18px; border: none; border-radius: 4px; cursor: pointer;
           font-size: 14px; font-weight: bold; touch-action: manipulation; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn-primary   { background: var(--navy);   color: #fff; }
    .btn-primary:hover:not(:disabled)   { background: var(--navy2); }
    .btn-secondary { background: #ddd; color: #333; }
    .btn-secondary:hover:not(:disabled) { background: #c8c8c8; }
    .btn-danger    { background: var(--danger); color: #fff; }
    .btn-danger:hover:not(:disabled)    { background: #a00; }
    .btn-success   { background: #1a6e1a; color: #fff; }
    .btn-success:hover:not(:disabled)   { background: #155815; }
    .btn-sm { padding: 5px 10px; font-size: 12px; font-weight: normal; }

    /* ── Scan bar ── */
    .scan-bar { display: flex; gap: 8px; margin-bottom: 10px; }
    .scan-bar input { flex: 1; padding: 9px 12px; border: 2px solid var(--navy);
                      border-radius: 4px; font-size: 14px; }
    .scan-bar input:focus { outline: none; border-color: #0055aa;
                            box-shadow: 0 0 0 2px rgba(0,85,170,.2); }

    /* ── Order cards ── */
    .order-list { display: flex; flex-direction: column; gap: 8px; }
    .order-card { background: #fff; border: 1px solid var(--border); border-radius: 6px;
                  padding: 10px 12px; cursor: pointer; transition: border-color .15s; }
    .order-card:hover { border-color: var(--navy); }
    .order-card.selected { border-color: var(--navy); background: var(--blue-lt); }
    .order-card-top { display: flex; align-items: center; gap: 10px; }
    .order-cb  { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
    .order-num  { font-weight: bold; font-size: 15px; flex: 1; }
    .order-dest { font-size: 12px; color: var(--muted); }
    .order-ifs  { font-size: 12px; color: var(--muted); margin-top: 5px; padding-left: 28px; }

    /* ── Alerts ── */
    .alert { border-radius: 4px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px; }
    .alert-info  { background: #e8f0fb; border: 1px solid #b0c8f0; color: #003; }
    .alert-error { background: var(--red-lt);   border: 1px solid #f0b0b0; color: var(--danger); }
    .alert-ok    { background: var(--green-lt); border: 1px solid #a0d0a0; color: var(--success); }
    .alert-warn  { background: var(--yellow-lt);border: 1px solid #e0c050; color: var(--warn); }

    /* ── Spinner ── */
    .spinner-wrap { text-align: center; padding: 40px 20px; color: var(--muted); }
    .spinner { display: inline-block; width: 28px; height: 28px; border: 4px solid #ccc;
               border-top-color: var(--navy); border-radius: 50%;
               animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Pallet Builder (Screen 2) ── */
    .pallet-scroll { display: flex; flex-direction: column; gap: 10px; }

    /* Add-package form card */
    .add-form-card { background: #fff; border: 1px solid var(--navy); border-radius: 6px;
                     padding: 10px; margin-bottom: 4px; }
    .add-form-title { font-weight: bold; font-size: 13px; color: var(--navy); margin-bottom: 8px; }

    /* Pallet card */
    .pallet-card { background: #fff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; flex-shrink: 0; }
    .pallet-card-hdr { background: #e8eef6; padding: 7px 10px; display: flex;
                       align-items: center; gap: 8px; border-bottom: 1px solid var(--border); }
    .pallet-num { font-weight: bold; font-size: 13px; flex: 1; }
    .pallet-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .pallet-dims { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-end; }
    .pallet-field { display: flex; flex-direction: column; gap: 2px; }
    .pallet-field label { font-size: 11px; color: var(--muted); font-weight: bold; }
    .pallet-field select, .pallet-field input[type="number"] {
      padding: 5px 7px; border: 1px solid var(--border); border-radius: 3px;
      font-size: 13px; width: 90px; }
    .pallet-field select.wide { width: 160px; }
    .pallet-field select:focus, .pallet-field input:focus { outline: none; border-color: var(--navy2); }
    .pallet-field input.req-missing, .pallet-field select.req-missing { border-color: var(--danger) !important; background: #fff8f8; }
    .req-star { color: var(--danger); }

    /* Notes + submit row */
    .notes-row { display: flex; flex-direction: column; gap: 4px; }
    .notes-row label { font-size: 12px; font-weight: bold; color: var(--muted); }
    .notes-row textarea { width: 100%; padding: 7px; border: 1px solid var(--border);
                          border-radius: 3px; font-size: 13px; resize: vertical; min-height: 52px; }
    .notes-row textarea:focus { outline: none; border-color: var(--navy2); }

    /* misc */
    .section-hdr { font-weight: bold; font-size: 13px; background: #e4e4e4;
                   padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; }
  </style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCREEN 1 — Order Selection
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="screen active" id="sc-orders">
  <header>
    <h1>Pack Orders <span style="font-size:10px;opacity:.5;font-weight:normal">v2</span></h1>
    <span class="loc" id="hdr-location">Loading…</span>
  </header>

  <div class="body">
    <div class="scan-bar">
      <input type="text" id="scan-input" placeholder="Filter by TO number (e.g. TO-1234)…"
             autocomplete="off" autocorrect="off" spellcheck="false">
    </div>

    <div id="orders-loading" class="spinner-wrap">
      <div class="spinner"></div>
      <p style="margin-top:12px">Loading picked orders…</p>
    </div>

    <div id="orders-error" class="alert alert-error" style="display:none"></div>

    <div id="orders-filter-note" class="alert alert-info" style="display:none;margin-bottom:8px"></div>
    <div id="order-list" class="order-list" style="display:none"></div>

    <div id="orders-empty" class="alert alert-info" style="display:none">
      No transfer orders are in Picked status for your location.
    </div>
  </div>

  <footer>
    <span class="footer-msg" id="orders-msg"></span>
    <span style="font-size:12px;color:#555" id="sel-count"></span>
    <button class="btn btn-primary" id="btn-build-pack" onclick="goToBuildPack()" disabled>
      Build Pack &rarr;
    </button>
  </footer>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCREEN 2 — Packing Builder  (HTML added in Chunk 2)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="screen" id="sc-builder">
  <header>
    <h1 id="builder-title">Pack Orders</h1>
  </header>
  <div class="body" id="builder-loading-wrap">
    <div class="spinner-wrap">
      <div class="spinner"></div>
      <p style="margin-top:12px">Loading items &amp; package types…</p>
    </div>
  </div>
  <footer>
    <span class="footer-msg" id="builder-msg"></span>
    <button class="btn btn-secondary" onclick="backToOrders()">← Pack Additional Orders</button>
    <button class="btn btn-success" id="btn-submit-pack" style="" disabled>
      Submit Packing
    </button>
    <button class="btn btn-secondary" id="btn-close-window" style="display:none" onclick="window.close()">Done</button>
  </footer>
</div>

<script>
const RESTLET_URL = ${JSON.stringify(restletUrl)};
const PRE_SELECT_IF_ID = ${ifId ? JSON.stringify(String(ifId)) : 'null'};

// ─── Global state ─────────────────────────────────────────────────────────────
const S = {
    locationName:     '',
    orders:           [],   // [{ toId, toTranId, sourceId, sourceName, destId, destName, fulfillments:[{ifId,ifTranId}] }]
    selectedToIds:    new Set(),
    activeSource:     null,
    activeSourceName: '',
    activeDest:       null,
    activeDestName:   '',
    selectedIFIds:    [],
    // Screen 2
    dropdowns: null,  // { packageTypes, weightUnits, dimUnits, defaultWuKey, defaultDuKey }
    pallets:   [],    // [{ pid, pkgTypeId, length, width, height, weight, wuId, duId }]
    nextPid:   1,
    addForm:   { pkgTypeId: '', length: '', width: '', height: '', weight: '', wuId: '', duId: '', qty: 1 },
};

// ─── Screen helpers ───────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(params) {
    const qs  = Object.entries(params).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
    const res = await fetch(RESTLET_URL + '&' + qs, { method: 'GET' });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 300) : ''));
    }
    return res.json();
}

async function apiPost(body) {
    const res = await fetch(RESTLET_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 300) : ''));
    }
    return res.json();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
let _inited = false;
function initPage() {
    if (_inited) return;
    _inited = true;
    showScreen('sc-orders');
    loadPickedOrders();
    document.getElementById('scan-input').focus();
}
window.addEventListener('DOMContentLoaded', initPage);
// If DOMContentLoaded already fired (script at end of body, DOM ready immediately)
if (document.readyState !== 'loading') initPage();

// ─── SCREEN 1: Load picked orders ─────────────────────────────────────────────
async function loadPickedOrders() {
    try {
        const data = await apiGet({ action: 'getPickedFulfillments' });
        if (!data.success) throw new Error(data.error);

        S.orders       = data.orders || [];
        S.locationName = data.locationName || '';
        document.getElementById('hdr-location').textContent = S.locationName;

        // Sort: pre-selected order first
        if (PRE_SELECT_IF_ID) {
            S.orders.sort((a, b) => {
                const aMatch = a.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID));
                const bMatch = b.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID));
                return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
            });
        }

        if (!S.orders.length) {
            document.getElementById('orders-empty').style.display = 'block';
            return;
        }

        renderOrderList();

        // Auto-select order containing the pre-selected IF
        if (PRE_SELECT_IF_ID) {
            const match = S.orders.find(o =>
                o.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID))
            );
            if (match) toggleOrderSel(match.toId, true);
        }
    } catch (e) {
        const el = document.getElementById('orders-error');
        if (el) { el.textContent = 'Error loading orders: ' + e.message; el.style.display = 'block'; }
    } finally {
        const loading = document.getElementById('orders-loading');
        if (loading) loading.style.display = 'none';
    }
}

function renderOrderList() {
    const list    = document.getElementById('order-list');
    const filter  = document.getElementById('orders-filter-note');
    list.innerHTML     = '';
    list.style.display = 'flex';

    const visible = S.activeDest
        ? S.orders.filter(o => o.sourceId === S.activeSource && o.destId === S.activeDest)
        : S.orders;

    if (S.activeDest && filter) {
        filter.textContent = 'Showing orders from \u201c' + S.activeSourceName +
            '\u201d to \u201c' + S.activeDestName + '\u201d only. Deselect all to see all orders.';
        filter.style.display = 'block';
    } else if (filter) {
        filter.style.display = 'none';
    }

    visible.forEach((to) => {
        const card = document.createElement('div');
        card.className      = 'order-card';
        card.dataset.toId   = to.toId;

        const ifNums = to.fulfillments.map(f => f.ifTranId).join(', ');
        card.innerHTML =
            '<div class="order-card-top">' +
              '<input type="checkbox" class="order-cb" data-toid="' + esc(to.toId) + '">' +
              '<span class="order-num">' + esc(to.toTranId) + '</span>' +
              '<span class="order-dest">' + esc(to.sourceName || '') + ' &rarr; ' + esc(to.destName) + '</span>' +
            '</div>' +
            '<div class="order-ifs">IFs: ' + esc(ifNums) + '</div>';

        const cb = card.querySelector('.order-cb');
        cb.checked = S.selectedToIds.has(to.toId);
        card.classList.toggle('selected', cb.checked);
        cb.addEventListener('change', () => toggleOrderSel(to.toId, cb.checked));
        card.addEventListener('click', (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            toggleOrderSel(to.toId, cb.checked);
        });

        list.appendChild(card);
    });
    applyScanFilter();
}

function toggleOrderSel(toId, checked) {
    const order = S.orders.find(o => o.toId === toId);
    if (!order) return;

    const wasEmpty = S.selectedToIds.size === 0;

    if (checked) {
        S.selectedToIds.add(toId);
        // First selection — lock source+destination and re-render filtered list
        if (wasEmpty) {
            S.activeSource     = order.sourceId;
            S.activeSourceName = order.sourceName;
            S.activeDest       = order.destId;
            S.activeDestName   = order.destName;
            renderOrderList();
        }
    } else {
        S.selectedToIds.delete(toId);
        // Last deselection — clear source+destination filter and show all orders
        if (S.selectedToIds.size === 0) {
            S.activeSource     = null;
            S.activeSourceName = '';
            S.activeDest       = null;
            S.activeDestName   = '';
            renderOrderList();
        }
    }

    // Sync checkbox + selected class on visible cards
    document.querySelectorAll('.order-card').forEach((card) => {
        const cb  = card.querySelector('.order-cb');
        const sel = S.selectedToIds.has(card.dataset.toId);
        if (cb) cb.checked = sel;
        card.classList.toggle('selected', sel);
    });

    const count = S.selectedToIds.size;
    document.getElementById('sel-count').textContent =
        count ? count + ' order' + (count === 1 ? '' : 's') + ' selected' : '';
    document.getElementById('btn-build-pack').disabled = count === 0;
    document.getElementById('orders-msg').textContent  = '';
}

// ── Scan / search support ─────────────────────────────────────────────────────
function applyScanFilter() {
    const val = document.getElementById('scan-input').value.trim().toUpperCase();
    document.querySelectorAll('#order-list .order-card').forEach((card) => {
        const order = S.orders.find(o => o.toId === card.dataset.toId);
        card.style.display = (!val || (order && order.toTranId.toUpperCase().includes(val))) ? '' : 'none';
    });
}

document.getElementById('scan-input').addEventListener('input', applyScanFilter);

document.getElementById('scan-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    const to  = S.orders.find(o => o.toTranId === val);
    if (!to) {
        document.getElementById('orders-msg').textContent =
            '"' + val + '" not found or not in Picked status.';
    } else {
        const cb = document.querySelector('.order-cb[data-toid="' + to.toId + '"]');
        if (cb) { cb.checked = !cb.checked; toggleOrderSel(to.toId, cb.checked); }
    }
    e.target.value = '';
    applyScanFilter();
});

// ─── Navigate to Screen 2 ─────────────────────────────────────────────────────
async function goToBuildPack() {
    if (!S.selectedToIds.size) return;
    showScreen('sc-builder');

    // Collect fulfillment IDs from all selected orders
    S.selectedIFIds = [];
    S.orders
        .filter(o => S.selectedToIds.has(o.toId))
        .forEach(o => o.fulfillments.forEach(f => S.selectedIFIds.push(f.ifId)));

    // Set builder title
    const toNums = S.orders
        .filter(o => S.selectedToIds.has(o.toId))
        .map(o => o.toTranId)
        .join(', ');
    document.getElementById('builder-title').textContent = 'Pack Orders — ' + toNums;

    try {
        const ddData = await apiGet({ action: 'getDropdownData', ifIds: S.selectedIFIds.join(',') });
        if (!ddData.success) throw new Error(ddData.error);

        S.dropdowns = ddData;
        S.pallets   = [];
        S.nextPid   = 1;
        S.addForm   = {
            pkgTypeId: '',
            length: '', width: '', height: '', weight: '',
            wuId: ddData.defaultWuKey || '',
            duId: ddData.defaultDuKey || '',
            qty: 1,
        };

        renderBuilderUI();
    } catch (e) {
        document.getElementById('builder-loading-wrap').innerHTML =
            '<div class="alert alert-error" style="margin:16px">Error: ' + esc(e.message) + '</div>';
    }
}

function backToOrders() {
    showScreen('sc-orders');
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── SCREEN 2: Builder UI ─────────────────────────────────────────────────────
function renderBuilderUI() {
    const wrap = document.getElementById('builder-loading-wrap');
    wrap.style.overflow = 'hidden';
    wrap.style.padding  = '10px';

    wrap.innerHTML =
        '<div id="add-form-wrap"></div>' +
        '<div id="pallet-list" class="pallet-scroll" style="margin-top:10px"></div>' +
        '<div class="notes-row" style="margin-top:10px">' +
          '<label>Notes</label>' +
          '<textarea id="pack-notes" placeholder="Optional packing notes\u2026"></textarea>' +
        '</div>';

    renderAddForm();
    renderPalletList();
    validateAndToggleSubmit();
}

// ─── Add Package Form ─────────────────────────────────────────────────────────
function renderAddForm() {
    const wrap = document.getElementById('add-form-wrap');
    if (!wrap) return;
    const dd = S.dropdowns || {};
    const f  = S.addForm;

    const pkgOpts = '<option value="">— Select type —</option>' +
        (dd.packageTypes || []).map(pt =>
            '<option value="' + esc(pt.key) + '"' + (pt.key === f.pkgTypeId ? ' selected' : '') + '>' +
            esc(pt.label) + '</option>'
        ).join('');

    const wuOpts = (dd.weightUnits || []).map(u =>
        '<option value="' + esc(u.key) + '"' + (u.key === f.wuId ? ' selected' : '') + '>' +
        esc(u.label) + '</option>'
    ).join('');

    const duOpts = (dd.dimUnits || []).map(u =>
        '<option value="' + esc(u.key) + '"' + (u.key === f.duId ? ' selected' : '') + '>' +
        esc(u.label) + '</option>'
    ).join('');

    wrap.innerHTML =
        '<div class="add-form-card">' +
          '<div class="add-form-title">Add Package(s)</div>' +
          '<div class="pallet-dims">' +
            '<div class="pallet-field"><label>Package Type&thinsp;<span class="req-star">*</span></label>' +
              '<select class="wide' + (!f.pkgTypeId ? ' req-missing' : '') + '" onchange="onAddFormPkgType(this.value)">' +
              pkgOpts + '</select></div>' +
            '<div class="pallet-field"><label>L</label>' +
              '<input type="number" min="0" step="0.01" value="' + esc(f.length) + '" ' +
                     'oninput="onAddFormField(\\'length\\',this.value)"></div>' +
            '<div class="pallet-field"><label>W</label>' +
              '<input type="number" min="0" step="0.01" value="' + esc(f.width) + '" ' +
                     'oninput="onAddFormField(\\'width\\',this.value)"></div>' +
            '<div class="pallet-field"><label>H&thinsp;<span class="req-star">*</span></label>' +
              '<input type="number" min="0" step="0.01" value="' + esc(f.height) + '" ' +
                     'class="' + (!(parseFloat(f.height) > 0) && f.pkgTypeId ? 'req-missing' : '') + '" ' +
                     'oninput="onAddFormField(\\'height\\',this.value)"></div>' +
            '<div class="pallet-field"><label>Dim&nbsp;Unit</label>' +
              '<select onchange="onAddFormField(\\'duId\\',this.value)">' + duOpts + '</select></div>' +
            '<div class="pallet-field"><label>Weight&thinsp;<span class="req-star">*</span></label>' +
              '<input type="number" min="0" step="0.01" value="' + esc(f.weight) + '" ' +
                     'class="' + (!(parseFloat(f.weight) > 0) && f.pkgTypeId ? 'req-missing' : '') + '" ' +
                     'oninput="onAddFormField(\\'weight\\',this.value)"></div>' +
            '<div class="pallet-field"><label>Wt&nbsp;Unit</label>' +
              '<select onchange="onAddFormField(\\'wuId\\',this.value)">' + wuOpts + '</select></div>' +
            '<div class="pallet-field"><label>Quantity&thinsp;<span class="req-star">*</span></label>' +
              '<input type="number" min="1" step="1" value="' + esc(String(f.qty || 1)) + '" style="width:70px" ' +
                     'oninput="onAddFormField(\\'qty\\',this.value)"></div>' +
            '<div class="pallet-field" style="justify-content:flex-end">' +
              '<label>&nbsp;</label>' +
              '<button class="btn btn-success btn-sm" onclick="submitAddForm()">Add Package(s)</button>' +
            '</div>' +
          '</div>' +
          '<div id="add-form-msg" style="font-size:12px;color:var(--danger);margin-top:6px"></div>' +
        '</div>';
}

function onAddFormPkgType(pkgTypeId) {
    S.addForm.pkgTypeId = pkgTypeId;
    const pt = (S.dropdowns.packageTypes || []).find(x => x.key === pkgTypeId);
    if (pt) {
        S.addForm.length = pt.length || '';
        S.addForm.width  = pt.width  || '';
        // Auto-set dim unit from package type if it has one
        if (pt.dimUnit) {
            const du = (S.dropdowns.dimUnits || []).find(u => u.label === pt.dimUnit);
            if (du) S.addForm.duId = du.key;
        }
    }
    renderAddForm();
}

function onAddFormField(field, value) {
    S.addForm[field] = value;
}

function submitAddForm() {
    const f   = S.addForm;
    const msg = document.getElementById('add-form-msg');
    if (!f.pkgTypeId) { msg.textContent = 'Select a Package Type.'; return; }
    if (!(parseFloat(f.length) > 0))  { msg.textContent = 'Enter a valid Length.'; return; }
    if (!(parseFloat(f.width) > 0))   { msg.textContent = 'Enter a valid Width.'; return; }
    if (!(parseFloat(f.height) > 0))  { msg.textContent = 'Enter a valid Height.'; return; }
    if (!(parseFloat(f.weight) > 0))  { msg.textContent = 'Enter a valid Weight.'; return; }
    const qty = Math.max(1, parseInt(f.qty, 10) || 1);
    for (let i = 0; i < qty; i++) {
        S.pallets.push({ pid: S.nextPid++, pkgTypeId: f.pkgTypeId,
            length: f.length, width: f.width, height: f.height,
            weight: f.weight, wuId: f.wuId, duId: f.duId });
    }
    S.addForm.qty = 1;
    renderAddForm();
    renderPalletList();
    validateAndToggleSubmit();
    setTimeout(() => {
        const list = document.getElementById('pallet-list');
        if (list) list.scrollTop = list.scrollHeight;
    }, 50);
}

// ─── Validate: packages exist, all have type + dims/weight ────────────────────
function validateAndToggleSubmit() {
    const missingType = S.pallets.filter(p => !p.pkgTypeId);
    const missingDims = S.pallets.filter(p =>
        !(parseFloat(p.length) > 0) || !(parseFloat(p.width) > 0) ||
        !(parseFloat(p.height) > 0) || !(parseFloat(p.weight) > 0)
    );

    const btn   = document.getElementById('btn-submit-pack');
    const msg   = document.getElementById('builder-msg');
    const valid = S.pallets.length > 0 && missingType.length === 0 && missingDims.length === 0;
    btn.disabled = !valid;

    if (!S.pallets.length) {
        msg.textContent = 'Add at least one package using the form above.';
    } else if (missingType.length > 0) {
        const n = missingType.length;
        msg.textContent = n + ' package' + (n === 1 ? ' is' : 's are') + ' missing a Package Type.';
    } else if (missingDims.length > 0) {
        msg.textContent = 'All packages require Length, Width, Height, and Weight.';
    } else {
        msg.textContent = '';
    }
}


// ─── Render all pallet cards ──────────────────────────────────────────────────
function renderPalletList() {
    const list = document.getElementById('pallet-list');
    if (!list) return;
    list.innerHTML = '';
    S.pallets.forEach(p => {
        const card = document.createElement('div');
        card.className   = 'pallet-card';
        card.dataset.pid = p.pid;
        card.innerHTML   = buildPalletCardHTML(p);
        list.appendChild(card);
    });
}

function buildPalletCardHTML(p) {
    const dd  = S.dropdowns || {};
    const idx = S.pallets.findIndex(x => x.pid === p.pid);

    const pkgOpts = '<option value="">— Select type —</option>' +
        (dd.packageTypes || []).map(pt =>
            '<option value="' + esc(pt.key) + '"' + (pt.key === p.pkgTypeId ? ' selected' : '') + '>' +
            esc(pt.label) + '</option>'
        ).join('');

    const wuOpts = (dd.weightUnits || []).map(u =>
        '<option value="' + esc(u.key) + '"' + (u.key === p.wuId ? ' selected' : '') + '>' +
        esc(u.label) + '</option>'
    ).join('');

    const duOpts = (dd.dimUnits || []).map(u =>
        '<option value="' + esc(u.key) + '"' + (u.key === p.duId ? ' selected' : '') + '>' +
        esc(u.label) + '</option>'
    ).join('');

    return '<div class="pallet-card-hdr">' +
        '<span class="pallet-num">Package ' + (idx + 1) + '</span>' +
        '<button class="btn btn-danger btn-sm" onclick="removePallet(' + p.pid + ')">Remove</button>' +
    '</div>' +
    '<div class="pallet-body">' +
        '<div class="pallet-dims">' +
            '<div class="pallet-field"><label>Package Type&thinsp;<span class="req-star">*</span></label>' +
                '<select class="wide' + (!p.pkgTypeId ? ' req-missing' : '') + '" onchange="onPkgTypeChange(' + p.pid + ',this.value)">' +
                pkgOpts + '</select></div>' +
            '<div class="pallet-field"><label>L&thinsp;<span class="req-star">*</span></label>' +
                '<input type="number" min="0" step="0.01" value="' + esc(p.length) + '" ' +
                       'class="' + (!(parseFloat(p.length) > 0) ? 'req-missing' : '') + '" ' +
                       'data-field="length" oninput="onDimChange(' + p.pid + ',this.dataset.field,this.value)"></div>' +
            '<div class="pallet-field"><label>W&thinsp;<span class="req-star">*</span></label>' +
                '<input type="number" min="0" step="0.01" value="' + esc(p.width) + '" ' +
                       'class="' + (!(parseFloat(p.width) > 0) ? 'req-missing' : '') + '" ' +
                       'data-field="width" oninput="onDimChange(' + p.pid + ',this.dataset.field,this.value)"></div>' +
            '<div class="pallet-field"><label>H&thinsp;<span class="req-star">*</span></label>' +
                '<input type="number" min="0" step="0.01" value="' + esc(p.height) + '" ' +
                       'class="' + (!(parseFloat(p.height) > 0) ? 'req-missing' : '') + '" ' +
                       'data-field="height" oninput="onDimChange(' + p.pid + ',this.dataset.field,this.value)"></div>' +
            '<div class="pallet-field"><label>Dim&nbsp;Unit</label>' +
                '<select onchange="onDimUnitChange(' + p.pid + ',this.value)">' +
                duOpts + '</select></div>' +
            '<div class="pallet-field"><label>Weight&thinsp;<span class="req-star">*</span></label>' +
                '<input type="number" min="0" step="0.01" value="' + esc(p.weight) + '" ' +
                       'class="' + (!(parseFloat(p.weight) > 0) ? 'req-missing' : '') + '" ' +
                       'data-field="weight" oninput="onDimChange(' + p.pid + ',this.dataset.field,this.value)"></div>' +
            '<div class="pallet-field"><label>Wt&nbsp;Unit</label>' +
                '<select onchange="onWtUnitChange(' + p.pid + ',this.value)">' +
                wuOpts + '</select></div>' +
        '</div>' +
    '</div>';
}

// ─── Pallet field change handlers ─────────────────────────────────────────────
function removePallet(pid) {
    S.pallets = S.pallets.filter(p => p.pid !== pid);
    renderPalletList();
    validateAndToggleSubmit();
}

function onPkgTypeChange(pid, pkgTypeId) {
    const p = S.pallets.find(x => x.pid === pid);
    if (!p) return;
    p.pkgTypeId = pkgTypeId;
    const pt = (S.dropdowns.packageTypes || []).find(x => x.key === pkgTypeId);
    if (pt) {
        p.length = pt.length || '';
        p.width  = pt.width  || '';
        if (pt.dimUnit) {
            const du = (S.dropdowns.dimUnits || []).find(u => u.label === pt.dimUnit);
            if (du) p.duId = du.key;
        }
    }
    const card = document.querySelector('.pallet-card[data-pid="' + pid + '"]');
    if (card) card.innerHTML = buildPalletCardHTML(p);
    validateAndToggleSubmit();
}

function onDimChange(pid, field, value) {
    const p = S.pallets.find(x => x.pid === pid);
    if (!p) return;
    p[field] = value;
    // Update red-border indicator on this input in real time
    const card = document.querySelector('.pallet-card[data-pid="' + pid + '"]');
    if (card) {
        const inp = card.querySelector('input[data-field="' + field + '"]');
        if (inp) inp.classList.toggle('req-missing', !(parseFloat(value) > 0));
    }
    validateAndToggleSubmit();
}

function onDimUnitChange(pid, duId) {
    const p = S.pallets.find(x => x.pid === pid);
    if (!p) return;
    p.duId = duId;
    const card = document.querySelector('.pallet-card[data-pid="' + pid + '"]');
    if (card) card.innerHTML = buildPalletCardHTML(p);
}

function onWtUnitChange(pid, wuId) {
    const p = S.pallets.find(x => x.pid === pid);
    if (p) p.wuId = wuId;
}

// ─── Submit Packing ───────────────────────────────────────────────────────────
document.getElementById('btn-submit-pack').addEventListener('click', submitPacking);

async function submitPacking() {
    const btn = document.getElementById('btn-submit-pack');
    const msg = document.getElementById('builder-msg');

    // Final validation
    const missingDims = S.pallets.some(p =>
        !(parseFloat(p.length) > 0) || !(parseFloat(p.width) > 0) ||
        !(parseFloat(p.height) > 0) || !(parseFloat(p.weight) > 0));
    if (!S.pallets.length || missingDims) return;

    btn.disabled    = true;
    btn.textContent = 'Submitting\u2026';
    msg.textContent = '';

    // Build fulfillments list
    const fulfillments = [];
    S.orders
        .filter(o => S.selectedToIds.has(o.toId))
        .forEach((o) => {
            o.fulfillments.forEach((f) => {
                fulfillments.push({ ifId: f.ifId, ifTranId: f.ifTranId, toId: o.toId, toTranId: o.toTranId, sourceId: o.sourceId, destId: o.destId });
            });
        });

    // Build pallets payload — read current input values from DOM
    const palletsPayload = S.pallets.map((p) => {
        const card   = document.querySelector('.pallet-card[data-pid="' + p.pid + '"]');
        const getVal = (sel) => { const el = card && card.querySelector(sel); return el ? el.value : ''; };
        return {
            pkgTypeId: p.pkgTypeId,
            length:    getVal('input[data-field="length"]') || p.length,
            width:     getVal('input[data-field="width"]')  || p.width,
            height:    getVal('input[data-field="height"]') || p.height,
            weight:    getVal('input[data-field="weight"]') || p.weight,
            wuId:      p.wuId,
            duId:      p.duId,
        };
    });

    const notes = (document.getElementById('pack-notes') || {}).value || '';

    try {
        const data = await apiPost({ action: 'submitPacking', fulfillments, pallets: palletsPayload, notes });
        if (!data.success) throw new Error(data.error);

        const wrap = document.getElementById('builder-loading-wrap');
        wrap.style.overflow = '';
        wrap.innerHTML =
            '<div class="alert alert-ok" style="margin:16px">' +
            '\u2713 Packing complete! Created <strong>' + data.shipUnitCount + '</strong> package' +
            (data.shipUnitCount === 1 ? '' : 's') + '.' +
            '<br><br>Shipment Summary ID: <strong>' + esc(data.summaryId) + '</strong>' +
            '<br><br><button class="btn btn-secondary btn-sm" onclick="window.close()">Close Window</button>' +
            '</div>';

        document.getElementById('btn-close-window').style.display = 'inline-block';
        document.getElementById('btn-submit-pack').style.display  = 'none';
        window.opener && window.opener.postMessage({ type: 'PACKING_COMPLETE' }, '*');
        msg.textContent = '';

    } catch (e) {
        msg.textContent = 'Submit error: ' + e.message;
        btn.disabled    = false;
        btn.textContent = 'Submit Packing';
    }
}
</script>
</body>
</html>`;

    return { onRequest };
});
