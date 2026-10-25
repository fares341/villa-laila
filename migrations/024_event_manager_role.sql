-- Event managers: dashboard logins that work on events only (events, weekly dinner menu, event bookings).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','manager','receptionist','event_manager'));
