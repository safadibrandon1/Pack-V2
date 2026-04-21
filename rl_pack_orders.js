/**
 * rl_pack_orders.js — Packing: Pack Orders RESTlet
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope Public
 *
 * Script ID  : customscript_lime_rl_pack_fulfill
 * Deploy ID  : customdeploy_lime_rl_pack_fulfill
 *
 * Backend for the Pack Orders Suitelet (sl_pack_orders.js).
 *
 * GET  ?action=getPickedFulfillments
 *   → { success, orders: [{ toId, toTranId, sourceId, sourceName, destId, destName, fulfillments }] }
 *
 * GET  ?action=getDropdownData&ifIds=1,2,3
 *   → { success, packageTypes, weightUnits, dimUnits, defaultWuKey, defaultDuKey }
 *
 * POST { action: 'submitPacking', fulfillments, pallets, notes }
 *   → { success, summaryId, shipUnitCount }
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/cache',
    'N/query',
    'N/log',
    '/SuiteScripts/Packing/lib/pack_config',
], (search, record, runtime, cache, query, log, CONFIG) => {

    const { RECORDS, PKG_TYPE, SHIP_UNIT, SUMMARY, IF_FIELDS, WMS_STATUS, LISTS } = CONFIG;

    const CACHE_TTL = 900; // 15 min

    let _packCache;
    const getPackCache = () => {
        if (!_packCache) _packCache = cache.getCache({ name: 'lime_pack_fulfill', scope: cache.Scope.PUBLIC });
        return _packCache;
    };

    const getCached = (key, loaderFn) => {
        // Read from cache; only trust non-empty arrays (empty could be a stale error result)
        let raw = null;
        try { raw = getPackCache().get({ key }); } catch (e) { /* ignore */ }
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed) || parsed.length > 0) return parsed;
            } catch (e) { /* fall through */ }
        }
        const result = loaderFn();
        // Only cache non-empty arrays so transient failures don't poison the cache
        if (!Array.isArray(result) || result.length > 0) {
            try { getPackCache().put({ key, value: JSON.stringify(result), ttl: CACHE_TTL }); } catch (e) { /* ignore */ }
        }
        return result;
    };

    // ─── GET ──────────────────────────────────────────────────────────────────

    const get = (params) => {
        let result;
        try {
            switch (params.action) {
                case 'getPickedFulfillments': result = getPickedFulfillments();          break;
                case 'getDropdownData':       result = getDropdownData(params.ifIds);    break;
                default: result = { success: false, error: 'Unknown GET action: ' + params.action };
            }
        } catch (e) {
            log.error({ title: 'rl_pack_orders GET', details: e });
            result = { success: false, error: e.message };
        }
        return JSON.stringify(result);
    };

    // ─── POST ─────────────────────────────────────────────────────────────────

    const post = (body) => {
        try {
            if (body.action === 'submitPacking') return submitPacking(body);
            return { success: false, error: 'Unknown POST action: ' + body.action };
        } catch (e) {
            log.error({ title: 'rl_pack_orders POST', details: e });
            return { success: false, error: e.message };
        }
    };

    // ─── getPickedFulfillments ────────────────────────────────────────────────
    // Returns all Transfer Order IFs in "Picked" status,
    // grouped by Transfer Order for the selection UI.

    const getPickedFulfillments = () => {
        const ifRows = [];
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = (cutoff.getMonth() + 1) + '/' + cutoff.getDate() + '/' + cutoff.getFullYear();

        search.create({
            type: 'itemfulfillment',
            filters: [
                ['mainline',  'is',          'T'],
                'AND',
                ['trandate',  'onOrAfter',   cutoffStr],
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'createdfrom' }),
                search.createColumn({ name: 'location' }),
                search.createColumn({ name: 'transferlocation' }),
                search.createColumn({ name: IF_FIELDS.WMS_STATUS }),
            ],
        }).run().each((r) => {
            if (r.getValue(IF_FIELDS.WMS_STATUS) !== WMS_STATUS.PICKED) return true;
            ifRows.push({
                ifId:       String(r.getValue('internalid')),
                ifTranId:   r.getValue('tranid'),
                toId:       String(r.getValue('createdfrom')),
                toTranId:   r.getText('createdfrom'),
                sourceId:   String(r.getValue('location')),
                sourceName: r.getText('location'),
                destId:     String(r.getValue('transferlocation')),
                destName:   r.getText('transferlocation'),
            });
            return true;
        });

        // Group by Transfer Order
        const toMap = {};
        ifRows.forEach((row) => {
            if (!toMap[row.toId]) {
                toMap[row.toId] = {
                    toId:         row.toId,
                    toTranId:     row.toTranId,
                    sourceId:     row.sourceId,
                    sourceName:   row.sourceName,
                    destId:       row.destId,
                    destName:     row.destName,
                    fulfillments: [],
                };
            }
            toMap[row.toId].fulfillments.push({
                ifId:     row.ifId,
                ifTranId: row.ifTranId,
            });
        });

        return {
            success: true,
            orders:  Object.values(toMap),
        };
    };

    // ─── getDropdownData ──────────────────────────────────────────────────────
    // Returns package types (with default dimensions) and unit lists.
    // Country-based defaulting: US → LB/IN, non-US → KG/CM.

    const getDropdownData = (ifIdsParam) => {
        const packageTypes = getCached('packageTypes', fetchPackageTypes);
        const weightUnits  = getCached('weightUnits',  () => fetchListValues(LISTS.WEIGHT_UNIT));
        const dimUnits     = getCached('dimUnits',      () => fetchListValues(LISTS.DIM_UNIT));

        // Resolve location from IF, fall back to user's default location
        let locationId = null;
        if (ifIdsParam) {
            try {
                const firstIfId = String(ifIdsParam).split(',')[0].trim();
                const ifFields  = search.lookupFields({
                    type:    'itemfulfillment',
                    id:      firstIfId,
                    columns: ['location'],
                });
                locationId = ifFields.location && ifFields.location[0]
                    ? ifFields.location[0].value : null;
            } catch (e) {
                log.error({ title: 'getDropdownData IF location lookup', details: e });
            }
        }
        if (!locationId) locationId = runtime.getCurrentUser().location || null;

        const locInfo = locationId ? getLocationInfo(locationId) : { isUS: false };

        const defaultWu = locInfo.isUS
            ? (weightUnits.find(u => u.name === 'LB') || weightUnits[0])
            : (weightUnits.find(u => u.name === 'KG') || weightUnits[0]);

        const defaultDu = locInfo.isUS
            ? (dimUnits.find(u => u.name === 'IN') || dimUnits[0])
            : (dimUnits.find(u => u.name === 'CM') || dimUnits[0]);

        return {
            success:      true,
            packageTypes: packageTypes.map(p => ({
                key:     p.id,
                label:   p.name,
                length:  p.length,
                width:   p.width,
                height:  p.height,
                dimUnit: p.dimUnit,
            })),
            weightUnits:  weightUnits.map(u => ({ key: u.id, label: u.name })),
            dimUnits:     dimUnits.map(u => ({ key: u.id, label: u.name })),
            defaultWuKey: defaultWu ? String(defaultWu.id) : '',
            defaultDuKey: defaultDu ? String(defaultDu.id) : '',
        };
    };

    // ─── submitPacking ────────────────────────────────────────────────────────
    // Creates all records synchronously:
    //   1. Shipment Summary (with aggregate weight and volume)
    //   2. Ship Unit records (one per pallet, each with individual volume)
    //   3. Updates Item Fulfillments to "Packed" status
    //
    // Expected body:
    //   fulfillments: [{ ifId, toId, toTranId, ifTranId, sourceId, destId }]
    //   pallets:      [{ pkgTypeId, length, width, height, weight, wuId, duId }]
    //   notes:        string

    const submitPacking = (body) => {
        const { fulfillments, pallets, notes } = body;

        if (!Array.isArray(fulfillments) || !fulfillments.length) {
            return { success: false, error: 'No fulfillments provided.' };
        }
        if (!Array.isArray(pallets) || !pallets.length) {
            return { success: false, error: 'No packages defined. Add at least one package.' };
        }
        for (let i = 0; i < pallets.length; i++) {
            const p = pallets[i];
            if (!p.pkgTypeId) {
                return { success: false, error: 'Package ' + (i + 1) + ' is missing a Package Type.' };
            }
            if (!(parseFloat(p.length) > 0) || !(parseFloat(p.width) > 0) ||
                !(parseFloat(p.height) > 0) || !(parseFloat(p.weight) > 0)) {
                return { success: false, error: 'Package ' + (i + 1) + ' is missing Length, Width, Height, or Weight.' };
            }
        }

        const user = runtime.getCurrentUser();

        const allToIds = [...new Set(fulfillments.map(f => parseInt(f.toId, 10)))];
        const allIfIds = [...new Set(fulfillments.map(f => parseInt(f.ifId, 10)))];

        const locationId = (fulfillments[0] && fulfillments[0].sourceId) ? fulfillments[0].sourceId : user.location;
        const destId     = fulfillments[0] && fulfillments[0].destId ? parseInt(fulfillments[0].destId, 10) : null;

        // ── 1. Resolve volume unit IDs based on dim unit labels ───────────────
        const dimUnitsData = getCached('dimUnits', () => fetchListValues(LISTS.DIM_UNIT));
        const duMap = {};
        dimUnitsData.forEach(u => { duMap[String(u.id)] = u.name; });

        let volUnitCuM = null;
        let volUnitCuF = null;
        try {
            const volumeUnits = getCached('volumeUnits', () => fetchListValues(LISTS.VOLUME_UNIT));
            volUnitCuM = volumeUnits.find(u => u.name === 'CU M') || null;
            volUnitCuF = volumeUnits.find(u => u.name === 'CU F') || null;
        } catch (e) {
            log.error({ title: 'submitPacking: volume unit lookup', details: e });
        }

        const getVolUnitId = (duId) => {
            const duName   = duMap[String(duId)] || '';
            const isMetric = duName.toUpperCase() === 'CM';
            const match    = isMetric ? volUnitCuM : volUnitCuF;
            return match ? String(match.id) : null;
        };

        // ── 2. Calculate session aggregates ───────────────────────────────────
        let totalWeight    = 0;
        let totalVolume    = 0;
        let sessionWuId    = null;
        let sessionVolUnit = null;

        pallets.forEach((p) => {
            totalWeight += (parseFloat(p.weight) || 0);
            const vol = (parseFloat(p.length) || 0) * (parseFloat(p.width) || 0) * (parseFloat(p.height) || 0);
            totalVolume += vol;
            if (!sessionWuId    && p.wuId) sessionWuId    = p.wuId;
            if (!sessionVolUnit && p.duId) sessionVolUnit = getVolUnitId(p.duId);
        });

        // ── 3. Build lookup maps for summary text ─────────────────────────────
        const pkgTypeMap = {};
        getCached('packageTypes', fetchPackageTypes).forEach(pt => { pkgTypeMap[String(pt.id)] = pt.name; });

        const wuMap = {};
        getCached('weightUnits', () => fetchListValues(LISTS.WEIGHT_UNIT)).forEach(u => { wuMap[String(u.id)] = u.name; });

        const summaryText = pallets.map((p, i) => {
            const typeName = pkgTypeMap[String(p.pkgTypeId)] || 'Package';
            const L   = parseFloat(p.length)  || 0;
            const W   = parseFloat(p.width)   || 0;
            const H   = parseFloat(p.height)  || 0;
            const wt  = parseFloat(p.weight)  || 0;
            const unit = p.wuId ? (wuMap[String(p.wuId)] || '').toLowerCase() : '';
            return typeName + ' #' + (i + 1) + ': ' + L + ' x ' + W + ' x ' + H + ' - ' + wt + (unit ? ' ' + unit : '') + ' //';
        }).join('');

        // ── 4. Resolve inventory status from first available fulfillment line ──
        let inventoryStatusId = null;
        try {
            const firstIfRec = record.load({ type: 'itemfulfillment', id: allIfIds[0] });
            const lineCount  = firstIfRec.getLineCount({ sublistId: 'item' });
            outer: for (var i = 0; i < lineCount; i++) {
                try {
                    const invDetail = firstIfRec.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: i });
                    if (!invDetail) continue;
                    const assignCount = invDetail.getLineCount({ sublistId: 'inventoryassignment' });
                    for (var j = 0; j < assignCount; j++) {
                        const status = invDetail.getSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', line: j });
                        if (status) { inventoryStatusId = parseInt(status, 10); break outer; }
                    }
                } catch (e) { /* line has no inventory detail — skip */ }
            }
        } catch (e) {
            log.error({ title: 'submitPacking: inventory status lookup', details: e });
        }

        // ── 5. Create Shipment Summary ────────────────────────────────────────
        const ifNums      = [...new Set(fulfillments.map(f => f.ifTranId))].filter(Boolean);
        const summaryName = ifNums.length ? ifNums.join('-') : new Date().toISOString().slice(0, 10);

        log.audit({
            title:   'Creating Shipment Summary',
            details: 'Processing fulfillments: ' + fulfillments.map(f => f.ifTranId).join(', '),
        });

        const summRec = record.create({ type: RECORDS.SHIPMENT_SUMMARY, isDynamic: false });
        summRec.setValue({ fieldId: 'name',                     value: summaryName });
        summRec.setValue({ fieldId: SUMMARY.NOTES,              value: notes || '' });
        summRec.setValue({ fieldId: SUMMARY.PKG_COUNT,          value: pallets.length });
        summRec.setValue({ fieldId: SUMMARY.WEIGHT,             value: totalWeight });
        summRec.setValue({ fieldId: SUMMARY.VOLUME,             value: totalVolume });
        summRec.setValue({ fieldId: SUMMARY.SUMMARY_TEXT,       value: summaryText });
        if (sessionWuId)    summRec.setValue({ fieldId: SUMMARY.WU,           value: parseInt(sessionWuId, 10) });
        if (sessionVolUnit) summRec.setValue({ fieldId: SUMMARY.VOLUME_UNIT,  value: parseInt(sessionVolUnit, 10) });
        if (user.id)        summRec.setValue({ fieldId: SUMMARY.PACKED_BY,    value: parseInt(user.id, 10) });
        summRec.setValue({ fieldId: SUMMARY.PACKED_DATE, value: new Date() });
        if (locationId) summRec.setValue({ fieldId: SUMMARY.LOCATION,          value: parseInt(locationId, 10) });
        if (destId)     summRec.setValue({ fieldId: SUMMARY.DELIVERY_LOCATION, value: destId });
        summRec.setValue({ fieldId: SUMMARY.ORDERS,       value: allToIds });
        summRec.setValue({ fieldId: SUMMARY.FULFILLMENTS, value: allIfIds });
        if (inventoryStatusId) summRec.setValue({ fieldId: SUMMARY.INVENTORY_STATUS, value: inventoryStatusId });
        summRec.setValue({ fieldId: SUMMARY.UNPACKED, value: false });

        const summId = summRec.save();
        log.audit({ title: 'submitPacking', details: 'Created summary ' + summId });

        // ── 6. Update all Item Fulfillments to "Packed" status ────────────────
        allIfIds.forEach((ifId) => {
            record.submitFields({
                type:   'itemfulfillment',
                id:     ifId,
                values: { [IF_FIELDS.WMS_STATUS_WRITE]: WMS_STATUS.PACKED_KEY },
            });
        });

        // ── 7. Create Ship Unit records ───────────────────────────────────────
        let shipUnitCount = 0;

        pallets.forEach((pallet, palletIdx) => {
            const vol       = (parseFloat(pallet.length) || 0) * (parseFloat(pallet.width) || 0) * (parseFloat(pallet.height) || 0);
            const volUnitId = getVolUnitId(pallet.duId);

            const unitRec = record.create({ type: RECORDS.SHIP_UNIT, isDynamic: false });
            unitRec.setValue({ fieldId: SHIP_UNIT.ORDERS,   value: allToIds });
            unitRec.setValue({ fieldId: SHIP_UNIT.FULFILL,  value: allIfIds });
            unitRec.setValue({ fieldId: SHIP_UNIT.PKG_TYPE, value: parseInt(pallet.pkgTypeId, 10) });
            unitRec.setValue({ fieldId: SHIP_UNIT.LENGTH,   value: parseFloat(pallet.length)  || 0 });
            unitRec.setValue({ fieldId: SHIP_UNIT.WIDTH,    value: parseFloat(pallet.width)   || 0 });
            unitRec.setValue({ fieldId: SHIP_UNIT.HEIGHT,   value: parseFloat(pallet.height)  || 0 });
            unitRec.setValue({ fieldId: SHIP_UNIT.WEIGHT,   value: parseFloat(pallet.weight)  || 0 });
            unitRec.setValue({ fieldId: SHIP_UNIT.VOL,      value: vol });
            if (pallet.wuId) unitRec.setValue({ fieldId: SHIP_UNIT.WU,       value: parseInt(pallet.wuId, 10) });
            if (pallet.duId) unitRec.setValue({ fieldId: SHIP_UNIT.DU,       value: parseInt(pallet.duId, 10) });
            if (volUnitId)   unitRec.setValue({ fieldId: SHIP_UNIT.VOL_UNIT, value: parseInt(volUnitId, 10) });
            unitRec.setValue({ fieldId: SHIP_UNIT.NOTE,    value: notes || '' });
            unitRec.setValue({ fieldId: SHIP_UNIT.STATUS,  value: false });
            unitRec.setValue({ fieldId: SHIP_UNIT.SUMMARY, value: summId });

            const unitId = unitRec.save();
            shipUnitCount++;
            log.audit({ title: 'submitPacking', details: 'Ship unit ' + unitId + ' (package ' + (palletIdx + 1) + '), volume: ' + vol });
        });

        log.audit({ title: 'submitPacking', details: 'Complete: summary ' + summId + ', ' + shipUnitCount + ' ship units, total volume: ' + totalVolume });

        return { success: true, summaryId: String(summId), shipUnitCount };
    };

    // ─── Helpers ──────────────────────────────────────────────────────────────

    const fetchPackageTypes = () => {
        const types = [];
        search.create({
            type: RECORDS.PACKAGE_TYPE,
            filters: [['isinactive', 'is', 'F']],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'name' }),
                search.createColumn({ name: PKG_TYPE.LENGTH }),
                search.createColumn({ name: PKG_TYPE.WIDTH }),
                search.createColumn({ name: PKG_TYPE.HEIGHT }),
                search.createColumn({ name: PKG_TYPE.DIM_UNIT }),
            ],
        }).run().each((r) => {
            types.push({
                id:      String(r.getValue('internalid')),
                name:    r.getValue('name'),
                length:  r.getValue(PKG_TYPE.LENGTH)  || '',
                width:   r.getValue(PKG_TYPE.WIDTH)   || '',
                height:  r.getValue(PKG_TYPE.HEIGHT)  || '',
                dimUnit: r.getText(PKG_TYPE.DIM_UNIT) || '',
            });
            return true;
        });
        return types;
    };

    const fetchListValues = (listId) => {
        const values = [];

        // Approach 1: search.create with the list script ID as the record type
        try {
            search.create({
                type: listId,
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name' }),
                ],
            }).run().each((r) => {
                const id = r.getValue('internalid');
                const nm = r.getValue('name');
                if (id && nm) values.push({ id: String(id), name: String(nm) });
                return true;
            });
            if (values.length) return values;
            log.debug({ title: 'fetchListValues search returned empty for ' + listId, details: 'Trying SuiteQL' });
        } catch (e) {
            log.error({ title: 'fetchListValues search error for ' + listId, details: e });
        }

        // Approach 2: SuiteQL — table name is the list script ID
        try {
            query.runSuiteQL({ query: 'SELECT id, name FROM ' + listId + ' ORDER BY id' })
                .results.forEach((row) => {
                    if (row.values[0] && row.values[1])
                        values.push({ id: String(row.values[0]), name: String(row.values[1]) });
                });
        } catch (e) {
            log.error({ title: 'fetchListValues SuiteQL error for ' + listId, details: e });
        }

        return values;
    };

    const getLocationInfo = (locationId) => {
        try {
            const fields  = search.lookupFields({ type: 'location', id: locationId, columns: ['name', 'country'] });
            const country = fields.country && fields.country[0] ? String(fields.country[0].value) : '';
            return { name: fields.name || '', isUS: country === 'US' };
        } catch (e) {
            log.error({ title: 'getLocationInfo error', details: e });
            return { name: '', isUS: false };
        }
    };

    return { get, post };
});
