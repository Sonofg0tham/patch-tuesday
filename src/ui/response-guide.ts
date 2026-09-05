import type { Topology } from '../data/topology';
import type { PresentationView } from '../sim/telemetry';
import { SIM_CONFIG } from '../sim/config';
import type { SituationContext } from './situation';

export interface ResponseStep { title: string; explanation: string; node?: string }

/** Suggestions use public knowledge only, including when no threat is visible. */
export function nextResponseStep(view: PresentationView, topology: Topology, context: SituationContext & { ap: number }): ResponseStep {
  const nodes = topology.nodes;
  const infected = nodes.filter((node) => view.nodes[node.id]?.visibleState === 'infected');
  const backupsAvailable = context.backupCredits > 0 && nodes.some((node) => node.type === 'backup' && view.nodes[node.id]?.visibleState !== 'encrypted');
  const cleanOffline = nodes.find((node) => {
    const state = view.nodes[node.id];
    return state?.isolated && state.observed && (state.visibleState === 'clean' || state.visibleState === 'patched') &&
      !node.neighbours.some((id) => view.nodes[id]?.visibleState === 'infected' && !view.nodes[id]?.isolated);
  });
  if (context.ap === 0) return {
    title: context.phase === 'recovery' ? 'Ready for the next recovery hour?' : 'You have spent this hour\'s actions',
    explanation: context.phase === 'recovery' ? 'Advance recovery to get fresh action points, or File review to finish. Offline services still add downtime.'
      : `Choose End hour for ${SIM_CONFIG.apPerTurn} fresh action points. The ransomware also takes its turn. Emergency budget can buy extra actions once per incident.`,
  };
  if (context.phase === 'recovery') {
    const offline = nodes.find((node) => node.type !== 'workstation' && view.nodes[node.id]?.isolated);
    if (offline) return { title: 'Bring critical services back online', node: offline.id, explanation: `Select ${offline.label}, then Reconnect (1 AP). The threat is contained; leaving this service offline hurts the final review.` };
    const encrypted = nodes.find((node) => view.nodes[node.id]?.visibleState === 'encrypted');
    if (encrypted && backupsAvailable && context.ap >= 2) return { title: 'Recover a damaged machine', node: encrypted.id, explanation: `Select ${encrypted.label}, then Restore (2 AP and 1 backup). File review when you are ready to finish.` };
    return { title: 'Finish the incident', explanation: 'The ransomware has stopped. Choose File review to finish and see the damage, downtime and decisions recorded in your report.' };
  }
  if (context.pressure >= SIM_CONFIG.pressureMax * 0.8 && cleanOffline) return {
    title: 'Ease the pressure on the business', node: cleanOffline.id,
    explanation: `Inspect ${cleanOffline.label}, then consider Reconnect (1 AP). It has no visibly infected live neighbour, but uncovered machines remain uncertain.`,
  };
  const urgent = infected.find((node) => (view.nodes[node.id].turnsToEncryption ?? Infinity) <= 1);
  if (urgent && backupsAvailable && context.ap >= 2) return { title: 'Save a machine before it locks', node: urgent.id, explanation: `Select ${urgent.label}, then Restore (2 AP and 1 backup) to remove its infection. Isolation alone does not stop an infected machine encrypting.` };
  const connected = infected.find((node) => !view.nodes[node.id].isolated && node.neighbours.some((id) => !view.nodes[id]?.isolated && view.nodes[id]?.visibleState === 'clean'));
  if (connected) return { title: 'Stop this machine spreading ransomware', node: connected.id, explanation: `Select ${connected.label}, then Isolate (1 AP) to cut its cables. It stays infected and goes offline, so this buys time rather than curing it.` };
  if (infected.length && backupsAvailable && context.ap >= 2) return { title: 'Remove a known infection', node: infected[0].id, explanation: `Select ${infected[0].label}, then Restore (2 AP and 1 backup). Patch protects a clean machine; it cannot cure an infected one.` };
  const blind = nodes.find((node) => !view.nodes[node.id]?.observed);
  if (blind) return { title: 'Check a machine you cannot yet trust', node: blind.id, explanation: `Select ${blind.label}, then Deploy sensor (1 AP) to reveal its condition. A grey question mark means unmonitored, not confirmed clean.` };
  if (infected.length) return { title: 'Protect the machines still clean', explanation: 'Known infections remain. Patch a clean, connected machine for 2 AP to make it immune. Restore needs 2 AP and a surviving backup; use End hour when ready.' };
  return { title: 'Check whether you have stopped the attack', explanation: 'No active infection is visible. Choose Declare containment. A successful check opens recovery; if hidden infection remains, the hour advances and the response continues.' };
}

export function createResponseGuide(container: HTMLElement, onInspect: (id: string) => void): { render(step: ResponseStep, enabled: boolean): void; setEnabled(enabled: boolean): void } {
  const section = document.createElement('section');
  section.id = 'response-guide';
  section.setAttribute('aria-label', 'Suggested next step');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'guide-eyebrow';
  eyebrow.textContent = 'YOUR NEXT MOVE';
  const title = document.createElement('h2');
  const explanation = document.createElement('p');
  const inspect = document.createElement('button');
  inspect.type = 'button';
  let target: string | undefined;
  inspect.addEventListener('click', () => { if (target) onInspect(target); });
  section.append(eyebrow, title, explanation, inspect);
  const help = document.createElement('details');
  help.id = 'response-help';
  const summary = document.createElement('summary');
  summary.textContent = 'How do I win?';
  help.append(summary);
  for (const line of [
    'Your job: stop the ransomware, then get the company working again. Lose the Domain Controller or 60% of the estate to encryption and the incident is lost.',
    `Each hour: select a machine, spend up to ${SIM_CONFIG.apPerTurn} action points (AP), then End hour. Nothing advances while you are thinking. The ransomware spreads when you end the hour.`,
    'Isolate cuts cables but does not cure infection. Deploy sensor reveals a machine you cannot monitor. Patch makes a clean machine immune. Restore removes infection or encryption, using a backup credit.',
    'Once no infection is visible, Declare containment checks whether the attack has really stopped. Then Reconnect offline services, Restore what you can, and File review to finish.',
    'Cyan is defence, magenta is known compromise, amber is a warning. Look for the shape markers too: a question mark is unknown, a cross is infected, and a lock means encrypted.',
  ]) { const p = document.createElement('p'); p.textContent = line; help.append(p); }
  container.insertBefore(section, container.querySelector('#inspector'));
  container.append(help);
  return { setEnabled(enabled) { inspect.disabled = !enabled; }, render(step, enabled) {
    title.textContent = step.title;
    explanation.textContent = step.explanation;
    target = step.node;
    inspect.hidden = !target;
    inspect.disabled = !enabled;
    inspect.textContent = target ? `Inspect ${target}` : '';
  } };
}
