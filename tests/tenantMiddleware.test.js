const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { tenantMiddleware, tenantDataFilter, authorizeTenant } = require('../middleware/tenantMiddleware');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const NO_TENANT = '000000000000000000000000';

const token = (payload, secret = process.env.JWT_SECRET) => `Bearer ${jwt.sign(payload, secret)}`;

// Run the tenant middleware chain on a fake request (no database: hospital lookups are skipped)
const run = async (headers = {}, query = {}) => {
    const req = { headers, query, get: () => 'localhost' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await tenantMiddleware(req, res, () => {});
    tenantDataFilter(req, res, () => {});
    let authorized = false;
    authorizeTenant(req, res, () => { authorized = true; });
    return { filter: req.tenantFilter ? String(req.tenantFilter.hospitalId) : req.tenantFilter, authorized, userContext: req.userContext };
};

describe('tenant isolation', () => {
    const nurseA = token({ userId: 'u1', role: 'nurse', hospitalId: A });

    it('scopes a logged-in user to the hospital in their token', async () => {
        const r = await run({ authorization: nurseA });
        expect(r.filter).toBe(A);
        expect(r.authorized).toBe(true);
    });

    it.each([
        ['x-hospital-id header', { 'x-hospital-id': B }, {}],
        ['x-tenant-id header', { 'x-tenant-id': B }, {}],
        ['?hospitalId query', {}, { hospitalId: B }],
        ['malformed header', { 'x-hospital-id': 'not-an-id' }, {}],
    ])('ignores a client-supplied hospital via %s', async (_name, headers, query) => {
        const r = await run({ authorization: nurseA, ...headers }, query);
        expect(r.filter).toBe(A);
    });

    it('accepts tokens that embed the populated hospital object (issued before the login fix)', async () => {
        const legacy = token({ userId: 'u1', role: 'hospital_admin', hospitalId: { _id: A, name: 'Alpha' } });
        const r = await run({ authorization: legacy });
        expect(r.filter).toBe(A);
        expect(r.userContext.hospitalId).toBe(A);
        expect(r.authorized).toBe(true);
    });

    it('fails closed for a logged-in user without a hospital', async () => {
        const r = await run({ authorization: token({ userId: 'u2', role: 'patient' }) });
        expect(r.filter).toBe(NO_TENANT);
        expect(r.authorized).toBe(false);
    });

    it('lets a super admin pick a hospital, or see all when none is picked', async () => {
        const superAdmin = token({ userId: 'u3', role: 'super_admin', isSuperAdmin: true });
        expect((await run({ authorization: superAdmin, 'x-hospital-id': B })).filter).toBe(B);
        expect((await run({ authorization: superAdmin })).filter).toBeNull();
    });

    it('treats a forged token as anonymous', async () => {
        const forged = token({ userId: 'x', role: 'super_admin', isSuperAdmin: true }, 'wrong-secret');
        const r = await run({ authorization: forged, 'x-hospital-id': B });
        expect(r.userContext).toBeUndefined();
        expect(r.authorized).toBe(false);
    });

    it('uses the header for anonymous requests (registration/branding) but ignores malformed ids', async () => {
        expect((await run({ 'x-hospital-id': B })).filter).toBe(B);
        expect((await run({ 'x-hospital-id': '{"$ne":1}' })).filter).toBeUndefined();
    });
});
