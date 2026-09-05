import type { NodeType } from '../data/topology';

/** Presentation only. These values never enter the simulation or seeded RNG. */
export const COMPANY = {
  materials: {
    floor: '#777e81', office: '#a8aaa3', equipment: '#56646b', edge: '#263138',
    desk: '#b4a48a', metal: '#39464c', chair: '#4b6061', screen: '#14232b',
    partition: '#959f9e', paper: '#d6d4c8', defence: '#4cc9f0',
    warning: '#f5a524', threat: '#f72585', unknown: '#899293',
  },
  fitPadding: 1.08,
  noticeSeconds: 3.5,
  restartSeconds: 0.72,
  footprint: 1.95,
} as const;

export interface EquipmentSpec {
  screen: readonly [number, number, number];
  screenWidth: number;
  effectHeight: number;
  furniture: 'desk' | 'rack' | 'switch' | 'vault' | 'crown';
}

export const EQUIPMENT: Record<NodeType, EquipmentSpec> = {
  workstation: { screen: [0, 1.27, -0.56], screenWidth: 0.66, effectHeight: 1.7, furniture: 'desk' },
  server: { screen: [0, 1.5, 0.36], screenWidth: 0.4, effectHeight: 2.1, furniture: 'rack' },
  router: { screen: [0, 0.43, 0.74], screenWidth: 0.48, effectHeight: 0.72, furniture: 'switch' },
  backup: { screen: [0, 1.06, 0.66], screenWidth: 0.44, effectHeight: 1.5, furniture: 'vault' },
  'domain-controller': { screen: [0, 1.45, 0.47], screenWidth: 0.46, effectHeight: 2.78, furniture: 'crown' },
};
