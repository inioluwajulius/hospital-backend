const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    
    // Email Verification & Password Reset
    isEmailVerified: {
        type: Boolean,
        default: false,
    },
    // Set after an admin issues a temporary password; the user must choose a new one
    mustChangePassword: {
        type: Boolean,
        default: false,
    },
    lastLoginAt: Date,
    // Set for accounts registered while email delivery is configured; login is blocked
    // until they verify. Older accounts don't have it, so they aren't locked out.
    emailVerificationRequired: {
        type: Boolean,
        default: false,
    },
    emailVerificationToken: {
        type: String,
        select: false,
    },
    emailVerificationExpires: {
        type: Date,
        select: false,
    },
    resetPasswordToken: {
        type: String,
        select: false,
    },
    resetPasswordExpires: {
        type: Date,
        select: false,
    },
    
    // Multi-tenancy: Hospital/Tenant reference
    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        sparse: true, // SuperAdmin may not have a hospital
        index: true,
    },
    
    // User classification
    isSuperAdmin: {
        type: Boolean,
        default: false,
        index: true,
    },
    
    role: {
        type: String,
        enum: ['super_admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'radiologist', 'patient', 'accountant'],
        default: 'patient',
    },
    status: {
        type: String,
        enum: ['active', 'pending', 'rejected', 'inactive', 'suspended'],
        default: 'active'
    },

    // Decision on a self-registered staff application (doctor/nurse). The account
    // stays 'pending' until a hospital admin of the same hospital decides.
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: { type: String, maxlength: 500 },
    
    // Patient-specific fields
    patientCardNumber: {
        type: String,
        sparse: true,
    },
    
    // Doctor-specific fields
    specialization: {
        type: String,
        sparse: true,
    },
    licenseNumber: {
        type: String,
        sparse: true,
    },
    yearsOfExperience: {
        type: Number,
        sparse: true,
    },
    
    // Invitation System
    invitationToken: {
        type: String,
        sparse: true,
        select: false,
    },
    
    invitationExpires: {
        type: Date,
        sparse: true,
        select: false,
    },
    
    invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        sparse: true,
    },
    
    invitationEmail: {
        type: String,
        sparse: true,
    },
    
    // Authentication tracking
    lastLogin: Date,
    lastLoginIP: String,
    loginCount: {
        type: Number,
        default: 0,
    },
    
    // Two-factor authentication
    twoFactorEnabled: {
        type: Boolean,
        default: false,
    },
    twoFactorSecret: {
        type: String,
        select: false,
        sparse: true,
    },
    
    // Metadata
    phone: String,
    avatar: String,
    department: String,

    // Doctors' weekly consulting hours (clinic local time). Empty = no restriction.
    availability: [{
        _id: false,
        day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
        start: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
        end: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
    }],
    
}, { timestamps: true });

// isSuperAdmin already indexed via index:true in field definition
userSchema.index({ email: 1, hospitalId: 1 }, { unique: true, sparse: true });
userSchema.index({ hospitalId: 1, role: 1 });
userSchema.index({ hospitalId: 1, status: 1, role: 1 });
userSchema.index({ invitationToken: 1 });

const stripSensitiveFields = (_, ret) => {
    delete ret.password;
    delete ret.invitationToken;
    delete ret.twoFactorSecret;
    delete ret.emailVerificationToken;
    delete ret.resetPasswordToken;
    delete ret.__v;
    return ret;
};

userSchema.set('toJSON', { transform: stripSensitiveFields });
userSchema.set('toObject', { transform: stripSensitiveFields });

module.exports = mongoose.model('User', userSchema);