export type Role = 'owner' | 'manager' | 'receptionist';

// Single source of truth for what each role may do. Enforced server-side in requireUser(perm).
const MAP: Record<string, Role[]> = {
  'dashboard.view': ['owner', 'manager', 'receptionist'],
  'reservation.view': ['owner', 'manager', 'receptionist'],
  'reservation.create': ['owner', 'manager', 'receptionist'],
  'reservation.edit': ['owner', 'manager', 'receptionist'],
  'reservation.confirm': ['owner', 'manager', 'receptionist'],
  'reservation.cancel': ['owner', 'manager'],
  'reservation.export': ['owner', 'manager'],
  'guest.view': ['owner', 'manager', 'receptionist'],
  'guest.edit': ['owner', 'manager', 'receptionist'],
  'payment.record': ['owner', 'manager', 'receptionist'],
  'payment.verify': ['owner', 'manager'],
  'extension.decide': ['owner', 'manager', 'receptionist'],
  'inbox.use': ['owner', 'manager', 'receptionist'],
  'inventory.manage': ['owner', 'manager', 'receptionist'],
  'pos.use': ['owner', 'manager', 'receptionist'],
  'shifts.manage': ['owner', 'manager', 'receptionist'],
  'shifts.take': ['owner', 'manager'],
  'tours.manage': ['owner', 'manager', 'receptionist'],
  'blocks.manage': ['owner', 'manager', 'receptionist'],
  'automation.manage': ['owner', 'manager'],
  'policy.manage': ['owner'],
  'settings.manage': ['owner'],
  'users.manage': ['owner'],
  'reports.view': ['owner', 'manager'],
  'import.run': ['owner', 'manager'],
  'audit.view': ['owner', 'manager'],
  'frontdesk.use': ['owner', 'manager', 'receptionist'],
  'staff.manage': ['owner', 'manager'],
  'staff.view': ['owner', 'manager'],
  'rate.override': ['owner', 'manager'],
  'comp.approve': ['owner', 'manager'],
  'channel.manage': ['owner', 'manager'],
  'events.manage': ['owner', 'manager'],
  'catalog.manage': ['owner', 'manager'],
};
export type Perm = keyof typeof MAP;
export function can(role: Role, perm: string): boolean {
  return (MAP[perm] || []).includes(role);
}
