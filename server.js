const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const auditMiddleware = require('./middleware/auditMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const { tenantMiddleware, tenantDataFilter } = require('./middleware/tenantMiddleware');
const http = require('http');
const socket = require('./socket');
require('dotenv').config();

const app = express();

// Middleware
const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-hospital-id', 'x-tenant-id'],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  next();
});

// Audit logging middleware (logs all operations for HIPAA/GDPR compliance)
app.use(auditMiddleware);

// Multi-tenant middleware (identifies hospital/tenant context)
app.use(tenantMiddleware);
app.use(tenantDataFilter);

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Hospital API is running');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API v1 Routes - Professional Structure
const authRoutesV1 = require('./routes/api/v1/authRoutes');
const doctorRoutesV1 = require('./routes/api/v1/doctorRoutes');
const patientRoutesV1 = require('./routes/api/v1/patientRoutes');
const patientRoutes = require('./routes/patientRoutes');
const adminRoutesV1 = require('./routes/api/v1/adminRoutes');
const superAdminRoutes = require('./routes/api/v1/superAdminRoutes');
const hospitalAdminRoutes = require('./routes/api/v1/hospitalAdminRoutes');
const notificationRoutes = require('./routes/api/v1/notificationRoutes');

// Legacy Routes (for backward compatibility)
const appointmentRoutes = require('./routes/appointmentRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');
const labRoutes = require('./routes/labRoutes');
const radiologyRoutes = require('./routes/radiologyRoutes');
const billingRoutes = require('./routes/billingRoutes');
const medicalRecordRoutes = require('./routes/medicalRecordRoutes');
const pharmacyRoutes = require('./routes/pharmacyRoutes');
const auditRoutes = require('./routes/auditRoutes');
const userRoutes = require('./routes/userRoutes');

// Mount API v1 routes
app.use('/api/v1/auth', authRoutesV1);
app.use('/api/v1/doctors', doctorRoutesV1);
app.use('/api/v1/patients', patientRoutesV1);
// Legacy patients route for older clients/tests
app.use('/api/patients', patientRoutes);
app.use('/api/v1/admin', adminRoutesV1);
app.use('/api/v1/users', userRoutes);

// Multi-tenant SaaS routes
app.use('/api/v1/super-admin', superAdminRoutes);
app.use('/api/v1/hospital-admin', hospitalAdminRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Legacy routes - backward compatibility
app.use('/api/appointments', appointmentRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/lab', labRoutes);
app.use('/api/radiology', radiologyRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/users', userRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler — catches unhandled errors from routes
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack || err.message);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();
    const server = http.createServer(app);
    socket.init(server);
    return server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Audit logging enabled - logs stored in ./logs/`);
    });
};

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };