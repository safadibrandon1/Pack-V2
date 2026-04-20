/**
 * ue_fulfillment_buttons.js — Packing: Manage Packing Button on Item Fulfillment
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 *
 * Script ID  : customscript_lime_ue_if_pack_btns
 * Deploy ID  : customdeploy_lime_ue_if_pack_btns
 * Record     : Item Fulfillment (itemfulfillment)
 * Events     : beforeLoad
 *
 * Adds a single "Manage Packing" button to Item Fulfillments created from
 * Transfer Orders:
 *
 *   Visible when shipstatus = Picked (A) or Packed (B). Hidden on Shipped (C+).
 *
 *   Picked → opens Pack Orders Suitelet in a popup, pre-selecting this IF.
 *   Packed → opens Unpack Orders Suitelet in a popup, scoped to this IF.
 *
 * Listens for PACKING_COMPLETE and UNPACK_COMPLETE postMessage events from
 * the popup and reloads the page when either fires.
 */
define([
    'N/ui/serverWidget',
    'N/url',
    'N/search',
    'N/log',
    '/SuiteScripts/Packing/lib/pack_config',
], (serverWidget, url, search, log, CONFIG) => {

    const { SCRIPTS } = CONFIG;

    const POPUP_FEATURES = 'width=1400,height=800,scrollbars=yes,resizable=yes,toolbar=no,menubar=no';

    const beforeLoad = (ctx) => {
        try {
            const { UserEventType, form, type, newRecord } = ctx;

            if (type === UserEventType.CREATE) return;

            // Only show on fulfillments created from Transfer Orders
            const createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
            if (!createdFrom) return;

            const createdFromType = getCreatedFromType(createdFrom);
            if (createdFromType !== 'transferorder') return;

            // Only show for Picked (A) or Packed (B) — never Shipped
            const shipStatus = newRecord.getValue({ fieldId: 'shipstatus' });
            if (shipStatus !== 'A' && shipStatus !== 'B') return;

            const ifId  = newRecord.id;
            const isPicked = shipStatus === 'A';

            const suiteUrl = url.resolveScript({
                scriptId:     isPicked ? SCRIPTS.PACK_SL   : SCRIPTS.UNPACK_SL,
                deploymentId: isPicked ? SCRIPTS.PACK_SL_DEPLOY : SCRIPTS.UNPACK_SL_DEPLOY,
                params: { ifId },
            });

            const scriptParts = [
                '<script>',
                '(function () {',
                '  var _win;',
                '  window.openManagePacking = function () {',
                '    var u = ' + JSON.stringify(suiteUrl) + ';',
                '    var f = ' + JSON.stringify(POPUP_FEATURES) + ';',
                '    if (_win && !_win.closed) { _win.location.href = u; _win.focus(); }',
                '    else { _win = window.open(u, "managePacking", f); }',
                '  };',
                '  window.addEventListener("message", function (e) {',
                '    if (!e.data) return;',
                '    if (e.data.type === "PACKING_COMPLETE" || e.data.type === "UNPACK_COMPLETE") {',
                '      alert("Complete. The page will now reload.");',
                '      window.location.reload();',
                '    }',
                '  });',
                '}());',
                '<\/script>',
            ];

            const scriptField = form.addField({
                id:    'custpage_pack_btn_init',
                type:  serverWidget.FieldType.INLINEHTML,
                label: ' ',
            });
            scriptField.defaultValue = scriptParts.join('\n');

            form.addButton({
                id:           'custpage_lime_manage_packing',
                label:        'Manage Packing',
                functionName: 'openManagePacking',
            });

        } catch (e) {
            log.error({ title: 'ue_fulfillment_buttons.beforeLoad ERROR', details: e });
        }
    };

    const getCreatedFromType = (transactionId) => {
        try {
            const fields = search.lookupFields({
                type:    'transaction',
                id:      transactionId,
                columns: ['recordtype'],
            });
            return fields.recordtype || '';
        } catch (e) {
            log.error({ title: 'getCreatedFromType error', details: e });
            return '';
        }
    };

    return { beforeLoad };
});
