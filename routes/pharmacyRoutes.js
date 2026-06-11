const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const {
    addDrug,
    getDrugs,
    updateDrug,
    deleteDrug,
    dispenseDrug
} = require('../controllers/pharmacyController');

router.post('/drugs', authMiddleware, authorize('admin', 'pharmacist'), addDrug);
router.get('/drugs', authMiddleware, getDrugs);
router.patch('/drugs/:drugId/stock', authMiddleware, authorize('admin', 'pharmacist'), updateDrug);
router.delete('/drugs/:drugId', authMiddleware, authorize('admin', 'pharmacist'), deleteDrug);
router.post('/dispense', authMiddleware, authorize('admin', 'pharmacist'), dispenseDrug);

module.exports = router;