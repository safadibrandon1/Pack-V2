/**
 * sl_unpack_orders.js — Unpack Orders Suitelet (Single-Page Application)
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Script ID  : customscript_lime_sl_unpack_fulfill
 * Deploy ID  : customdeploy_lime_sl_unpack_fulfill
 *
 * Two-screen SPA for warehouse staff to unpack previously packed orders:
 *
 *   SCREEN 1 — Packed Order Selection
 *     · Lists all Transfer Orders currently in "Packed" status.
 *     · Single or multi-select. Supports keyboard-wedge scan by TO number.
 *     · Accepts optional `ifId` URL parameter — when provided, auto-selects
 *       any order whose fulfillments array contains a matching ifId on load.
 *     · "Next →" loads the ship units for the selected orders.
 *
 *   SCREEN 2 — Ship Unit Selection
 *     · Shows all active (not yet unpacked) Ship Unit records linked to the
 *       selected orders.
 *     · Individual checkboxes + "Mark All" button for bulk selection.
 *     · "Confirm Unpack" calls rl_unpack_orders → unpackShipUnits:
 *         - Selected ship units are flagged as unpacked (status checkbox = true)
 *         - ALL linked Item Fulfillments are reverted to "Picked" status
 *         - Shipment Summary is flagged as unpacked if all its units are done
 *     · On successful unpack, posts a message to the opener window.
 *     · Result shown inline (no separate screen needed — unpack is fast).
 */
define([
    'N/url',
    'N/log',
    '/SuiteScripts/Packing/lib/pack_config',
], (url, log, CONFIG) => {

    const { SCRIPTS } = CONFIG;

    const onRequest = (ctx) => {
        if (ctx.request.method !== 'GET') {
            ctx.response.write(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        ctx.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=UTF-8' });
        try {
            const restletUrl = url.resolveScript({
                scriptId:          SCRIPTS.UNPACK_RL,
                deploymentId:      SCRIPTS.UNPACK_RL_DEPLOY,
                returnExternalUrl: false,
            });

            const ifId = ctx.request.parameters.ifId || '';

            ctx.response.write(buildPage(restletUrl, ifId));
        } catch (e) {
            log.error({ title: 'sl_unpack_orders GET error', details: e });
            ctx.response.write('<!DOCTYPE html><html><body><p style="color:red;font-family:sans-serif;padding:20px">Error loading Unpack Orders: ' + e.message + '</p></body></html>');
        }
    };

    const buildPage = (restletUrl, ifId) => /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Unpack Orders</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #003366; --navy2: #004080; --blue-lt: #dce8f8;
      --border: #ccc; --text: #222; --muted: #666;
      --danger: #c00; --success: #1a6e1a; --warn: #b35c00;
    }
    body { font-family: Arial, sans-serif; font-size: 14px; color: var(--text);
           background: #f4f4f4; min-height: 100vh; display: flex; flex-direction: column; }
    .screen { display: none; flex-direction: column; height: 100vh; }
    .screen.active { display: flex; }
    header { background: var(--navy); color: #fff; padding: 11px 14px;
             display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    header h1 { font-size: 15px; font-weight: bold; flex: 1; }
    header .loc { font-size: 12px; opacity: .8; }
    .body { flex: 1; overflow-y: auto; padding: 12px; }
    footer { background: #efefef; border-top: 1px solid var(--border);
             padding: 10px 12px; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    .footer-msg { flex: 1; font-size: 12px; color: var(--danger); }

    .btn { padding: 9px 18px; border: none; border-radius: 4px; cursor: pointer;
           font-size: 14px; font-weight: bold; touch-action: manipulation; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn-primary   { background: var(--navy); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--navy2); }
    .btn-secondary { background: #ddd; color: #333; }
    .btn-secondary:hover:not(:disabled) { background: #c8c8c8; }
    .btn-danger    { background: var(--danger); color: #fff; }
    .btn-danger:hover:not(:disabled) { background: #a00; }
    .btn-sm { padding: 5px 10px; font-size: 12px; font-weight: normal; }

    .scan-bar { display: flex; gap: 8px; margin-bottom: 10px; }
    .scan-bar input { flex: 1; padding: 9px 12px; border: 2px solid var(--navy);
                      border-radius: 4px; font-size: 14px; }
    .scan-bar input:focus { outline: none; border-color: #0055aa;
                            box-shadow: 0 0 0 2px rgba(0,85,170,.2); }

    .order-list { display: flex; flex-direction: column; gap: 8px; }
    .order-card { background: #fff; border: 1px solid var(--border); border-radius: 6px;
                  padding: 10px 12px; cursor: pointer; transition: border-color .15s; }
    .order-card:hover { border-color: var(--navy); }
    .order-card.selected { border-color: var(--navy); background: var(--blue-lt); }
    .order-card-top { display: flex; align-items: center; gap: 10px; }
    .order-cb { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
    .order-num  { font-weight: bold; font-size: 15px; flex: 1; }
    .order-dest { font-size: 12px; color: var(--muted); }
    .order-ifs  { font-size: 12px; color: var(--muted); margin-top: 5px; padding-left: 28px; }

    .section-hdr { font-weight: bold; font-size: 13px; background: #e4e4e4;
                   padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .toolbar span { font-size: 12px; color: var(--muted); flex: 1; }

    .unit-table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; }
    thead th { background: var(--navy); color: #fff; padding: 7px 8px; text-align: left;
               white-space: nowrap; }
    tbody tr { border-bottom: 1px solid #e8e8e8; cursor: pointer; }
    tbody tr:hover { background: #f8f8f8; }
    tbody tr.sel-row { background: #fff0f0; }
    tbody td { padding: 6px 8px; vertical-align: middle; }
    .sel-col { width: 32px; text-align: center; }

    .alert { border-radius: 4px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px; }
    .alert-info  { background: #e8f0fb; border: 1px solid #b0c8f0; color: #003; }
    .alert-error { background: #fff0f0; border: 1px solid #f0b0b0; color: var(--danger); }
    .alert-ok    { background: #edfaed; border: 1px solid #a0d0a0; color: var(--success); }

    .spinner-wrap { text-align: center; padding: 40px 20px; color: var(--muted); }
    .spinner { display: inline-block; width: 28px; height: 28px; border: 4px solid #ccc;
               border-top-color: var(--navy); border-radius: 50%;
               animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCREEN 1 — Packed Order Selection
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="screen" id="sc-orders">
  <header>
    <h1>Unpack Orders</h1>
    <span class="loc" id="hdr-location">Loading...</span>
  </header>

  <div class="body">
    <div class="scan-bar">
      <input type="text" id="scan-input" placeholder="Filter by TO number (e.g. TO-1234)…"
             autocomplete="off" autocorrect="off" spellcheck="false">
    </div>

    <div id="orders-loading" class="spinner-wrap">
      <div class="spinner"></div>
      <p style="margin-top:12px">Loading packed orders...</p>
    </div>

    <div id="orders-error" class="alert alert-error" style="display:none"></div>

    <div id="order-list" class="order-list" style="display:none"></div>

    <div id="orders-empty" class="alert alert-info" style="display:none">
      No transfer orders are in Packed status.
    </div>

    <div id="orders-done" style="display:none"></div>
  </div>

  <footer id="main-footer">
    <span class="footer-msg" id="orders-msg"></span>
    <span style="font-size:12px;color:#555" id="sel-count"></span>
    <button class="btn btn-danger" id="btn-unpack" onclick="doUnpack()" disabled>
      Unpack
    </button>
  </footer>
</div>

<script>
const RESTLET_URL = ${JSON.stringify(restletUrl)};
const PRE_SELECT_IF_ID = ${ifId ? JSON.stringify(ifId) : 'null'};

let STATE = {
    orders:        [],
    selectedToIds: new Set(),
};

// ─── Screen management ────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiGet(params) {
    const qs  = Object.entries(params).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
    const res = await fetch(RESTLET_URL + '&' + qs, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

async function apiPost(body) {
    const res = await fetch(RESTLET_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    showScreen('sc-orders');
    loadPackedOrders();
    document.getElementById('scan-input').focus();
});

async function loadPackedOrders() {
    try {
        const data = await apiGet({ action: 'getPackedOrders' });
        if (!data.success) throw new Error(data.error);

        STATE.orders = data.orders || [];
        document.getElementById('hdr-location').textContent = data.locationName || '';

        // Sort: orders from the same Shipment Summary as the pre-selected IF first
        if (PRE_SELECT_IF_ID) {
            const matchedOrder = STATE.orders.find(o =>
                o.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID))
            );
            const matchedSummaryId = matchedOrder ? matchedOrder.summaryId : null;
            STATE.orders.sort((a, b) => {
                const aMatch = matchedSummaryId
                    ? a.summaryId === matchedSummaryId
                    : a.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID));
                const bMatch = matchedSummaryId
                    ? b.summaryId === matchedSummaryId
                    : b.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID));
                return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
            });
        }

        document.getElementById('orders-loading').style.display = 'none';

        if (!STATE.orders.length) {
            document.getElementById('orders-empty').style.display = 'block';
            return;
        }

        renderOrderList();

        // Auto-select all orders belonging to the same Shipment Summary as the pre-selected IF
        if (PRE_SELECT_IF_ID) {
            const match = STATE.orders.find(o =>
                o.fulfillments.some(f => String(f.ifId) === String(PRE_SELECT_IF_ID))
            );
            if (match) {
                const summaryId = match.summaryId;
                // Add all matching toIds to the set first, then do one DOM refresh
                STATE.orders.forEach((o) => {
                    if (summaryId ? o.summaryId === summaryId : o.toId === match.toId) {
                        STATE.selectedToIds.add(o.toId);
                    }
                });
                if (STATE.selectedToIds.size) toggleOrderSel([...STATE.selectedToIds][0], true);
            }
        }
    } catch (e) {
        document.getElementById('orders-loading').style.display = 'none';
        const errEl = document.getElementById('orders-error');
        errEl.textContent   = 'Error: ' + e.message;
        errEl.style.display = 'block';
    }
}

// ─── SCREEN 1 — Order list ────────────────────────────────────────────────────
function renderOrderList() {
    const list = document.getElementById('order-list');
    list.innerHTML    = '';
    list.style.display = 'flex';

    STATE.orders.forEach((to) => {
        const card    = document.createElement('div');
        card.className = 'order-card';
        card.dataset.toId = to.toId;

        const ifNums = to.fulfillments.map(f => f.ifTranId).join(', ');

        card.innerHTML =
            '<div class="order-card-top">' +
              '<input type="checkbox" class="order-cb" data-toid="' + esc(to.toId) + '">' +
              '<span class="order-num">' + esc(to.toTranId) + '</span>' +
              '<span class="order-dest">&rarr; ' + esc(to.destName) + '</span>' +
            '</div>' +
            '<div class="order-ifs">IFs: ' + esc(ifNums) + '</div>';

        const cb = card.querySelector('.order-cb');
        cb.addEventListener('change', () => toggleOrderSel(to.toId, cb.checked));
        card.addEventListener('click', (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            toggleOrderSel(to.toId, cb.checked);
        });

        list.appendChild(card);
    });
}

function toggleOrderSel(toId, checked) {
    checked ? STATE.selectedToIds.add(toId) : STATE.selectedToIds.delete(toId);

    document.querySelectorAll('.order-card').forEach((card) => {
        const cb = card.querySelector('.order-cb');
        if (cb) cb.checked = STATE.selectedToIds.has(card.dataset.toId);
        STATE.selectedToIds.has(card.dataset.toId)
            ? card.classList.add('selected')
            : card.classList.remove('selected');
    });

    const count = STATE.selectedToIds.size;
    document.getElementById('sel-count').textContent =
        count ? count + ' order' + (count === 1 ? '' : 's') + ' selected' : '';
    document.getElementById('btn-unpack').disabled = count === 0;
    document.getElementById('orders-msg').textContent  = '';
}

// ── Scan / search support ─────────────────────────────────────────────────────
function applyScanFilter() {
    const val = document.getElementById('scan-input').value.trim().toUpperCase();
    document.querySelectorAll('#order-list .order-card').forEach((card) => {
        const order = STATE.orders.find(o => o.toId === card.dataset.toId);
        card.style.display = (!val || (order && order.toTranId.toUpperCase().includes(val))) ? '' : 'none';
    });
}

document.getElementById('scan-input').addEventListener('input', applyScanFilter);

document.getElementById('scan-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tranId = e.target.value.trim();
    const to     = STATE.orders.find(o => o.toTranId === tranId);
    if (!to) {
        document.getElementById('orders-msg').textContent =
            '"' + tranId + '" not found or not in Packed status.';
    } else {
        const cb = document.querySelector('.order-cb[data-toid="' + to.toId + '"]');
        if (cb) { cb.checked = !cb.checked; toggleOrderSel(to.toId, cb.checked); }
    }
    e.target.value = '';
    applyScanFilter();
});

// ─── Unpack ───────────────────────────────────────────────────────────────────
async function doUnpack() {
    if (STATE.selectedToIds.size === 0) return;

    const count = STATE.selectedToIds.size;
    if (!confirm(
        'Unpack ' + count + ' order' + (count === 1 ? '' : 's') + '?\\n\\n' +
        'All linked fulfillments will revert to Picked status and the full packing process will need to be repeated.'
    )) return;

    const btn = document.getElementById('btn-unpack');
    btn.disabled    = true;
    btn.textContent = 'Unpacking...';
    document.getElementById('orders-msg').textContent = '';

    try {
        const data = await apiPost({
            action: 'unpackShipUnits',
            toIds:  Array.from(STATE.selectedToIds),
        });

        if (!data.success) throw new Error(data.error);

        // Notify opener so IF page reloads
        window.opener && window.opener.postMessage({ type: 'UNPACK_COMPLETE' }, '*');

        // Show done state
        document.getElementById('order-list').style.display   = 'none';
        document.getElementById('orders-empty').style.display = 'none';
        document.getElementById('orders-error').style.display = 'none';
        document.getElementById('scan-input').closest('.scan-bar').style.display = 'none';

        const doneEl = document.getElementById('orders-done');
        doneEl.className = 'alert alert-ok';
        doneEl.innerHTML =
            '<strong>Unpacked successfully.</strong><br>' +
            data.unpacked + ' package' + (data.unpacked === 1 ? '' : 's') + ' unpacked. ' +
            data.ifsReverted + ' fulfillment' + (data.ifsReverted === 1 ? '' : 's') + ' reverted to Picked status.';
        doneEl.style.display = 'block';

        // Swap footer to just a Close button
        document.getElementById('main-footer').innerHTML =
            '<button class="btn btn-secondary" onclick="window.close()">Close</button>';

    } catch (e) {
        const errEl = document.getElementById('orders-error');
        errEl.textContent   = 'Unpack error: ' + e.message;
        errEl.style.display = 'block';
        btn.disabled    = false;
        btn.textContent = 'Unpack';
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
</script>
</body>
</html>`;

    return { onRequest };
});
