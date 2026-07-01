const mongoose = require('mongoose');
const Hospital = require('../models/Hospital');
const User = require('../models/User');

/**
 * Tenant Context Middleware
 * Extracts hospital/tenant information from request and sets it on req.tenant
 * Supports multiple identification methods:
 * 1. Subdomain: hospitalname.yourdomain.com
 * 2. Custom Domain: hospital.com
 * 3. Header: x-hospital-id or x-tenant-id
 * 4. Query Parameter: ?hospitalId=xxx
 * 5. User's JWT token contains hospitalId
 */

const tenantMiddleware = async (req, res, next) => {
    try {
        let hospital = null;
        let identifiedBy = null;

        const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;

        if (isDbConnected) {
            // Method 1: Extract from host header (subdomain or custom domain)
            const host = req.get('host')?.split(':')[0] || ''; // Remove port if exists
            
            // Check if it's a subdomain
            const subdomainMatch = host.match(/^([a-z0-9-]+)\.yourhospitalapp\.com$/i);
            if (subdomainMatch) {
                const subdomain = subdomainMatch[1];
                hospital = await Hospital.findOne({ subdomain });
                identifiedBy = 'subdomain';
            }

            // Method 2: Check for custom domain
            if (!hospital && host !== 'localhost' && host !== '127.0.0.1') {
                hospital = await Hospital.findOne({ customDomain: host });
                identifiedBy = 'customDomain';
            }

            // Method 3: Check x-hospital-id header
            if (!hospital && req.headers['x-hospital-id']) {
                hospital = await Hospital.findById(req.headers['x-hospital-id']);
                identifiedBy = 'header';
            }

            // Method 4: Check x-tenant-id header
            if (!hospital && req.headers['x-tenant-id']) {
                hospital = await Hospital.findById(req.headers['x-tenant-id']);
                identifiedBy = 'header';
            }

            // Method 5: Check query parameter
            if (!hospital && req.query.hospitalId) {
                hospital = await Hospital.findById(req.query.hospitalId);
                identifiedBy = 'query';
            }

            // Method 6: Extract from JWT token
            if (!hospital && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
                const token = req.headers.authorization.split(' ')[1];
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    if (decoded.hospitalId) {
                        hospital = await Hospital.findById(decoded.hospitalId);
                        identifiedBy = 'userHospital';
                    } else if (decoded.isSuperAdmin) {
                        hospital = null;
                        identifiedBy = 'superAdmin';
                    }
                } catch (e) {
                    // Ignore token errors here, let authMiddleware handle them
                }
            }
        }

        // Store tenant context in request
        req.tenant = {
            hospital,
            id: hospital?._id,
            slug: hospital?.slug,
            identifiedBy,
            isMultiTenant: true,
        };

        // Store user context
        if (req.user) {
            req.userContext = {
                id: req.user._id,
                isSuperAdmin: req.user.isSuperAdmin,
                hospitalId: req.user.hospitalId,
                role: req.user.role,
            };
        }

        next();
    } catch (error) {
        console.error('Tenant middleware error:', error);
        // Don't fail the request, just set empty tenant
        req.tenant = { hospital: null, isMultiTenant: true };
        next();
    }
};

/**
 * Require Tenant Middleware
 * Enforces that a tenant must be identified
 * Fails if no hospital context is found
 */
const requireTenant = (req, res, next) => {
    if (!req.tenant?.hospital && !req.userContext?.isSuperAdmin) {
        return res.status(400).json({
            error: 'Hospital context required',
            message: 'Please provide hospital identification (subdomain, custom domain, or header)',
        });
    }
    next();
};

/**
 * Tenant Data Filter Middleware
 * Automatically filters database queries to include tenantId
 * Applied to all operations within a hospital context
 */
const tenantDataFilter = (req, res, next) => {
    if (req.tenant?.hospital && !req.userContext?.isSuperAdmin) {
        // Store tenant ID for use in database queries
        req.tenantFilter = {
            hospitalId: req.tenant.hospital._id,
        };
    } else if (req.userContext?.isSuperAdmin) {
        // SuperAdmin can query across all tenants
        req.tenantFilter = null;
    }
    next();
};

/**
 * Tenant Authorization Middleware
 * Ensures user belongs to the identified hospital
 * Except for SuperAdmin users
 */
const authorizeTenant = (req, res, next) => {
    // SuperAdmin has access to everything
    if (req.userContext?.isSuperAdmin) {
        return next();
    }

    // Regular users must have hospitalId that matches tenant
    if (req.userContext?.hospitalId && req.tenant?.hospital) {
        if (req.userContext.hospitalId.toString() !== req.tenant.hospital._id.toString()) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You do not have access to this hospital',
            });
        }
    }

    next();
};

module.exports = {
    tenantMiddleware,
    requireTenant,
    tenantDataFilter,
    authorizeTenant,
};
