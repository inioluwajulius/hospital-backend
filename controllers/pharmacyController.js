const Drug = require('../models/Drug');
const Dispense = require('../models/Dispense');

// Add a new drug to the inventory
exports.addDrug = async (req, res) => {
    try {
        const { name, category, manufacturer, price, stock, expiryDate } = req.body;
        const newDrug = new Drug({ name, category, manufacturer, price, stock, expiryDate });
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
        const drugs = includeInactive ? await Drug.find() : await Drug.find({ isActive: true });
        res.status(200).json(drugs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching drugs', error: error.message });
    }
};

// Update Stock of a Drug
exports.updateStock = async (req, res) => {
    try {
        const { drugId } = req.params;
        const { stock } = req.body;
        const updatedDrug = await Drug.findOneAndUpdate(
            { _id: drugId, isActive: true },
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

        const drug = await Drug.findById(drugId);
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


// Dispense a drug to a patient
exports.dispenseDrug = async (req, res) => {
    try {
        const { patientId, prescriptionId, drugId, quantity, pharmacistId } = req.body;
        const drug = await Drug.findById(drugId);
        if (!drug || !drug.isActive) {
            return res.status(404).json({ message: 'Drug not found' });
        }
        if (drug.stock < quantity) {
            return res.status(400).json({ message: 'Insufficient stock' });
        }
        // Update drug stock
        drug.stock -= quantity;
        await drug.save();
        // Create dispense record
        const newDispense = new Dispense({
            patientId,
            prescriptionId,
            drugId,
            quantity,
            pharmacistId
        });
        await newDispense.save();
        res.status(201).json({ message: 'Drug dispensed successfully', dispense: newDispense });
    } catch (error) {
        res.status(500).json({ message: 'Error dispensing drug', error: error.message });
    }
};

// Backward-compatible aliases expected by routes.
exports.getDrugs = exports.getAllDrugs;
exports.updateDrug = exports.updateStock;