import { buildPassengerProfile } from './helpers.js';

const ADULT_FIRST = ['Rohan', 'Arjun', 'Neil', 'Kabir', 'Vihaan', 'Ayaan', 'Dev', 'Yash', 'Ishaan', 'Kian'];
const ADULT_LAST = ['Bhagat', 'Malhotra', 'Khanna', 'Bajaj', 'Sethi', 'Kapoor', 'Mehra', 'Walia', 'Bedi', 'Grewal'];
const CHILD_FIRST = ['Aarohi', 'Diya', 'Anaya', 'Kabir', 'Vihaan', 'Myra', 'Ira', 'Zara'];
const CHILD_LAST = ['Malhotra', 'Khanna', 'Bajaj', 'Sethi', 'Kapoor', 'Mehra'];
const INFANT_FIRST = ['Aarav', 'Mira', 'Reyansh', 'Kiara'];
const INFANT_LAST = ['Malhotra', 'Khanna', 'Bajaj', 'Kapoor'];

export function uniqueTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function pick(list, index) {
  return list[index % list.length];
}

function passportFor(index, seed = Date.now()) {
  const base = String(seed + index * 17).slice(-7);
  return {
    number: `P${base}`,
    expiry: '2031-08-01',
    issuedDate: '2020-08-01',
    issuedCountryCode: 'IN',
  };
}

function paxRow(paxId, type, isLead, profile, { withPassport = false, passportIndex = 0, seed = Date.now() } = {}) {
  return {
    paxId,
    type,
    isLead,
    profile: {
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      dob: profile.dob,
      nationality: profile.nationality || 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: withPassport
      ? passportFor(passportIndex, seed)
      : { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  };
}

/**
 * Build issue-ticket passengers for any adult/child/infant mix.
 */
export function buildPassengers({
  adults = 1,
  children = 0,
  infants = 0,
  uniqueNames = true,
  leadFirstName = null,
  leadLastName = null,
  nameIndex = 0,
  withPassport = false,
} = {}) {
  if (infants > adults) {
    throw new Error(`Invalid pax: infants (${infants}) cannot exceed adults (${adults})`);
  }

  const tag = uniqueNames ? uniqueTag() : '';
  const seed = Date.now();
  const passengers = [];
  let paxNum = 0;

  for (let a = 0; a < adults; a += 1) {
    paxNum += 1;
    const isLead = a === 0;
    const firstName = isLead && leadFirstName
      ? leadFirstName
      : pick(ADULT_FIRST, nameIndex + a);
    const lastName = isLead && leadLastName
      ? `${leadLastName}${tag}`
      : `${pick(ADULT_LAST, nameIndex + a)}${tag}`;

    const profile = buildPassengerProfile({
      title: a === 0 ? 'Mr' : (a % 2 === 0 ? 'Mr' : 'Ms'),
      firstName,
      lastName,
      gender: a % 2 === 0 ? 'Male' : 'Female',
      dob: a === 0 ? '1988-05-12' : '1990-03-15',
    });

    passengers.push(paxRow(
      `PAX${paxNum}`,
      'adult',
      isLead,
      profile,
      { withPassport, passportIndex: paxNum - 1, seed },
    ));
  }

  for (let c = 0; c < children; c += 1) {
    paxNum += 1;
    const isMale = c % 2 !== 0;
    const profile = buildPassengerProfile({
      title: isMale ? 'Mstr' : 'Miss',
      firstName: pick(CHILD_FIRST, nameIndex + c),
      lastName: `${pick(CHILD_LAST, nameIndex + c)}${tag}`,
      gender: isMale ? 'Male' : 'Female',
      dob: '2017-09-08',
    });
    passengers.push(paxRow(`PAX${paxNum}`, 'child', false, profile, { withPassport, passportIndex: paxNum - 1, seed }));
  }

  for (let inf = 0; inf < infants; inf += 1) {
    paxNum += 1;
    const infantDob = new Date();
    infantDob.setMonth(infantDob.getMonth() - 6);
    const isMale = inf % 2 === 0;
    const profile = buildPassengerProfile({
      title: isMale ? 'Mstr' : 'Miss',
      firstName: pick(INFANT_FIRST, nameIndex + inf),
      lastName: `${pick(INFANT_LAST, nameIndex + inf)}${tag}`,
      gender: isMale ? 'Male' : 'Female',
      dob: infantDob.toISOString().slice(0, 10),
    });
    passengers.push(paxRow(`PAX${paxNum}`, 'infant', false, profile, { withPassport, passportIndex: paxNum - 1, seed }));
  }

  return passengers;
}
