import fs from 'fs';
import path from 'path';
import { config } from '../../../shared/config/env.js';
import { FLIGHT_QUERY } from './helpers.js';

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: { ...FLIGHT_QUERY },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

export async function getBookingSummary(flight, br) {
  const status = await flight.getBookingStatus(br);
  const detail = await flight.getBookingDetail(br);
  const brsp = detail.data?.bookingResponse || {};
  const itinerary = brsp.itinerary || [];
  const legs = itinerary.map((leg) => ({
    pnr: leg.pnr,
    onlineCancellation: leg.onlineCancellation,
    airline: leg.segments?.[0]?.airlineCode || leg.segments?.[0]?.airline?.code,
    flight: leg.segments?.map((s) => `${s.airlineCode || s.airline?.code} ${s.flightNumber}`).join(' / '),
    cancellationPolicies: leg.cancellationPolicies ?? null,
  }));

  return {
    br,
    baseUrl: config.baseUrl,
    status: status.data?.status || status.data,
    totalAmount: brsp.salesSummary?.totalAmount,
    userId: brsp.userId,
    legs,
    passengers: (brsp.passengers || []).map((p) => ({
      name: `${p.firstName || p.profile?.firstName} ${p.lastName || p.profile?.lastName}`,
      type: p.type || p.passengerType,
    })),
    rawStatus: status.data,
    rawDetail: detail.data,
  };
}

export async function runCancelFlow(flight, client, { br, action = 'PENALTY', after = [] }) {
  if (!br) throw new Error('--br is required');

  const summary = await getBookingSummary(flight, br);
  const pnr = summary.legs?.[0]?.pnr;
  console.log('fixture', JSON.stringify(summary, null, 2));

  const steps = [];
  const runSteps = after.length ? after : [String(action).toLowerCase()];

  let penalty = null;
  let cancel = null;

  if (runSteps.includes('penalty')) {
    const penReq = {
      action: 'PENALTY',
      ...(pnr ? { pnr } : {}),
      cancellationReason: 'CLI penalty check',
    };
    console.log('\n=== PENALTY request', JSON.stringify(penReq));
    penalty = await cancelCall(client, br, penReq);
    console.log('=== PENALTY response', JSON.stringify(penalty.data, null, 2));
    steps.push({ step: 'PENALTY', request: penReq, response: penalty.data, status: penalty.status });
  }

  if (runSteps.includes('cancel')) {
    const canReq = {
      action: 'CANCEL',
      ...(pnr ? { pnr } : {}),
      cancellationReason: 'CLI cancel',
      remarks: 'requested by partner',
    };
    console.log('\n=== CANCEL request', JSON.stringify(canReq));
    cancel = await cancelCall(client, br, canReq);
    console.log('=== CANCEL response', JSON.stringify(cancel.data, null, 2));
    steps.push({ step: 'CANCEL', request: canReq, response: cancel.data, status: cancel.status });
  }

  const afterStatus = await flight.getBookingStatus(br);
  const reportPath = path.join('reports', `cli-cancel-${br}.json`);
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    br,
    before: summary,
    steps,
    afterStatus: afterStatus.data,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\nReport:', reportPath);

  return { summary, penalty, cancel, report, reportPath };
}

export async function printBookingStatus(flight, br) {
  const summary = await getBookingSummary(flight, br);
  const reportPath = path.join('reports', `cli-status-${br}.json`);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nReport:', reportPath);
  return summary;
}
