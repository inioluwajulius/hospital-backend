/**
 * READ-ONLY report of doctor/nurse accounts that are not linked to an existing hospital.
 * Such accounts no longer appear in any hospital's directory, approvals or booking lists
 * (hospitals only see their own staff). Nothing is changed: decide per account whether to
 * assign it to the right hospital (super admin) or leave it out.
 *
 *   node scripts/reportUnassignedDoctors.js            counts only
 *   node scripts/reportUnassignedDoctors.js --details  also lists id, role, status, created date
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Hospital = require('../models/Hospital');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const hospitalIds = await Hospital.distinct('_id');
    const query = { role: { $in: ['doctor', 'nurse'] }, $or: [{ hospitalId: null }, { hospitalId: { $nin: hospitalIds } }] };
    const accounts = await User.find(query).select('role status hospitalId createdAt').lean();

    console.log(`Doctor/nurse accounts without a valid hospital: ${accounts.length}`);
    const byKey = {};
    for (const a of accounts) {
        const key = `${a.role}/${a.status || 'active'}/${a.hospitalId ? 'unknown hospital' : 'no hospital'}`;
        byKey[key] = (byKey[key] || 0) + 1;
    }
    Object.entries(byKey).forEach(([key, n]) => console.log(`  ${key}: ${n}`));
    if (process.argv.includes('--details')) {
        accounts.forEach((a) => console.log(`  ${a._id} ${a.role} ${a.status || 'active'} created ${a.createdAt ? a.createdAt.toISOString() : '-'}`));
    }
    await mongoose.disconnect();
})().catch((error) => {
    console.error('Report failed:', error.message);
    process.exit(1);
});
