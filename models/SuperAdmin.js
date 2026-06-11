const mongoose = require('mongoose');

const superAdminSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        immutable: true,
    },
    
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
    },
    
    permissions: {
        createHospitals: { type: Boolean, default: true },
        editHospitals: { type: Boolean, default: true },
        deleteHospitals: { type: Boolean, default: true },
        manageBilling: { type: Boolean, default: true },
        viewAnalytics: { type: Boolean, default: true },
        manageSubscriptions: { type: Boolean, default: true },
        viewAuditLogs: { type: Boolean, default: true },
    },
    
    accessLevel: {
        type: String,
        enum: ['full', 'limited'],
        default: 'full',
    },
    
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active',
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
    },
    
    lastLogin: Date,
    
}, { timestamps: true });

module.exports = mongoose.model('SuperAdmin', superAdminSchema);
