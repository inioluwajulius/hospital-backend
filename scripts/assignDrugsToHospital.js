/**
 * One-off migration: pharmacy inventory is now per hospital. Drugs created before
 * that change have no hospitalId and are hidden from every hospital. This assigns
 * them (and their dispense records) to the given hospital.
 *
 * Usage: node scripts/assignDrugsToHospital.js <hospitalId> [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Hospital = require('../models/Hospital');
const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');

const [hospitalId, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';

(async () => {
    if (!hospitalId || !mongoose.isValidObjectId(hospitalId)) {
        console.error('Usage: node scripts/assignDrugsToHospital.js <hospitalId> [--dry-run]');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    try {
        const hospital = await Hospital.findById(hospitalId).select('name');
        if (!hospital) {
            console.error(`Hospital ${hospitalId} not found`);
            process.exit(1);
        }

        const unassigned = { $or: [{ hospitalId: { $exists: false } }, { hospitalId: null }] };
        const drugCount = await Drug.countDocuments(unassigned);
        const dispenseCount = await Dispense.countDocuments(unassigned);
        console.log(`Unassigned: ${drugCount} drugs, ${dispenseCount} dispense records -> "${hospital.name}"`);

        if (dryRun) {
            console.log('Dry run: nothing changed.');
        } else {
            await Drug.updateMany(unassigned, { hospitalId });
            await Dispense.updateMany(unassigned, { hospitalId });
            console.log('Done.');
        }
    } finally {
        await mongoose.disconnect();
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
