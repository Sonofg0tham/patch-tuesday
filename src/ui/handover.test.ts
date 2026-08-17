import { describe, expect, it } from 'vitest';
import { planHandover, type HandoverModel } from './handover';

const handover: HandoverModel = {
  estate: 'MERIDIAN MUTUAL // HQ ESTATE',
  alert: 'Ransomware indicators confirmed across the HQ estate.',
  priorities: ['Establish trustworthy visibility.', 'Protect critical services.'],
  monitoredPercent: 58,
  apPerHour: 2,
  backupCredits: 3,
  lossConditions: ['Domain Controller encryption', '60% estate encryption'],
};

const completeCopy = [
  '03:12 // INCIDENT HANDOVER',
  'MERIDIAN MUTUAL // HQ ESTATE',
  'ALERT: Ransomware indicators confirmed across the HQ estate.',
  'MONITORED ESTATE: 58%',
  'CAPACITY: 2 AP PER HOUR',
  'RECOVERY: 3 BACKUP CREDITS',
  'LOSS CONDITION: Domain Controller encryption',
  'LOSS CONDITION: 60% estate encryption',
  'PRIORITY 1: Establish trustworthy visibility.',
  'PRIORITY 2: Protect critical services.',
];

describe('incident handover plan', () => {
  it('presents every line immediately under reduced motion without scheduling steps', () => {
    const plan = planHandover(handover, { reducedMotion: true });

    expect(plan.immediateLines).toEqual(completeCopy);
    expect(plan.stagedSteps).toEqual([]);
    expect(plan.requestsCamera).toBe(false);
  });

  it('stages the complete copy in order during normal motion', () => {
    const plan = planHandover(handover, { reducedMotion: false });

    expect(plan.immediateLines).toEqual([]);
    expect(plan.stagedSteps.map((step) => step.line)).toEqual(completeCopy);
    expect(plan.stagedSteps.map((step) => step.delayMs)).toEqual([
      0, 180, 360, 540, 720, 900, 1080, 1260, 1440, 1620,
    ]);
    expect(plan.requestsCamera).toBe(true);
  });
});
