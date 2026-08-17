import { describe, expect, it } from 'vitest';
import { makeGameState, makeTopology } from './fixtures';
import { projectTurnEvents, toPresentationView } from './telemetry';
import type { TurnEvent } from './types';

describe('fog-safe incident telemetry', () => {
  it('groups hidden attempts without exposing source, target, success or side', () => {
    const topology = makeTopology(
      [
        { id: 'LEFT-HIDDEN', edr: false },
        { id: 'RIGHT-HIDDEN', edr: false },
      ],
      [['LEFT-HIDDEN', 'RIGHT-HIDDEN']],
    );
    const before = makeGameState({
      'LEFT-HIDDEN': { state: 'infected', infectedTurns: 2 },
      'RIGHT-HIDDEN': { state: 'clean', infectedTurns: 0 },
    });
    const after = makeGameState({
      'LEFT-HIDDEN': { state: 'infected', infectedTurns: 3 },
      'RIGHT-HIDDEN': { state: 'infected', infectedTurns: 0 },
    });

    const projected = projectTurnEvents(
      [
        {
          kind: 'spread-attempt',
          source: 'LEFT-HIDDEN',
          target: 'RIGHT-HIDDEN',
          roll: 0.1,
          success: true,
        },
        { kind: 'infected', node: 'RIGHT-HIDDEN' },
      ],
      before,
      after,
      topology,
    );

    expect(projected).toEqual([{ kind: 'telemetry-gap', attempts: 1 }]);
    expect(JSON.stringify(projected)).not.toMatch(/LEFT|RIGHT|0\.1|success/);
  });

  it('uses the real route only when both endpoints were observed at resolution start', () => {
    const topology = makeTopology(
      [
        { id: 'EDR-A', edr: true },
        { id: 'EDR-B', edr: true },
      ],
      [['EDR-A', 'EDR-B']],
    );
    const before = makeGameState({
      'EDR-A': { state: 'infected', infectedTurns: 2 },
      'EDR-B': { state: 'clean', infectedTurns: 0 },
    });
    const after = makeGameState({
      'EDR-A': { state: 'infected', infectedTurns: 3 },
      'EDR-B': { state: 'infected', infectedTurns: 0 },
    });
    const visibleAttempt: TurnEvent = {
      kind: 'spread-attempt',
      source: 'EDR-A',
      target: 'EDR-B',
      roll: 0.01,
      success: true,
    };

    expect(projectTurnEvents([visibleAttempt], before, after, topology)).toEqual([
      { kind: 'attempt', source: 'EDR-A', target: 'EDR-B', success: true },
    ]);
  });

  it('does not localise a route when only one endpoint was observed', () => {
    const topology = makeTopology(
      [
        { id: 'KNOWN-TARGET', edr: true },
        { id: 'SECRET-SOURCE', edr: false },
      ],
      [['KNOWN-TARGET', 'SECRET-SOURCE']],
    );
    const before = makeGameState({
      'KNOWN-TARGET': { state: 'clean', infectedTurns: 0 },
      'SECRET-SOURCE': { state: 'infected', infectedTurns: 2 },
    });
    const after = makeGameState({
      'KNOWN-TARGET': { state: 'infected', infectedTurns: 0 },
      'SECRET-SOURCE': { state: 'infected', infectedTurns: 3 },
    });

    const projected = projectTurnEvents(
      [
        {
          kind: 'spread-attempt',
          source: 'SECRET-SOURCE',
          target: 'KNOWN-TARGET',
          roll: 0.2,
          success: true,
        },
        { kind: 'infected', node: 'KNOWN-TARGET' },
      ],
      before,
      after,
      topology,
    );

    expect(projected).toEqual([
      { kind: 'telemetry-gap', attempts: 1 },
      { kind: 'infected', node: 'KNOWN-TARGET' },
    ]);
    expect(JSON.stringify(projected)).not.toContain('SECRET-SOURCE');
  });

  it('aggregates every hidden attempt into one gap at its first event position', () => {
    const topology = makeTopology(
      [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
        { id: 'PUBLIC', edr: true },
      ],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const before = makeGameState({
      A: { state: 'infected', infectedTurns: 1 },
      B: { state: 'clean', infectedTurns: 0 },
      C: { state: 'clean', infectedTurns: 0 },
      PUBLIC: { state: 'clean', infectedTurns: 0 },
    });
    const after = makeGameState({
      A: { state: 'infected', infectedTurns: 2 },
      B: { state: 'infected', infectedTurns: 0 },
      C: { state: 'infected', infectedTurns: 0 },
      PUBLIC: { state: 'encrypted', infectedTurns: 7 },
    });

    const projected = projectTurnEvents(
      [
        { kind: 'spread-attempt', source: 'A', target: 'B', roll: 0.1, success: true },
        { kind: 'infected', node: 'B' },
        { kind: 'encrypted', node: 'PUBLIC' },
        { kind: 'spread-attempt', source: 'B', target: 'C', roll: 0.2, success: true },
        { kind: 'infected', node: 'C' },
      ],
      before,
      after,
      topology,
    );

    expect(projected).toEqual([
      { kind: 'telemetry-gap', attempts: 2 },
      { kind: 'encrypted', node: 'PUBLIC' },
    ]);
  });

  it('keeps public consequences observable and strips patient-zero truth', () => {
    const topology = makeTopology([{ id: 'A' }], []);
    const state = makeGameState({ A: { state: 'clean', infectedTurns: 0 } });
    const events: TurnEvent[] = [
      { kind: 'patient-zero', node: 'A' },
      { kind: 'action', action: 'isolate', node: 'A', outcome: 'applied', apSpent: 1 },
      { kind: 'encrypted', node: 'A' },
      { kind: 'override', node: 'A' },
      { kind: 'containment-declaration', confirmed: false },
      { kind: 'recovery-hour' },
      { kind: 'review-filed' },
    ];

    expect(projectTurnEvents(events, state, state, topology)).toEqual(events.slice(1));
  });

  it('allowlists public action and declaration fields instead of spreading private metadata', () => {
    const topology = makeTopology([{ id: 'PUBLIC-NODE' }], []);
    const state = makeGameState({ PUBLIC: { state: 'clean', infectedTurns: 0 } });
    const action = {
      kind: 'action',
      action: 'patch',
      node: 'PUBLIC-NODE',
      outcome: 'blocked',
      apSpent: 0,
      reason: 'approved public reason',
      secretNode: 'HIDDEN-FOOTHOLD',
      roll: 0.123,
      privateReason: 'secret operator note',
    } as const;
    const declaration = {
      kind: 'containment-declaration',
      confirmed: false,
      secretNode: 'HIDDEN-FOOTHOLD',
      roll: 0.456,
      privateReason: 'secret declaration evidence',
    } as const;

    const projected = projectTurnEvents([action, declaration], state, state, topology);

    expect(projected).toEqual([
      {
        kind: 'action',
        action: 'patch',
        node: 'PUBLIC-NODE',
        outcome: 'blocked',
        apSpent: 0,
        reason: 'approved public reason',
      },
      { kind: 'containment-declaration', confirmed: false },
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/HIDDEN|0\.123|0\.456|private|secret operator/);
  });

  it('projects hidden infection as uncertain clean while preserving public operations', () => {
    const topology = makeTopology(
      [
        { id: 'BUILT-IN', edr: true },
        { id: 'BLIND' },
        { id: 'SENSOR' },
        { id: 'PATCHED' },
        { id: 'LOCKED' },
      ],
      [],
    );
    const state = makeGameState({
      'BUILT-IN': { state: 'infected', infectedTurns: 6 },
      BLIND: { state: 'infected', infectedTurns: 6, isolated: true, isolationAge: 4 },
      SENSOR: { state: 'clean', infectedTurns: 0, revealed: true },
      PATCHED: { state: 'patched', infectedTurns: 0 },
      LOCKED: { state: 'encrypted', infectedTurns: 7 },
    });

    const view = toPresentationView(state, topology);

    expect(view.nodes['BUILT-IN']).toMatchObject({
      visibleState: 'infected',
      observed: true,
      edr: true,
      turnsToEncryption: 1,
    });
    expect(view.nodes.BLIND).toEqual({
      id: 'BLIND',
      visibleState: 'clean',
      observed: false,
      isolated: true,
      isolationAge: 4,
      edr: false,
    });
    expect(view.nodes.SENSOR).toMatchObject({ observed: true, edr: true });
    expect(view.nodes.PATCHED).toMatchObject({ visibleState: 'patched', observed: true, edr: false });
    expect(view.nodes.LOCKED).toMatchObject({ visibleState: 'encrypted', observed: true, edr: false });
    expect(JSON.stringify(view.nodes.BLIND)).not.toMatch(/infected|6/);
  });
});
