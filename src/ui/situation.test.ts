import { describe, expect, it } from 'vitest';
import { makeGameState, makeTopology } from '../sim/fixtures';
import { toPresentationView, type PresentationView } from '../sim/telemetry';
import { ACTION_CATALOGUE } from './actions';
import {
  OBJECTIVES,
  deriveActionConsequences,
  deriveNodeInspectionModel,
  deriveObjective,
  type SituationContext,
} from './situation';

const active = (overrides: Partial<SituationContext> = {}): SituationContext => ({
  phase: 'active',
  pressure: 0,
  backupCredits: 3,
  ...overrides,
});

const recovery = (overrides: Partial<SituationContext> = {}): SituationContext => ({
  phase: 'recovery',
  pressure: 0,
  backupCredits: 3,
  ...overrides,
});

describe('the visible-information objective', () => {
  it('prioritises imminent known encryption over pressure and a visible route', () => {
    const topology = makeTopology(
      [
        { id: 'SOURCE', edr: true },
        { id: 'TARGET', edr: true },
      ],
      [['SOURCE', 'TARGET']],
    );
    const view = toPresentationView(
      makeGameState({
        SOURCE: { state: 'infected', infectedTurns: 6 },
        TARGET: { state: 'clean', infectedTurns: 0 },
      }),
      topology,
    );

    expect(deriveObjective(view, topology, active({ pressure: 80 }))).toBe(
      OBJECTIVES.preventEncryption,
    );
    expect(OBJECTIVES.preventEncryption).toBe('Prevent known encryption');
  });

  it('relieves business pressure at 80 percent before breaking a visible route', () => {
    const topology = makeTopology(
      [
        { id: 'SOURCE', edr: true },
        { id: 'TARGET', edr: true },
      ],
      [['SOURCE', 'TARGET']],
    );
    const view = toPresentationView(
      makeGameState({
        SOURCE: { state: 'infected', infectedTurns: 2 },
        TARGET: { state: 'clean', infectedTurns: 0 },
      }),
      topology,
    );

    expect(deriveObjective(view, topology, active({ pressure: 80 }))).toBe(
      'Relieve business pressure',
    );
    expect(deriveObjective(view, topology, active({ pressure: 79 }))).toBe(
      'Break a known propagation route',
    );
  });

  it('verifies blind spots before declaring a visibly clear estate contained', () => {
    const topology = makeTopology(
      [
        { id: 'OBSERVED', edr: true },
        { id: 'BLIND', edr: false },
      ],
      [],
    );
    const state = makeGameState({
      OBSERVED: { state: 'clean', infectedTurns: 0 },
      BLIND: { state: 'clean', infectedTurns: 0 },
    });
    const blindView = toPresentationView(state, topology);

    expect(deriveObjective(blindView, topology, active())).toBe(
      'Verify containment across blind spots',
    );

    const observedView: PresentationView = {
      nodes: Object.fromEntries(
        Object.entries(blindView.nodes).map(([id, node]) => [id, { ...node, observed: true }]),
      ),
    };
    expect(deriveObjective(observedView, topology, active())).toBe('Declare containment');
  });

  it('prioritises critical recovery, then restorable loss, then filing the review', () => {
    const topology = makeTopology(
      [
        { id: 'DC', type: 'domain-controller', edr: true },
        { id: 'SERVER', type: 'server', edr: true },
        { id: 'BACKUP', type: 'backup', edr: true },
      ],
      [],
    );
    const critical = toPresentationView(
      makeGameState({
        DC: { state: 'clean', infectedTurns: 0, isolated: true, isolationAge: 2 },
        SERVER: { state: 'encrypted', infectedTurns: 7 },
        BACKUP: { state: 'clean', infectedTurns: 0 },
      }),
      topology,
    );
    expect(deriveObjective(critical, topology, recovery())).toBe(
      'Recover isolated critical services',
    );

    const loss: PresentationView = {
      nodes: {
        ...critical.nodes,
        DC: { ...critical.nodes.DC, isolated: false },
      },
    };
    expect(deriveObjective(loss, topology, recovery())).toBe('Restore encrypted assets');
    expect(deriveObjective(loss, topology, recovery({ backupCredits: 0 }))).toBe(
      'File the Post-Incident Review',
    );

    const ready: PresentationView = {
      nodes: {
        ...loss.nodes,
        SERVER: { ...loss.nodes.SERVER, visibleState: 'clean' as const },
      },
    };
    expect(deriveObjective(ready, topology, recovery())).toBe('File the Post-Incident Review');
  });

  it('files the review when encrypted loss exists but the estate has no backup node', () => {
    const topology = makeTopology([{ id: 'SERVER', type: 'server', edr: true }], []);
    const view = toPresentationView(
      makeGameState({ SERVER: { state: 'encrypted', infectedTurns: 7 } }),
      topology,
    );

    expect(deriveObjective(view, topology, recovery({ backupCredits: 3 }))).toBe(
      'File the Post-Incident Review',
    );
  });
});

describe('fog-safe action consequences', () => {
  it('exports the visible action catalogue', () => {
    expect(ACTION_CATALOGUE.map(({ kind }) => kind)).toEqual([
      'scan',
      'isolate',
      'reconnect',
      'patch',
      'restore',
      'emergency',
    ]);
  });

  it('reports only public costs, links, pressure, impact, backups and known urgency', () => {
    const topology = makeTopology(
      [
        { id: 'SERVER', type: 'server', edr: true },
        { id: 'A' },
        { id: 'B' },
      ],
      [
        ['SERVER', 'A'],
        ['SERVER', 'B'],
      ],
    );
    const view = toPresentationView(
      makeGameState({
        SERVER: { state: 'infected', infectedTurns: 6 },
        A: { state: 'clean', infectedTurns: 0 },
        B: { state: 'clean', infectedTurns: 0 },
      }),
      topology,
    );

    const result = deriveActionConsequences('SERVER', view, topology);
    const isolate = result.actions.find(({ action }) => action === 'isolate');
    const restore = result.actions.find(({ action }) => action === 'restore');

    expect(result.statusText).toBe('Status: INFECTED');
    expect(result.knownEncryptionInHours).toBe(1);
    expect(isolate).toMatchObject({
      apCost: 1,
      cutLinks: 2,
      pressurePerHour: 12,
      impactPerHour: 6,
    });
    expect(restore).toMatchObject({ apCost: 2, backupCost: 1 });
  });

  it('gives identical uncertain guidance for hidden infection and real clean state', () => {
    const topology = makeTopology([{ id: 'BLIND', edr: false }], []);
    const hidden = toPresentationView(
      makeGameState({ BLIND: { state: 'infected', infectedTurns: 6 } }),
      topology,
    );
    const clean = toPresentationView(
      makeGameState({ BLIND: { state: 'clean', infectedTurns: 0 } }),
      topology,
    );

    const hiddenResult = deriveActionConsequences('BLIND', hidden, topology);
    const cleanResult = deriveActionConsequences('BLIND', clean, topology);

    expect(hiddenResult).toEqual(cleanResult);
    expect(hiddenResult.statusText).toBe('Status uncertain. No sensor coverage.');
    expect(JSON.stringify(hiddenResult)).not.toMatch(/infected|6/);
  });

  it('builds a single inspector model instead of positional state arguments', () => {
    const topology = makeTopology(
      [
        { id: 'ROUTER', type: 'router', edr: false },
        { id: 'PEER', edr: true },
      ],
      [['ROUTER', 'PEER']],
    );
    const view = toPresentationView(
      makeGameState({
        ROUTER: { state: 'clean', infectedTurns: 0, revealed: true, isolated: true, isolationAge: 3 },
        PEER: { state: 'clean', infectedTurns: 0 },
      }),
      topology,
    );

    expect(deriveNodeInspectionModel('ROUTER', view, topology)).toMatchObject({
      id: 'ROUTER',
      label: 'ROUTER',
      type: 'router',
      role: 'test node',
      visibleState: 'clean',
      observed: true,
      isolated: true,
      isolationAge: 3,
      coverage: 'sensor',
      connectionLabels: ['PEER'],
    });
    expect(deriveNodeInspectionModel(null, view, topology)).toBeNull();
  });
});
