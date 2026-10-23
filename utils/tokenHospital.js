const mongoose = require('mongoose');

/**
 * Hospital id carried in a decoded JWT, as a string (or null).
 * Tokens issued before this fix embedded the populated hospital
 * ({ _id, name }) instead of the bare id, so accept both shapes.
 */
const tokenHospitalId = (decoded) => {
    const raw = decoded && decoded.hospitalId;
    const id = raw && typeof raw === 'object' ? raw._id : raw;
    return id && mongoose.isValidObjectId(id) ? String(id) : null;
};

module.exports = tokenHospitalId;
