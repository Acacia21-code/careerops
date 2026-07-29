export {
  CONTACT_CHANNELS,
  normalizeContact,
  contactRowFromLocal,
  logTouch,
  filterContacts,
  channelFromDraftKind,
} from '../lib/contacts-crm.mjs'

export function contactsForRole(contacts, roleId) {
  return (contacts || []).filter((contact) => String(contact.role_id || '') === String(roleId || ''))
}
