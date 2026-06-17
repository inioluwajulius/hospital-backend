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
        default: function() {
            return this.role === 'patient' ? 'pending' : 'active';
        }
    },
    
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
    
}, { timestamps: true });

// isSuperAdmin already indexed via index:true in field definition
userSchema.index({ email: 1, hospitalId: 1 }, { unique: true, sparse: true });
userSchema.index({ hospitalId: 1, role: 1 });
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