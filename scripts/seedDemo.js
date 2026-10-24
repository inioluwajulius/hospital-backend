/**
 * Seed a demo hospital with one account per role and a patient visit in progress,
 * so the full workflow can be shown live.
 *
 * Usage:
 *   node scripts/seedDemo.js            create the demo hospital (stops if it already exists)
 *   node scripts/seedDemo.js --reset    delete the demo hospital's data and recreate it
 *
 * Only data belonging to the demo hospital (slug "medicare-demo") is ever deleted.
 * All demo accounts share the password printed at the end (DEMO_PASSWORD env var to override).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Hospital = require('../models/Hospital');
const HospitalAdmin = require('../models/HospitalAdmin');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const LabTest = require('../models/LabTest');
const LabResult = require('../models/LabResult');
const Radiology = require('../models/Radiology');
const Invoice = require('../models/Invoice');
const Billing = require('../models/Billing');
const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');
const Notification = require('../models/Notification');

const SLUG = 'medicare-demo';
const DOMAIN = 'medicare-demo.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026!';
const reset = process.argv.includes('--reset');

const daysFromNow = (days, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
};

const STAFF = [
    { role: 'hospital_admin', name: 'Grace Okafor', email: `admin@${DOMAIN}` },
    { role: 'doctor', name: 'Dr. Tunde Adeyemi', email: `doctor@${DOMAIN}`, specialization: 'General Medicine', licenseNumber: 'MDCN-48213', yearsOfExperience: 9, department: 'Outpatients' },
    { role: 'nurse', name: 'Blessing Eze', email: `nurse@${DOMAIN}`, department: 'Outpatients' },
    { role: 'receptionist', name: 'Musa Ibrahim', email: `reception@${DOMAIN}`, department: 'Front Desk' },
    { role: 'lab_technician', name: 'Chioma Nwosu', email: `lab@${DOMAIN}`, department: 'Laboratory' },
    { role: 'pharmacist', name: 'Femi Ogunleye', email: `pharmacy@${DOMAIN}`, department: 'Pharmacy' },
    { role: 'radiologist', name: 'Dr. Halima Sani', email: `radiology@${DOMAIN}`, department: 'Radiology' },
    { role: 'accountant', name: 'Kelechi Obi', email: `billing@${DOMAIN}`, department: 'Accounts' },
];

const deleteDemoData = async (hospitalId) => {
    const patientIds = await Patient.find({ hospitalId }).distinct('_id');
    const byHospital = { hospitalId };
    await Promise.all([
        Appointment.deleteMany(byHospital),
        MedicalRecord.deleteMany(byHospital),
        Prescription.deleteMany(byHospital),
        LabTest.deleteMany(byHospital),
        LabResult.deleteMany(byHospital),
        Radiology.deleteMany({ $or: [byHospital, { patientId: { $in: patientIds } }] }),
        Invoice.deleteMany(byHospital),
        Billing.deleteMany(byHospital),
        Drug.deleteMany(byHospital),
        Dispense.deleteMany(byHospital),
        Notification.deleteMany(byHospital),
        HospitalAdmin.deleteMany(byHospital),
    ]);
    await Patient.deleteMany(byHospital);
    await User.deleteMany(byHospital);
    await Hospital.deleteOne({ _id: hospitalId });
};

(async () => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set (add it to hospital-backend/.env)');
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);

    try {
        const existing = await Hospital.findOne({ slug: SLUG });
        if (existing && !reset) {
            console.log('The demo hospital already exists. Run with --reset to recreate it.');
            return;
        }
        if (existing) {
            await deleteDemoData(existing._id);
            console.log('Removed previous demo data.');
        }
        // Demo emails are reserved for the demo hospital
        const clash = await User.findOne({ email: { $regex: `@${DOMAIN.replace('.', '\\.')}$` } }).select('email');
        if (clash) {
            console.error(`A user with a demo email already exists outside the demo hospital (${clash.email}). Aborting.`);
            process.exitCode = 1;
            return;
        }
        const cardClash = await Patient.findOne({ patientCardNumber: { $in: ['PAT-200001', 'PAT-200002'] } }).select('patientCardNumber');
        if (cardClash) {
            console.error(`Card number ${cardClash.patientCardNumber} is already used by a real patient. Aborting.`);
            process.exitCode = 1;
            return;
        }

        const hash = await bcrypt.hash(PASSWORD, 10);

        // Hospital + admin
        const adminSpec = STAFF[0];
        const admin = await User.create({ ...adminSpec, password: hash, status: 'active', isEmailVerified: true });
        const hospital = await Hospital.create({
            name: 'MediCare Demo Hospital',
            slug: SLUG,
            superAdmin: admin._id,
            status: 'active',
            description: 'Demo hospital for showcasing MediCare',
        });
        const hospitalId = hospital._id;
        admin.hospitalId = hospitalId;
        await admin.save();
        await HospitalAdmin.create({ userId: admin._id, hospitalId, email: admin.email, role: 'hospital_admin', status: 'active' });

        // Staff
        const users = { hospital_admin: admin };
        for (const spec of STAFF.slice(1)) {
            users[spec.role] = await User.create({ ...spec, password: hash, hospitalId, status: 'active', isEmailVerified: true });
        }
        const doctor = users.doctor;

        // Patient with an online account and an ongoing visit
        const patientUser = await User.create({
            name: 'Adaeze Okonkwo', email: `patient@${DOMAIN}`, password: hash, role: 'patient',
            hospitalId, status: 'active', isEmailVerified: true, patientCardNumber: 'PAT-200001',
        });
        const patient = await Patient.create({
            userId: patientUser._id, hospitalId, patientCardNumber: 'PAT-200001', status: 'active',
            registrationStatus: 'self_registered', age: 34, gender: 'female', phone: '08031112222',
            bloodGroup: 'O+', address: '12 Admiralty Way, Lekki, Lagos', allergies: ['Penicillin'],
            emergencyContact: { name: 'Chidi Okonkwo', relationship: 'Husband', phone: '08033334444' },
        });

        // Walk-in record with no account yet: used to demo "claim my record online"
        const walkIn = await Patient.create({
            hospitalId, patientCardNumber: 'PAT-200002', status: 'active', registrationStatus: 'new',
            name: 'Emeka Johnson', phone: '08055556666', age: 52, gender: 'male',
        });

        // History: completed visit with a record
        await Appointment.create({ patientId: patient._id, doctorId: doctor._id, hospitalId, appointmentDate: daysFromNow(-14, 9), reason: 'Persistent cough', status: 'completed' });
        await MedicalRecord.create({
            patientId: patient._id, doctorId: doctor._id, hospitalId,
            vitals: { bloodPressure: '118/76', heartRate: 78, weight: 64, height: 165, temperature: 37.4 },
            symptoms: 'Dry cough for two weeks, mild fever', diagnosis: 'Upper respiratory tract infection',
            treatment: 'Rest, fluids, antibiotics (penicillin-free)', notes: 'Review if not improving in 7 days',
        });

        // Today's work in progress, one item waiting at each desk
        await Appointment.create({ patientId: patient._id, doctorId: doctor._id, hospitalId, appointmentDate: daysFromNow(0, 11), reason: 'Follow-up: cough not resolved', status: 'scheduled' });
        await Appointment.create({ patientId: walkIn._id, doctorId: doctor._id, hospitalId, appointmentDate: daysFromNow(1, 14), reason: 'Blood pressure check', status: 'scheduled', isUrgent: true });
        await LabTest.create({ patientId: patient._id, hospitalId, doctorId: doctor._id, testName: 'Full Blood Count', category: 'Blood', priority: 'Urgent', status: 'Pending' });
        await LabTest.create({ patientId: walkIn._id, hospitalId, doctorId: doctor._id, testName: 'Fasting Blood Sugar', category: 'Biochemistry', priority: 'Normal', status: 'Pending' });
        await Radiology.create({ patientId: patient._id, hospitalId, doctorId: doctor._id, examOrder: `RAD-DEMO-${Date.now()}`, examType: 'xray', bodyPart: 'Chest', priority: 'urgent', status: 'ordered' });
        await Prescription.create({
            patientId: patient._id, doctorId: doctor._id, hospitalId, status: 'pending',
            medications: [{ name: 'Azithromycin', dosage: '500mg', frequency: 'Once daily', duration: '3 days' }],
            notes: 'Penicillin allergy: macrolide prescribed',
        });

        // Pharmacy inventory
        await Drug.insertMany([
            { name: 'Azithromycin 500mg', category: 'Antibiotic', manufacturer: 'Emzor', price: 1800, stock: 40, expiryDate: daysFromNow(400) },
            { name: 'Paracetamol 500mg', category: 'Analgesic', manufacturer: 'Fidson', price: 300, stock: 200, expiryDate: daysFromNow(500) },
            { name: 'Amlodipine 5mg', category: 'Antihypertensive', manufacturer: 'May & Baker', price: 1200, stock: 6, expiryDate: daysFromNow(300) },
            { name: 'Metformin 500mg', category: 'Antidiabetic', manufacturer: 'Swipha', price: 900, stock: 75, expiryDate: daysFromNow(360) },
            { name: 'Artemether/Lumefantrine', category: 'Antimalarial', manufacturer: 'Emzor', price: 2500, stock: 0, expiryDate: daysFromNow(200) },
        ].map((d) => ({ ...d, hospitalId })));

        // Billing: one paid, one outstanding
        await Invoice.create({ patientId: patient._id, hospitalId, items: [{ description: 'Consultation', amount: 5000 }, { description: 'Antibiotics', amount: 3600 }], totalAmount: 8600, status: 'paid', paymentMethod: 'transfer' });
        await Invoice.create({ patientId: patient._id, hospitalId, items: [{ description: 'Follow-up consultation', amount: 3000 }], totalAmount: 3000, status: 'unpaid' });

        console.log('\nDemo hospital ready: MediCare Demo Hospital');
        console.log(`Password for every account: ${PASSWORD}\n`);
        console.log('Staff and admin log in at /auth/login/doctor; the patient at /auth/login/patient:');
        for (const spec of STAFF) console.log(`  ${spec.role.padEnd(15)} ${spec.email}`);
        console.log(`  ${'patient'.padEnd(15)} patient@${DOMAIN}`);
        console.log('\nWalk-in record to claim online (Register > Patient > "I have an existing record"):');
        console.log('  Hospital: MediCare Demo Hospital   Card: PAT-200002   Phone: 08055556666');
    } finally {
        await mongoose.disconnect();
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
