import { describe, expect, it } from 'vitest';
import { makeGameState, makeTopology } from '../sim/fixtures';
import { toPresentationView } from '../sim/telemetry';
import { nextResponseStep } from './response-guide';

describe('plain-English response guidance', () => {
  const context = { phase: 'active' as const, pressure: 0, backupCredits: 3, ap: 2 };
  it('names a visible spread source and explains the limit of isolation', () => {
    const topology = makeTopology([{ id: 'SOURCE', edr: true }, { id: 'TARGET', edr: true }], [['SOURCE', 'TARGET']]);
    const view = toPresentationView(makeGameState({ SOURCE: { state: 'infected', infectedTurns: 2 }, TARGET: { state: 'clean', infectedTurns: 0 } }), topology);
    const step = nextResponseStep(view, topology, context);
    expect(step.node).toBe('SOURCE');
    expect(step.explanation).toContain('Isolate (1 AP)');
    expect(step.explanation).toContain('stays infected');
  });
  it('recommends exactly the same blind spot for hidden infection and clean state', () => {
    const topology = makeTopology([{ id: 'BLIND', edr: false }], []);
    const project = (state: 'infected' | 'clean') => toPresentationView(makeGameState({ BLIND: { state, infectedTurns: 5 } }), topology);
    const clean = nextResponseStep(project('clean'), topology, context);
    expect(nextResponseStep(project('infected'), topology, context)).toEqual(clean);
    expect(clean.node).toBe('BLIND');
    expect(clean.explanation).toContain('Deploy sensor');
  });
  it('does not recommend an unaffordable restore or one without a surviving backup', () => {
    const topology = makeTopology([{ id: 'SOURCE', edr: true }, { id: 'BACKUP', type: 'backup', edr: true }], []);
    const view = toPresentationView(makeGameState({ SOURCE: { state: 'infected', infectedTurns: 6 }, BACKUP: { state: 'clean', infectedTurns: 0 } }), topology);
    expect(nextResponseStep(view, topology, context).node).toBe('SOURCE');
    expect(nextResponseStep(view, topology, { ...context, ap: 1 }).node).toBeUndefined();
    view.nodes.BACKUP.visibleState = 'encrypted';
    expect(nextResponseStep(view, topology, context).node).toBeUndefined();
  });
  it('explains the hour boundary and finishing recovery', () => {
    const topology = makeTopology([{ id: 'CLEAN', edr: true }], []);
    const view = toPresentationView(makeGameState({ CLEAN: { state: 'clean', infectedTurns: 0 } }), topology);
    expect(nextResponseStep(view, topology, { ...context, ap: 0 }).explanation).toContain('ransomware also takes its turn');
    expect(nextResponseStep(view, topology, context).explanation).toContain('Declare containment');
    expect(nextResponseStep(view, topology, { ...context, phase: 'recovery' }).explanation).toContain('File review');
  });
});
