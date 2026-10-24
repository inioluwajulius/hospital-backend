/**
 * ICE servers for telemedicine calls (native WebRTC; no calling platform or paid service).
 *
 * Media always flows directly between the doctor's and the patient's browsers. These
 * servers only help the two browsers find a route to each other:
 *
 * STUN  Tells each browser its public address so a direct connection can cross home or
 *       mobile routers. Default: Google's free public STUN servers. That is an EXTERNAL
 *       dependency (no account or key; it never sees audio or video). Change it with
 *       STUN_URLS (comma separated), or set STUN_URLS=none to use none at all, in which
 *       case calls only connect when both devices are on the same network.
 *
 * TURN  Optional relay for networks that block direct connections. Not required.
 *       Only a server you run yourself (e.g. coturn on a VPS) is supported here:
 *       TURN_URL (comma separated) + TURN_USERNAME + TURN_CREDENTIAL.
 */

const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

const stunUrls = () => {
    const configured = process.env.STUN_URLS;
    if (configured !== undefined && configured.trim().toLowerCase() === 'none') return [];
    return list(configured || DEFAULT_STUN);
};

/** @returns {{iceServers: object[], relay: boolean}} */
const getIceServers = () => {
    const iceServers = [];
    const stun = stunUrls();
    if (stun.length) iceServers.push({ urls: stun });
    const turn = list(process.env.TURN_URL);
    if (turn.length) {
        iceServers.push({ urls: turn, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
    return { iceServers, relay: turn.length > 0 };
};

/** One-line summary for startup logs (no secrets) */
const describeIceConfig = () => {
    const stun = stunUrls();
    const stunPart = !stun.length
        ? 'no STUN (same-network calls only)'
        : process.env.STUN_URLS ? `STUN ${stun.join(', ')}` : 'STUN via Google\'s free public servers (external; change with STUN_URLS)';
    const turnPart = list(process.env.TURN_URL).length ? 'self-hosted TURN relay' : 'no TURN relay (strict networks may block calls)';
    return `Calls: native WebRTC peer-to-peer, ${stunPart}, ${turnPart}`;
};

module.exports = { getIceServers, describeIceConfig };
