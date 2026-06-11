const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: /^[a-z0-9-]+$/,
    },
    
    description: {
        type: String,
    },
    
    logo: {
        type: String, // URL to logo
    },
    
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
    },
    
    contact: {
        phone: String,
        email: String,
        website: String,
    },
    
    subdomain: {
        type: String,
        unique: true,
        sparse: true, // Optional - can use custom domain instead
        lowercase: true,
    },
    
    customDomain: {
        type: String,
        unique: true,
        sparse: true,
    },
    
    branding: {
        primaryColor: {
            type: String,
            default: '#10b981', // Green color from your app
        },
        secondaryColor: {
            type: String,
            default: '#0891b2',
        },
        accentColor: {
            type: String,
            default: '#10b981',
        },
    },
    
    superAdmin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true, // Cannot be changed after creation
    },
    
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended'],
        default: 'active',
    },
    
    subscriptionTier: {
        type: String,
        enum: ['free', 'pro', 'enterprise'],
        default: 'free',
    },
    
    maxUsers: {
        type: Number,
        default: 50,
    },
    
    currentUserCount: {
        type: Number,
        default: 0,
    },
    
    features: {
        appointments: { type: Boolean, default: true },
        billing: { type: Boolean, default: true },
        pharmacy: { type: Boolean, default: true },
        radiology: { type: Boolean, default: true },
        laboratory: { type: Boolean, default: true },
        medicalRecords: { type: Boolean, default: true },
        audit: { type: Boolean, default: true },
    },
    
    settings: {
        timeZone: {
            type: String,
            default: 'UTC',
        },
        dateFormat: {
            type: String,
            default: 'DD/MM/YYYY',
        },
        currency: {
            type: String,
            default: 'USD',
        },
        twoFactorEnabled: {
            type: Boolean,
            default: false,
        },
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
    },
    
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    
    metadata: {
        industryType: String,
        bedCount: Number,
        departmentCount: Number,
    },
}, { timestamps: true });

// Index for faster tenant lookups
hospitalSchema.index({ slug: 1 });
hospitalSchema.index({ subdomain: 1 });
hospitalSchema.index({ customDomain: 1 });
hospitalSchema.index({ superAdmin: 1 });

module.exports = mongoose.model('Hospital', hospitalSchema);
