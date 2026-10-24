const Appointment = require('../models/Appointment');
const User = require('../models/User');

/**
 * Booking rules shared by every way of creating or moving an appointment:
 * - the doctor's weekly availability (clinic local time, CLINIC_TIMEZONE),
 * - no two active appointments for the same doctor within SLOT_MINUTES.
 */

const SLOT_MINUTES = 30;
const CLINIC_TIMEZONE = () => process.env.CLINIC_TIMEZONE || 'Africa/Lagos';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekday (0-6) and "HH:mm" of a date in the clinic's time zone */
const clinicTime = (date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: CLINIC_TIMEZONE(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day, time: `${get('hour')}:${get('minute')}` };
};

const describeAvailability = (availability = []) =>
    availability.map((s) => `${DAY_NAMES[s.day]} ${s.start}-${s.end}`).join(', ');

/**
 * @returns {Promise<string|null>} an error message, or null if the slot can be booked
 */
const checkSlot = async ({ doctorId, appointmentDate, isUrgent = false, excludeAppointmentId }) => {
    const when = new Date(appointmentDate);
    if (Number.isNaN(when.getTime())) return 'Please choose a valid date and time';

    const doctor = await User.findById(doctorId).select('name availability');
    if (!doctor) return 'Doctor not found';

    // Urgent cases can be squeezed in outside regular hours
    if (!isUrgent && doctor.availability?.length) {
        const { day, time } = clinicTime(when);
        const fits = doctor.availability.some((s) => s.day === day && time >= s.start && time < s.end);
        if (!fits) {
            return `Dr. ${String(doctor.name || '').replace(/^Dr\.?\s*/i, '')} is not available at that time. Available: ${describeAvailability(doctor.availability)}.`;
        }
    }

    const windowMs = SLOT_MINUTES * 60 * 1000;
    const clash = await Appointment.findOne({
        doctorId,
        status: { $in: ['scheduled', 'in-progress'] },
        appointmentDate: { $gt: new Date(when.getTime() - windowMs), $lt: new Date(when.getTime() + windowMs) },
        ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
    }).select('_id');
    if (clash) return 'That time slot is already booked for this doctor. Please choose another time.';

    return null;
};

module.exports = { SLOT_MINUTES, checkSlot, clinicTime, describeAvailability };
