const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');
const Patient = require('../models/Patient');
const Prescription = require('../models/Prescription');

// Each hospital has its own inventory. Super admins (no tenant filter) see all.
const tenantScope = (req) => (req.tenantFilter && req.tenantFilter.hospitalId ? { hospitalId: req.tenantFilter.hospitalId } : {});

// Add a new drug to the inventory
exports.addDrug = async (req, res) => {
    try {
        const { name, category, manufacturer, price, stock, expiryDate } = req.body;
        const newDrug = new Drug({ name, category, manufacturer, price, stock, expiryDate, ...tenantScope(req) });
        await newDrug.save();
        res.status(201).json({ message: 'Drug added successfully', drug: newDrug });
    } catch (error) {
        res.status(500).json({ message: 'Error adding drug', error: error.message });
    }
};

// Get all drugs in the inventory
exports.getAllDrugs = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const query = { ...tenantScope(req), ...(includeInactive ? {} : { isActive: true }) };
        const drugs = await Drug.find(query);
        res.status(200).json(drugs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching drugs', error: error.message });
    }
};

// Update Stock of a Drug
exports.updateStock = async (req, res) => {
    try {
        const { drugId } = req.params;
        const stock = Number(req.body.stock);
        if (!Number.isInteger(stock) || stock < 0) {
            return res.status(400).json({ message: 'Stock must be a non-negative whole number' });
        }
        const updatedDrug = await Drug.findOneAndUpdate(
            { _id: drugId, isActive: true, ...tenantScope(req) },
            { stock },
            { new: true }
        );
        if (!updatedDrug) {
            return res.status(404).json({ message: 'Drug not found' });
        }
        res.status(200).json({ message: 'Stock updated successfully', drug: updatedDrug });
    } catch (error) {
        res.status(500).json({ message: 'Error updating stock', error: error.message });
    }
};

// Soft-delete a drug to preserve audit/history records
exports.deleteDrug = async (req, res) => {
    try {
        const { drugId } = req.params;

        const drug = await Drug.findOne({ _id: drugId, ...tenantScope(req) });
        if (!drug || !drug.isActive) {
            return res.status(404).json({ message: 'Drug not found' });
        }

        if (drug.stock > 0) {
            return res.status(400).json({ message: 'Cannot delete drug with stock greater than zero' });
        }

        drug.isActive = false;
        drug.deletedAt = new Date();
        await drug.save();

        res.status(200).json({ message: 'Drug deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting drug', error: error.message });
    }
};


// Dispense a drug to a patient, optionally against a prescription
exports.dispenseDrug = async (req, res) => {
    try {
        const { patientId, prescriptionId, drugId } = req.body;
        const quantity = Number(req.body.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ message: 'Quantity must be a positive whole number' });
        }

        const scope = tenantScope(req);

        // Patient and prescription must belong to this hospital
        if (!patientId) {
            return res.status(400).json({ message: 'patientId is required' });
        }
        if (scope.hospitalId) {
            const patient = await Patient.findOne({ _id: patientId, ...scope }).select('_id');
            if (!patient) {
                return res.status(400).json({ message: 'Patient not found in this hospital' });
            }
        }
        if (prescriptionId) {
            const prescription = await Prescription.findOne({ _id: prescriptionId, patientId, ...scope }).select('status');
            if (!prescription) {
                return res.status(400).json({ message: 'Prescription not found for this patient' });
            }
            if (prescription.status === 'dispensed') {
                return res.status(400).json({ message: 'Prescription has already been dispensed' });
            }
        }

        // Check and decrement stock in one atomic update so concurrent
        // dispenses can never drive stock below zero
        const drug = await Drug.findOneAndUpdate(
            { _id: drugId, isActive: true, stock: { $gte: quantity }, ...scope },
            { $inc: { stock: -quantity } },
            { new: true }
        );
        if (!drug) {
            const exists = await Drug.findOne({ _id: drugId, isActive: true, ...scope }).select('_id');
            return exists
                ? res.status(400).json({ message: 'Insufficient stock' })
                : res.status(404).json({ message: 'Drug not found' });
        }

        // Create dispense record
        const newDispense = new Dispense({
            patientId,
            prescriptionId,
            drugId,
            quantity,
            pharmacistId: req.user.userId,
            ...scope
        });
        try {
            await newDispense.save();
        } catch (saveError) {
            // Put the stock back if the record couldn't be saved
            await Drug.updateOne({ _id: drugId }, { $inc: { stock: quantity } });
            throw saveError;
        }

        if (prescriptionId) {
            await Prescription.updateOne({ _id: prescriptionId, ...scope }, { status: 'dispensed' });
        }

        res.status(201).json({ message: 'Drug dispensed successfully', dispense: newDispense });
    } catch (error) {
        res.status(500).json({ message: 'Error dispensing drug', error: error.message });
    }
};

// Backward-compatible aliases expected by routes.
exports.getDrugs = exports.getAllDrugs;
exports.updateDrug = exports.updateStock;
