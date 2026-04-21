/**
 * pack_config.js — Packing Suitelet Configuration Constants
 *
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Centralized record/field/script IDs for the Pack/Unpack Suitelet system.
 *
 * !! VERIFY ALL IDs IN TARGET ACCOUNT BEFORE DEPLOYMENT !!
 */
define([], () => {

    /** Custom record type IDs */
    const RECORDS = {
        PACKAGE_TYPE:     'customrecord_lime_package_type',
        SHIP_UNIT:        'customrecord_lime_ship_unit',
        SHIPMENT_SUMMARY: 'customrecord_lime_shipment_summary',
    };

    /** Fields on the Package Type custom record */
    const PKG_TYPE = {
        LENGTH:   'custrecord_lime_pt_length',
        WIDTH:    'custrecord_lime_pt_width',
        HEIGHT:   'custrecord_lime_pt_height',
        DIM_UNIT: 'custrecord_lime_pt_dim_unit',
    };

    /** Fields on the Ship Unit custom record */
    const SHIP_UNIT = {
        ORDERS:   'custrecord_lime_ship_unit_orders',   // MULTISELECT → Transfer Orders
        FULFILL:  'custrecord_lime_ship_unit_fulfill',  // MULTISELECT → Item Fulfillments
        WU:       'custrecord_lime_ship_unit_wu',       // LIST → custlist_lime_pack_weight_unit
        DU:       'custrecord_lime_ship_unit_du',       // LIST → custlist_lime_pack_dim_unit
        LENGTH:   'custrecord_lime_ship_unit_length',
        WIDTH:    'custrecord_lime_ship_unit_width',
        HEIGHT:   'custrecord_lime_ship_unit_height',
        PKG_TYPE: 'custrecord_lime_ship_unit_pt',      // LIST/RECORD → customrecord_lime_package_type
        WEIGHT:   'custrecord_lime_ship_unit_weight',
        NOTE:     'custrecord_lime_ship_unit_note',
        STATUS:   'custrecord_lime_ship_unit_status',  // CHECKBOX — true = unpacked
        SUMMARY:  'custrecord_lime_ship_unit_summ',    // LIST/RECORD → customrecord_lime_shipment_summary
        VOL:      'custrecord_lime_ship_unit_vol',     // DECIMAL — L × W × H for this unit
        VOL_UNIT: 'custrecord_lime_ship_unit_vol_unit', // LIST → customlist_lime_volume_units
    };

    /** Fields on the Shipment Summary custom record */
    const SUMMARY = {
        NOTES:             'custrecord_lime_ss_notes',
        PKG_COUNT:         'custrecord_lime_ss_pkg_count',
        WEIGHT:            'custrecord_lime_ss_weight',
        WU:                'custrecord_lime_ss_wu',
        PACKED_BY:         'custrecord_lime_ss_packed_by',
        PACKED_DATE:       'custrecord_lime_ss_date',
        LOCATION:          'custrecord_lime_ss_location',          // Ship From (pack location)
        DELIVERY_LOCATION: 'custrecord_lime_ss_deliv_location',    // Ship To (TO destination)
        ORDERS:            'custrecord_lime_ss_orders',            // Multiple Select → Transfer Orders
        FULFILLMENTS:      'custrecord_lime_ss_fulfillments',      // Multiple Select → Item Fulfillments
        INVENTORY_STATUS:  'custrecord_lime_ss_inventory_status',  // LIST/RECORD → Inventory Status
        UNPACKED:          'custrecord_lime_ss_unpacked',
        UNPACK_DATE:       'custrecord_lime_ss_unpack_date',
        SUMMARY_TEXT:      'custrecord_lime_ss_summary',
        VOLUME:            'custrecord_lime_ss_volume',            // DECIMAL — sum of all ship unit volumes
        VOLUME_UNIT:       'custrecord_lime_ss_vol_unit',          // LIST → customlist_lime_volume_units
    };

    /** Body fields on Item Fulfillment */
    const IF_FIELDS = {
        WMS_STATUS:       'status',     // search column — getValue returns 'picked'/'packed'/'shipped'
        WMS_STATUS_WRITE: 'shipstatus', // record field for record.submitFields — values: A / B / C
    };

    /** shipstatus display values (search) and internal keys (write) */
    const WMS_STATUS = {
        PICKED:      'picked',
        PACKED:      'packed',
        SHIPPED:     'shipped',
        PICKED_KEY:  'A',
        PACKED_KEY:  'B',
        SHIPPED_KEY: 'C',
    };

    /** Custom list IDs */
    const LISTS = {
        WEIGHT_UNIT: 'customlist_lime_pack_weight_unit',
        DIM_UNIT:    'customlist_lime_pack_dim_unit',
        VOLUME_UNIT: 'customlist_lime_volume_units',
    };

    /** Script and deployment IDs for the Packing Suitelet system */
    const SCRIPTS = {
        PACK_SL:           'customscript_lime_sl_pack_fulfill',
        PACK_SL_DEPLOY:    'customdeploy_lime_sl_pack_fulfill',
        PACK_RL:           'customscript_lime_rl_pack_fulfill',
        PACK_RL_DEPLOY:    'customdeploy_lime_rl_pack_fulfill',
        UNPACK_SL:         'customscript_lime_sl_unpack_fulfill',
        UNPACK_SL_DEPLOY:  'customdeploy_lime_sl_unpack_fulfill',
        UNPACK_RL:         'customscript_lime_rl_unpack_fulfill',
        UNPACK_RL_DEPLOY:  'customdeploy_lime_rl_unpack_fulfill',
        UE_IF_BUTTONS:     'customscript_lime_ue_if_pack_btns',
        UE_IF_BUTTONS_DEP: 'customdeploy_lime_ue_if_pack_btns',
    };

    return {
        RECORDS,
        PKG_TYPE,
        SHIP_UNIT,
        SUMMARY,
        IF_FIELDS,
        WMS_STATUS,
        LISTS,
        SCRIPTS,
    };
});
