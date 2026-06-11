const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    timestamp: {
        type: Date,
        default: Date.now,
        required: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    userName: {
        type: String,
        required: true,
    },
    userRole: {
        type: String,
        enum: ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'radiologist', 'patient', 'accountant'],
        required: true,
    },
    userAvatar: {
        type: String,
    },
    action: {
        type: String,
        required: true,
        description: 'The action performed (e.g., "Patient Record Updated")',
    },
    module: {
        type: String,
        enum: ['Medical Records', 'Security', 'Laboratory', 'Pharmacy', 'Radiology', 'Billing', 'Appointments', 'Patients', 'Users', 'System'],
        required: true,
    },
    severity: {
        type: String,
        enum: ['Info', 'Warning', 'Error', 'Critical'],
        default: 'Info',
    },
    ipAddress: {
        type: String,
    },
    details: {
        type: String,
        description: 'Additional details about the action',
    },
    resourceType: {
        type: String,
        description: 'Type of resource affected (e.g., "Patient", "Appointment")',
    },
    resourceId: {
        type: String,
        description: 'ID of the resource affected',
    },
    status: {
        type: String,
        enum: ['Success', 'Failed'],
        default: 'Success',
    },
}, { timestamps: true });

// Create index for faster queries
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ module: 1 });
auditLogSchema.index({ severity: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
