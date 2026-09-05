import * as THREE from 'three';
import { COMPANY, EQUIPMENT } from '../config/company';
import type { Topology } from '../data/topology';
import type { ObservableTurnEvent } from '../sim/telemetry';
import { boardSafeArea } from '../render/scene';

export interface AssetNotice { node: string; text: string; tone: 'defence' | 'threat' | 'warning' }

/** Anonymous telemetry has no board location, even when other events do. */
export function noticeForEvent(event: ObservableTurnEvent): AssetNotice | null {
  switch (event.kind) {
    case 'infected': return { node: event.node, text: 'Compromise detected', tone: 'threat' };
    case 'encrypted': return { node: event.node, text: 'Encrypted / service lost', tone: 'threat' };
    case 'override': return { node: event.node, text: 'Business override / reconnected', tone: 'warning' };
    case 'action': {
      if (!event.node) return null;
      if (event.outcome === 'probe') return { node: event.node, text: 'Patch blocked / compromise found', tone: 'threat' };
      if (event.outcome !== 'applied') return null;
      const words = { scan: 'Sensor deployed', isolate: 'Isolated / service offline', reconnect: 'Connections restored', patch: 'Patched / immune', restore: 'Restored from backup', emergency: 'Emergency capacity granted' };
      return { node: event.node, text: words[event.action], tone: event.action === 'isolate' ? 'warning' : 'defence' };
    }
    default: return null;
  }
}

export function createAssetNotices(topology: Topology, camera: THREE.Camera): {
  show(event: ObservableTurnEvent): void; tick(now: number): void; clear(): void; dispose(): void;
} {
  const container = document.createElement('div');
  container.id = 'asset-notices';
  // The incident timeline announces the same events without a time limit.
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  const slots: { element: HTMLDivElement; notice: AssetNotice | null; until: number }[] = Array.from({ length: 3 }, () => {
    const element = document.createElement('div');
    element.className = 'asset-notice';
    element.hidden = true;
    container.append(element);
    return { element, notice: null, until: 0 };
  });
  const point = new THREE.Vector3();
  function clear(): void { slots.forEach((slot) => { slot.notice = null; slot.element.hidden = true; }); }
  return {
    show(event) {
      const notice = noticeForEvent(event);
      if (!notice || !topology.byId.has(notice.node)) return;
      const slot = slots.find((item) => item.notice?.node === notice.node) ?? slots.find((item) => item.notice === null) ?? slots.reduce((a, b) => a.until < b.until ? a : b);
      slot.notice = notice;
      slot.until = performance.now() / 1000 + COMPANY.noticeSeconds;
      slot.element.textContent = `${topology.byId.get(notice.node)!.label}: ${notice.text}`;
      slot.element.dataset.tone = notice.tone;
    },
    tick(now) {
      const safe = boardSafeArea();
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const slot of slots) {
        if (now >= slot.until) slot.notice = null;
        if (!slot.notice) { slot.element.hidden = true; continue; }
        const node = topology.byId.get(slot.notice.node)!;
        point.set(node.x, EQUIPMENT[node.type].effectHeight + 0.55, node.z).project(camera);
        const x = (point.x + 1) * window.innerWidth / 2;
        let y = (1 - point.y) * window.innerHeight / 2;
        slot.element.hidden = point.z < -1 || point.z > 1 || x < safe.left || x > safe.left + safe.width || y < safe.top || y > safe.top + safe.height;
        if (slot.element.hidden) continue;
        const w = slot.element.offsetWidth;
        const h = slot.element.offsetHeight;
        const left = Math.max(safe.left, Math.min(safe.left + safe.width - w, x - w / 2));
        for (const prior of placed) {
          if (left < prior.x + prior.w && left + w > prior.x && Math.abs(y - prior.y) < h + 6) y = prior.y + prior.h + 6;
        }
        if (y + h > safe.top + safe.height) { slot.element.hidden = true; continue; }
        slot.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
        placed.push({ x: left, y, w, h });
      }
    },
    clear,
    dispose() { clear(); container.remove(); },
  };
}
