const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Hospital = require('../models/Hospital');

// Matches no document. Used so that an authenticated user without a hospital
// gets an empty result instead of an unfiltered query.
const NO_TENANT = new mongoose.Types.ObjectId('000000000000000000000000');

/**
 * Decode the Bearer token if present and valid. Invalid tokens are ignored here;
 * authMiddleware rejects them on protected routes.
 */
const decodeToken = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || !process.env.JWT_SECRET) {
        return null;
    }
    try {
        return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    } catch {
        return null;
    }
};

/**
 * Hospital id requested by the client via header or query. Only honoured for
 * anonymous requests (registration, branding) and super admins.
 */
const getRequestedHospitalId = (req) => {
    const id = req.headers['x-hospital-id'] || req.headers['x-tenant-id'] || req.query?.hospitalId;
    return typeof id === 'string' && mongoose.isValidObjectId(id) ? id : null;
};

/**
 * Tenant Context Middleware
 * Sets req.userContext (from the JWT) and req.tenant (the hospital in scope).
 *
 * For authenticated non-super-admin users the hospital always comes from their
 * signed token; client-supplied headers/query params cannot change it.
 * Anonymous requests and super admins may select a hospital via
 * x-hospital-id / x-tenant-id header, ?hospitalId, subdomain or custom domain.
 */
const tenantMiddleware = async (req, res, next) => {
    const decoded = decodeToken(req);

    if (decoded) {
        req.userContext = {
            id: decoded.userId,
            isSuperAdmin: !!decoded.isSuperAdmin,
            hospitalId: decoded.hospitalId || null,
            role: decoded.role,
        };
    }

    let hospitalId = null;
    let identifiedBy = null;

    if (decoded && !decoded.isSuperAdmin) {
        hospitalId = decoded.hospitalId || null;
        identifiedBy = 'userHospital';
    } else {
        hospitalId = getRequestedHospitalId(req);
        identifiedBy = hospitalId ? 'header' : null;
    }

    let hospital = null;
    const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;

    if (isDbConnected) {
        try {
            if (hospitalId) {
                hospital = await Hospital.findById(hospitalId);
            } else if (!decoded) {
                const host = req.get('host')?.split(':')[0] || '';
                const subdomainMatch = host.match(/^([a-z0-9-]+)\.yourhospitalapp\.com$/i);
                if (subdomainMatch) {
                    hospital = await Hospital.findOne({ subdomain: subdomainMatch[1] });
                    identifiedBy = 'subdomain';
                } else if (host !== 'localhost' && host !== '127.0.0.1') {
                    hospital = await Hospital.findOne({ customDomain: host });
                    identifiedBy = 'customDomain';
                }
            }
        } catch (error) {
            console.error('Tenant middleware error:', error);
        }
    }

    req.tenant = {
        hospital,
        id: hospital?._id || hospitalId || undefined,
        slug: hospital?.slug,
        identifiedBy,
        isMultiTenant: true,
    };

    next();
};

/**
 * Require Tenant Middleware
 * Enforces that a tenant must be identified
 * Fails if no hospital context is found
 */
const requireTenant = (req, res, next) => {
    if (!req.tenant?.id && !req.userContext?.isSuperAdmin) {
        return res.status(400).json({
            error: 'Hospital context required',
            message: 'Please provide hospital identification (subdomain, custom domain, or header)',
        });
    }
    next();
};

/**
 * Tenant Data Filter Middleware
 * Sets req.tenantFilter, which controllers merge into their queries.
 * Authenticated non-super-admins are always scoped to their own hospital.
 */
const tenantDataFilter = (req, res, next) => {
    const ctx = req.userContext;

    if (ctx?.isSuperAdmin) {
        // SuperAdmin queries across all tenants unless a hospital was selected
        req.tenantFilter = req.tenant?.id ? { hospitalId: req.tenant.id } : null;
    } else if (ctx) {
        req.tenantFilter = { hospitalId: ctx.hospitalId || NO_TENANT };
    } else if (req.tenant?.id) {
        req.tenantFilter = { hospitalId: req.tenant.id };
    }
    next();
};

/**
 * Tenant Authorization Middleware
 * Ensures user belongs to the identified hospital and that it is active.
 * Except for SuperAdmin users
 */
const authorizeTenant = (req, res, next) => {
    // SuperAdmin has access to everything
    if (req.userContext?.isSuperAdmin) {
        return next();
    }

    if (!req.userContext?.hospitalId) {
        return res.status(403).json({
            error: 'Unauthorized',
            message: 'You do not have access to this hospital',
        });
    }

    if (req.tenant?.id && req.userContext.hospitalId.toString() !== req.tenant.id.toString()) {
        return res.status(403).json({
            error: 'Unauthorized',
            message: 'You do not have access to this hospital',
        });
    }

    if (req.tenant?.hospital && req.tenant.hospital.status !== 'active') {
        return res.status(403).json({
            error: 'Hospital inactive',
            message: 'This hospital account is not active',
        });
    }

    next();
};

module.exports = {
    tenantMiddleware,
    requireTenant,
    tenantDataFilter,
    authorizeTenant,
};
