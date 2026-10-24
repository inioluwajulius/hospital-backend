// utils/iceServers.js: native WebRTC, no calling platform or provider API
const KEYS = ['STUN_URLS', 'TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL'];
const saved = {};
const load = () => { jest.resetModules(); return require('../utils/iceServers'); };
const urlsOf = (servers) => servers.flatMap((s) => s.urls);

describe('ICE servers', () => {
    beforeEach(() => {
        KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
        global.fetch = jest.fn();
    });
    afterEach(() => {
        KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    });

    it('defaults to free public STUN only, with no relay and no network calls to any provider', () => {
        const { getIceServers, describeIceConfig } = load();
        const result = getIceServers();
        expect(result.relay).toBe(false);
        expect(urlsOf(result.iceServers)).toEqual(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(describeIceConfig()).toMatch(/native WebRTC.*Google's free public servers \(external/);
    });

    it('uses your own STUN servers when configured', () => {
        process.env.STUN_URLS = 'stun:stun.myclinic.org:3478';
        expect(urlsOf(load().getIceServers().iceServers)).toEqual(['stun:stun.myclinic.org:3478']);
    });

    it('can run with no external STUN at all', () => {
        process.env.STUN_URLS = 'none';
        const { getIceServers, describeIceConfig } = load();
        expect(getIceServers().iceServers).toEqual([]);
        expect(describeIceConfig()).toMatch(/no STUN/);
    });

    it('adds a self-hosted TURN relay when configured', () => {
        Object.assign(process.env, { TURN_URL: 'turn:turn.myclinic.org:3478, turns:turn.myclinic.org:5349', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'secret-cred' });
        const { getIceServers, describeIceConfig } = load();
        const result = getIceServers();
        expect(result.relay).toBe(true);
        expect(result.iceServers[1]).toEqual({ urls: ['turn:turn.myclinic.org:3478', 'turns:turn.myclinic.org:5349'], username: 'u', credential: 'secret-cred' });
        expect(describeIceConfig()).not.toContain('secret-cred'); // no credentials in logs
        expect(describeIceConfig()).toMatch(/self-hosted TURN/);
    });
});
