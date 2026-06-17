const express = require('express');
const router = express.Router();

/**
 * Public Tenant Route
 * This is called by the frontend on initial load to get branding config based on domain/subdomain
 * The `tenantMiddleware` must be loaded BEFORE this route.
 */
router.get('/tenant/branding', (req, res) => {
    try {
        if (!req.tenant || !req.tenant.hospital) {
            return res.json({
                success: true,
                data: {
                    isDefault: true,
                    branding: null
                }
            });
        }

        const hospital = req.tenant.hospital;
        
        // Return only safe, public branding info
        res.json({
            success: true,
            data: {
                id: hospital._id,
                name: hospital.name,
                slug: hospital.slug,
                logo: hospital.logo,
                branding: hospital.branding,
            }
        });
    } catch (error) {
        console.error('Public branding error:', error);
        res.status(500).json({ error: 'Failed to fetch branding' });
    }
});

module.exports = router;
