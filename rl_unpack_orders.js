/**
 * rl_unpack_orders.js — Packing Unpack Orders RESTlet
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope Public
 *
 * Script ID  : customscript_lime_rl_unpack_fulfill
 * Deploy ID  : customdeploy_lime_rl_unpack_fulfill
 *
 * GET  ?action=getPackedOrders
 *   → { success, locationId, locationName, orders: [{ toId, toTranId, destName, fulfillments }] }
 *
 * GET  ?action=getShipUnits&toIds=1,2,3
 *   → { success, shipUnits: [{ id, name, pkgTypeName, length, width, height,
 *                              weight, wuName, duName, unpacked }] }
 *
 * POST body: { action: 'unpackShipUnits', toIds: [id, ...] }
 *   → { success, unpacked: N, ifsReverted: N }
 *
 * Unpack logic:
 *   · Mark each active ship unit: custrecord_lime_ship_unit_status = true (unpacked)
 *   · Collect all IFs linked to the selected ship units
 *   · Revert ALL linked IFs back to "Picked" WMS status (all-or-nothing per the
 *     confirmed requirement — reversing any packing reverts the full fulfillment)
 *   · If all ship units for a Shipment Summary are now unpacked, mark the summary as unpacked
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/log',
    '/SuiteScripts/Packing/lib/pack_config',
], (search, record, runtime, log, CONFIG) => {

    const { RECORDS, SHIP_UNIT, SUMMARY, IF_FIELDS, WMS_STATUS } = CONFIG;

    // ─── GET ─────────────────────────────────────────────────────────────────

    const get = (params) => {
        let result;
        try {
            switch (params.action) {
                case 'getPackedOrders': result = getPackedOrders(); break;
                default: result = { success: false, error: 'Unknown GET action: ' + params.action };
            }
        } catch (e) {
            log.error({ title: 'rl_unpack_orders GET', details: e });
            result = { success: false, error: e.message };
        }
        return JSON.stringify(result);
    };

    // ─── POST ────────────────────────────────────────────────────────────────

    const post = (body) => {
        try {
            if (body.action === 'unpackShipUnits') {
                return unpackShipUnits(body.toIds);
            }
            return { success: false, error: 'Unknown POST action: ' + body.action };
        } catch (e) {
            log.error({ title: 'rl_unpack_orders POST', details: e });
            return { success: false, error: e.message };
        }
    };

    // ─── getPackedOrders ─────────────────────────────────────────────────────
    // Returns all TOs that have at least one IF in "Packed" WMS status,
    // grouped by TO, using a 90-day date cutoff for performance.

    const getPackedOrders = () => {
        const user       = runtime.getCurrentUser();
        const locationId = user.location;
        const locInfo    = locationId ? getLocationInfo(locationId) : { name: '' };

        const ifRows = [];
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = (cutoff.getMonth() + 1) + '/' + cutoff.getDate() + '/' + cutoff.getFullYear();

        search.create({
            type: 'itemfulfillment',
            filters: [
                ['mainline',  'is',        'T'],
                'AND',
                ['trandate',  'onOrAfter', cutoffStr],
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'createdfrom' }),
                search.createColumn({ name: 'transferlocation' }),
                search.createColumn({ name: IF_FIELDS.WMS_STATUS }),
            ],
        }).run().each((r) => {
            if (r.getValue(IF_FIELDS.WMS_STATUS) !== WMS_STATUS.PACKED) return true;
            ifRows.push({
                ifId:     String(r.getValue('internalid')),
                ifTranId: r.getValue('tranid'),
                toId:     String(r.getValue('createdfrom')),
                toTranId: r.getText('createdfrom'),
                destId:   String(r.getValue('transferlocation')),
                destName: r.getText('transferlocation'),
            });
            return true;
        });

        // Build ifId → summaryId map directly from Shipment Summary FULFILLMENTS field.
        // Filter summaries that contain our IF IDs — each matching row gives us the link.
        const ifSummaryMap = {};
        const ifIdList = ifRows.map((r) => r.ifId).filter(Boolean);
        if (ifIdList.length) {
            search.create({
                type: RECORDS.SHIPMENT_SUMMARY,
                filters: [
                    [SUMMARY.UNPACKED,     'is',    'F'],
                    'AND',
                    [SUMMARY.FULFILLMENTS, 'anyof', ifIdList],
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: SUMMARY.FULFILLMENTS }),
                ],
            }).run().each((r) => {
                const summId     = String(r.getValue('internalid') || '');
                const fulfillVal = r.getValue(SUMMARY.FULFILLMENTS);
                const fulfills   = Array.isArray(fulfillVal)
                    ? fulfillVal.map(String)
                    : String(fulfillVal || '').split(',').map(s => s.trim()).filter(Boolean);
                fulfills.forEach((ifId) => {
                    if (ifId && summId && !ifSummaryMap[ifId]) ifSummaryMap[ifId] = summId;
                });
                return true;
            });
        }

        // Group by TO, carrying summaryId from the first IF matched
        const toMap = {};
        ifRows.forEach((row) => {
            if (!toMap[row.toId]) {
                toMap[row.toId] = {
                    toId:         row.toId,
                    toTranId:     row.toTranId,
                    destId:       row.destId,
                    destName:     row.destName,
                    summaryId:    ifSummaryMap[row.ifId] || null,
                    fulfillments: [],
                };
            }
            toMap[row.toId].fulfillments.push({ ifId: row.ifId, ifTranId: row.ifTranId });
        });

        return {
            success:      true,
            locationId,
            locationName: locInfo.name,
            orders:       Object.values(toMap),
        };
    };

    // ─── unpackShipUnits ─────────────────────────────────────────────────────
    // Given an array of TO internal IDs, finds all active ship units for those
    // TOs, marks them unpacked, reverts all linked IFs to Picked, and stamps
    // any fully-unpacked Shipment Summaries. Ship Unit Items are left intact.

    const unpackShipUnits = (toIds) => {
        if (!Array.isArray(toIds) || toIds.length === 0) {
            return { success: false, error: 'No TO IDs provided.' };
        }

        const now = new Date();

        // ── 1. Find all active ship units for these TOs ───────────────────────
        const shipUnitIds = [];
        const allIfIds    = new Set();
        const summaryIds  = new Set();

        search.create({
            type: RECORDS.SHIP_UNIT,
            filters: [
                [SHIP_UNIT.ORDERS, 'anyof', toIds],
                'AND',
                [SHIP_UNIT.STATUS, 'is', 'F'],
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: SHIP_UNIT.FULFILL }),
                search.createColumn({ name: SHIP_UNIT.SUMMARY }),
            ],
        }).run().each((r) => {
            shipUnitIds.push(String(r.getValue('internalid')));
            const fulfillVal = r.getValue(SHIP_UNIT.FULFILL);
            if (fulfillVal) {
                String(fulfillVal).split(',').forEach((id) => {
                    const trimmed = id.trim();
                    if (trimmed) allIfIds.add(trimmed);
                });
            }
            const summVal = r.getValue(SHIP_UNIT.SUMMARY);
            if (summVal) summaryIds.add(String(summVal));
            return true;
        });

        if (shipUnitIds.length === 0) {
            return { success: false, error: 'No active ship units found for the selected orders.' };
        }

        // ── 2. Mark ship units as unpacked ────────────────────────────────────
        shipUnitIds.forEach((unitId) => {
            record.submitFields({
                type:   RECORDS.SHIP_UNIT,
                id:     unitId,
                values: { [SHIP_UNIT.STATUS]: true },
            });
        });

        log.audit({
            title:   'unpackShipUnits',
            details: `Marked ${shipUnitIds.length} ship units as unpacked`,
        });

        // ── 3. Revert all linked IFs to Picked ────────────────────────────────
        let ifsReverted = 0;
        allIfIds.forEach((ifId) => {
            try {
                record.submitFields({
                    type:   'itemfulfillment',
                    id:     ifId,
                    values: { [IF_FIELDS.WMS_STATUS_WRITE]: WMS_STATUS.PICKED_KEY },
                });
                ifsReverted++;
            } catch (e) {
                log.error({ title: 'unpackShipUnits IF revert error ' + ifId, details: e });
            }
        });

        // ── 4. Stamp Summaries as unpacked if all their units are now done ────
        summaryIds.forEach((summId) => {
            try {
                const activeUnitsCount = search.create({
                    type: RECORDS.SHIP_UNIT,
                    filters: [
                        [SHIP_UNIT.SUMMARY, 'anyof', [summId]],
                        'AND',
                        [SHIP_UNIT.STATUS,  'is',    'F'],
                    ],
                }).runPaged().count;

                if (activeUnitsCount === 0) {
                    record.submitFields({
                        type:   RECORDS.SHIPMENT_SUMMARY,
                        id:     summId,
                        values: {
                            [SUMMARY.UNPACKED]:    true,
                            [SUMMARY.UNPACK_DATE]: now,
                        },
                    });
                }
            } catch (e) {
                log.error({ title: 'unpackShipUnits summary update error ' + summId, details: e });
            }
        });

        return { success: true, unpacked: shipUnitIds.length, ifsReverted };
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────

    const getLocationInfo = (locationId) => {
        try {
            const fields = search.lookupFields({
                type:    'location',
                id:      locationId,
                columns: ['name', 'country'],
            });
            return { name: fields.name || '', isUS: fields.country === 'US' };
        } catch (e) {
            return { name: '', isUS: false };
        }
    };

    return { get, post };
});
