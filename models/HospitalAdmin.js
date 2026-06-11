const mongoose = require('mongoose');

const hospitalAdminSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    
    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true,
        index: true,
    },
    
    email: {
        type: String,
        required: true,
        lowercase: true,
    },
    
    role: {
        type: String,
        enum: ['hospital_admin', 'hospital_manager', 'department_head'],
        default: 'hospital_admin',
    },
    
    department: {
        type: String,
        sparse: true,
    },
    
    permissions: {
        // User Management
        createUsers: { type: Boolean, default: false },
        editUsers: { type: Boolean, default: false },
        deleteUsers: { type: Boolean, default: false },
        inviteStaff: { type: Boolean, default: false },
        
        // Hospital Settings
        editHospitalSettings: { type: Boolean, default: false },
        editBranding: { type: Boolean, default: false },
        
        // Appointments
        manageAppointments: { type: Boolean, default: false },
        
        // Billing
        manageBilling: { type: Boolean, default: false },
        viewFinancials: { type: Boolean, default: false },
        
        // Reports
        viewReports: { type: Boolean, default: false },
        generateReports: { type: Boolean, default: false },
        
        // Audit Logs
        viewAuditLogs: { type: Boolean, default: false },
        
        // Features Management
        manageFeatures: { type: Boolean, default: false },
    },
    
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended'],
        default: 'active',
    },
    
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        sparse: true,
    },
    
    approvedAt: Date,
    
    createdAt: {
        type: Date,
        default: Date.now,
    },
    
    lastLogin: Date,
    
}, { timestamps: true });

// Compound index for faster lookups
hospitalAdminSchema.index({ hospitalId: 1, userId: 1 });
hospitalAdminSchema.index({ hospitalId: 1, status: 1 });

module.exports = mongoose.model('HospitalAdmin', hospitalAdminSchema);
